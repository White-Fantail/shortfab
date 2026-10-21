# 아키텍처 · 도메인 모델 (초기 설계)

상위 기준: [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md). 상태: **Phase 0 핵심 동작 및 Phase 1 로컬 프로젝트/클립 첫 기능 묶음 사용자 확인 완료**. Phase 1 전체는 순차 개발 중. 로컬 파일·미디어 검사·중앙 크롭·출력/취소까지 데스크톱 코드를 추가했으나 실제 데스크톱 실행 및 배포 검증 전입니다. 나머지 구성요소는 설계 단계입니다.

## YouTube-first 소스 아키텍처 (제품 최우선 요구, 2026-10-22)

- **기본 프로젝트 시작은 타인의 기존 YouTube URL**이다. 사용자가 직접 촬영한 영상/로컬 MP4를 전제하지 않는다. 현재 앱은 링크를 임베드로 열지만 렌더 원본을 확보하지 못해 이 핵심 조건을 충족하지 못한다.
- \`YouTubeReference(videoId, canonicalUrl, title?, channelId?, duration?)\`와 \`ClipRange\`를 미디어 바이트 획득 전에도 저장한다. 공식 IFrame API로 seek/현재 시각/IN·OUT 마커를 동기화한다.
- \`SourceResolver\`는 **YouTube 플레이어 추출기가 아니다**. YouTube ID에 대해 권리자가 제공한 원본/적법한 클라우드 자산/본인 Studio 출력 파일이 있는지 검사하는 **권한 기반 미디어 획득 어댑터**다.
- \`RightsGrant\`: 발췌·2차 편집·SNS 배포·상업적 사용 여부, 출처·증빙, 제한 기간, 귀속 요건. \`MediaBinding\`: YouTube videoId ↔ 렌더 가능한 원본 자산, 파일 fingerprint, 길이·타임 오프셋.
- \`SourceResolution\` 상태는 \`loading | preview_only | rights_review | source_link_required | ready_to_render | blocked | source_lost\`. **미확보 YouTube URL만으로 FFmpeg 작업이나 자동 다운로드를 시작하지 않는다**.
- 파일 경로/권한 토큰/네트워크 취득은 Electron 메인 프로세스가 소유한다. 승인된 호스트만 접근하고 SSRF·내부 주소·리다이렉트 검증 및 로컬 암호화 보관을 요구한다. YouTube IFrame의 동영상 트래픽을 숨겨진 저장/다운로드 경로로 전용하지 않는다.
- Media Worker는 \`ready_to_render\` 자산만 받으며, 소스 파일 길이/해상도/오프셋 검사 후 기존 FFmpeg 엔진을 재사용한다. YouTube 탐색 타임코드와 실제 인코딩 시각이 다를 수 있다.
- **출시 게이트:** 적법한 기존 YouTube 영상 URL → 마커 3개 → 승인 원본 자동 매칭 → 9:16 MP4 3개 생성의 종단 간 검증. 로컬 파일 출발 성공이나 YouTube **게시 API** 구현은 이와 별개.
- 완전한 기술 조사·비공식 도구 위험·우회 아닌 대안은 [YOUTUBE_FIRST_WORKFLOW.md](YOUTUBE_FIRST_WORKFLOW.md), [ADR-0002](adr/0002-youtube-first-source-acquisition.md) 참조.

## 시스템 경계

```text
Desktop UI (React + TypeScript; Electron 후보)
  ├── Project Library / Quick Create / Advanced Edit / Preview
  ├── Source Adapters: Local File | YouTube official embed | Authorized cloud file
  ├── Composition Domain: Clip/Cuts, Crop, Captions, Narration, Audio, CTA
  ├── Style Catalog Client: remote read/cache/signature/compatibility/version pin
  ├── Local Database: project JSON + SQLite metadata (후보)
  └── Local Media Worker (separate process)
       ├── ffprobe / FFmpeg → frame-accurate render + checks
       ├── proxy/waveform/scene detection
       └── render queue, cancel/retry, progress events

Optional Cloud API
  ├── STT/TTS/AI candidate-scoring provider adapters
  ├── authorized trend signals → preset synthesis/validation/catalog release
  ├── OAuth credential broker / short-lived media delivery
  └── YouTube / Instagram / TikTok publishing adapters

Deferred: cloud render workers, scheduler, multi-device sync, team access
```

## 도메인 엔티티

| 엔티티 | 핵심 속성 | 책임 |
|---|---|---|
| Project | id, title, createdAt, updatedAt, revision | 편집 및 소스 집합의 단위 |
| MediaAsset | id, kind, url?, localPath?, fingerprint, duration, rights, available | 탐색/렌더 가능성 분리 |
| Transcript | assetId, language, segments, wordTimestamps, revision | 탐색/자막 출처 |
| Clip | id, sourceId, cuts[], title, selected | 조합할 시간 구간 |
| Composition | clipId, output, crop, subtitles, audioMix, styleSnapshot, ctaConfig | 비파괴 렌더 명세 |
| StyleBundle / StyleVersion | id, version, hash, compatibility, components, evidence | 선언형 프리셋/불변 버전 |
| Narration | mode, script, voiceProvider?, approvedAt?, generatedAssetId? | 해설과 오디오 자산 |
| CTAConfig / BrandKit | enabled, goal, type, timing, content, platformOverrides | 마무리 텍스트/음성/브랜드 |
| RenderJob | compositionRevision, outputFormat, state, artifactHash, error | 재현 가능한 파일 생성 |
| PlatformAccount | provider, scopes, credentialRef, status | 게시 권한 관리 |
| PublishJob | renderJobId, provider, accountId, consent, state, remoteId/url | 플랫폼별 업로드/게시 |
| TrendSignal / CatalogRelease | source, evidence, score, validation, rollout, revoke | 트렌드 배포 근거 |

## 불변 계약

- MediaAsset는 `previewable`과 `renderable`을 구분. YouTube 공식 임베드 탐색만 가능하면 renderable=false.
- Composition 수정은 revision 증가. RenderJob은 해당 revision과 `styleSnapshot` 버전을 고정해 재현성 유지.
- `StyleBundle`은 타입/화이트리스트가 명확한 **데이터**만 포함. 카탈로그 스키마에 JavaScript URL, 동적 스크립트, 실행 바이너리 포함 금지.
- RenderManifest는 소스 fingerprint, 시간 구간, 자막/오디오/CTA/크롭, 출력 옵션, 스타일 버전/해시를 포함. 로컬/미래 클라우드 워커 공통 계약.
- PublishJob은 플랫폼별 독립 상태와 idempotency key를 가진다. `uploaded`와 `published`를 동일시하지 않는다.

## 처리 파이프라인

1. 탐색 가능한 원본 확인 → 미디어 fingerprint/길이/fps/회전/오디오 상태 검사.
2. 지정 컷 조합 → 프록시(미리보기) 또는 풀 해상도(최종 렌더).
3. 크롭/레이아웃 → 자막·텍스트·모션 → CTA 오버레이 또는 엔드카드 추가.
4. 원본/BGM/TTS/CTA 음성 믹스 → 자동 덕킹·정규화·리미팅.
5. 플랫폼 규격/길이/안전 영역/자막 잘림 검사 → 인코딩 → 출력 확인 및 작업 이력.
6. SNS 업로드는 **별도 승인과 별도 Job**으로 실행.

## 보안·운영

- OAuth 비밀과 AI API 키는 OS 키체인 또는 암호화된 서버 비밀 저장소; UI 저장 프로젝트와 렌더 로그에 평문 금지.
- 업로드를 위한 임시 파일/URL은 최소 범위·짧은 수명으로 관리, 보존 만료 시 제거.
- 파일 접근 권한은 프로젝트에 필요한 범위만. 클라우드 AI에 전송할 때 동의·보존 기간 안내.
- 실패 시 복원(프로젝트 불변), 재시도(중복 방지), 오프라인(캐시된 프리셋) 경로를 포함.
- 대용량 렌더는 별도 프로세스에서 실행; 프리뷰 응답과 UI 이벤트가 렌더 부하에 막히지 않게 함.

## 구현 순서

1. 프로젝트/MediaAsset/Clip/Composition/RenderManifest 데이터 계약과 roundtrip 저장/복원 테스트.
2. Local worker 및 렌더/취소/재시도 계약 테스트.
3. 선언형 기본 스타일과 CTA 설정 → 실제 샘플 영상 재현.
4. AI adapters, 원격 카탈로그, 게시 adapters 순차 도입.

## Phase 0 실험 구현 경계 (2026-10-22)

- `src/App.tsx`: React 로컬 미리보기·In/Out/출력 선택 UI. YouTube는 공식 임베드 **프리뷰만** 가능하며 타임코드 API 마커는 다음 단계.
- `src/shared/contracts.ts`: 프레임 비율, 렌더 요청 검증, YouTube 링크 ID 파싱. 실제 원본 경로는 전달하지 않음.
- `electron/preload.ts`: 허용된 최소 IPC만 노출, `electron/main.ts`에서 사용자 파일 선택·식별자 검증·저장 경로 확인.
- `electron/media.ts`: 로컬 ffprobe; `electron/render.ts`: 로컬 ffmpeg 하위 프로세스, 출력 크롭/진행도/취소·임시 파일 검증.
- `shortfab-media://asset/current`: 사용자가 선택한 **현재 파일 하나만** 로컬 미리보기로 노출하는 내부 URL. 렌더 엔진이 URL을 다운로드하지 않음.
- 별도 FFmpeg 프로세스를 사용하지만 렌더 큐·오래 지속되는 독립 워커·Phase 1에서는 프로젝트 JSON 저장·재열기·여러 클립 후보를 별도 `electron/projects.ts`로 추가. FFmpeg/FFprobe는 PATH에 설치된 바이너리를 사용.
- 렌더 요청은 `sourceId` 일치, 유한한 시간 범위, 720/1080 해상도만 수용. 파일 시스템 경로 선택은 메인 프로세스에서만 허용.

해당 프로토타입은 제품 플랫폼 확정이나 AI/SNS/스타일 카탈로그 구현을 의미하지 않습니다. 검증 순서·개발환경은 [DEVELOPMENT.md](DEVELOPMENT.md)를 참고하세요.

## Phase 1 저장/재열기 1차 구조 (2026-10-22)

- `src/shared/projects.ts`에 Project/StoredAsset/ProjectClip/ProjectEdits/ProjectView 계약, 스키마 버전 1과 타입·구간·중복 ID 검증을 둡니다.
- `electron/projects.ts`는 앱 사용자 데이터 폴더의 `projects/{uuid}.json` 읽기·임시 파일 원자 교체·리스트·현재 프로젝트 활성화·원본 연결/재연결을 담당합니다. 렌더러는 파일 경로 대신 편집 값만 전달합니다.
- `project:list/create/open/save`와 `project:pickMedia/reconnectMedia`만 preload로 노출합니다. 기존 `render:start`의 sourceId와 로컬 경로 검증은 유지합니다.
- 파일을 못 찾으면 프로젝트는 `missing` 상태로 복원하고, 재연결 때 크기·해상도·길이를 확인합니다. 전체 파일 해시는 구현하지 않았습니다.
- Composition은 현재 클립별 선택 구간/9:16 출력 폭만 보존합니다. 복합 컷, 자막, CTA, 스타일 버전과 RenderManifest는 별도 단계이며, 현재 JSON 스키마에는 포함하지 않습니다.
- **검증 상태:** 첫 기능 묶음 사용자 확인, CI 타입 검사·린트·단위 테스트·빌드 통과. OS별 설치·비정상 종료·파일 경합·저장 실패 시나리오는 추가 검증 과제.

## Phase 2 YouTube 공식 업로드 구현 경계 (2026-10-22)

- `electron/youtube.ts`는 OAuth/토큰 갱신, 전용 암호화 작업 저장소, Google `videos.insert`/분할 업로드 및 `videos.list` 상태 확인을 담당합니다. 렌더러에는 요청/상태 조회만 제공하며 토큰·업로드 URL·로컬 파일 시스템 경로는 노출하지 않습니다.
- 승인 없는 자동 업로드는 없습니다. `render:start` 완료가 업로드를 호출하지 않으며, 별도 `publish:start` 요청에서 메인 프로세스 OS 대화상자로 파일·제목·공개 범위·아동용 설정을 보여주고 승인한 후 업로드합니다.
- 업로드 가능한 로컬 파일은 **메인 프로세스에서 검증한 마지막 성공 MP4**뿐입니다. 현재 프로젝트/클립 구간/해상도와 일치하지 않으면 게시할 수 없습니다. 재개할 경우 해당 영상 파일의 크기·SHA-256과 OAuth 연결 세대 ID가 일치해야 합니다.
- 서버가 업로드를 받은 뒤 응답이 끊길 수 있으므로 세션 URI를 `safeStorage`로 암호화해 기록합니다. 중단/복구 시 YouTube `308 Range`를 먼저 확인하고 새 `videos.insert` 요청은 자동 생성하지 않습니다. 세션 만료나 완료 ID 불명은 사용자에게 YouTube Studio 점검을 요청합니다.
- 상태는 `uploading → processing → published | action_required` 또는 `failed`이며 `published`는 원격 처리 성공을 뜻하고 **전체 공개나 Shorts 분류를 의미하지 않습니다**. UI에는 게시 이력과 재확인/이어올리기 버튼을 제공합니다.
- 구체적인 설정과 출시 게이트는 [PHASE2_YOUTUBE.md](PHASE2_YOUTUBE.md). **Google 실계정 연동/CI/OS별 앱 실행 검증 이전이므로 Phase 2 완료 상태는 아닙니다.**

## YF-1 권리자 파일 매핑 (2026-10-22 개발 코드)

`YouTubeReference`는 정규화된 videoId·URL·IFrame 메타데이터(길이)를 나타냅니다. `RightsGrant`는 권리자 이름, 사용 허가 증빙 참조, 발췌/변형/재게시 허용 범위와 만료를 **사용자가 선언한 데이터**로 보존합니다. `MediaBinding`은 videoId→원본 assetId·파일 SHA-256·길이·시간 오프셋을 고정하며, 실제 로컬 경로를 포함하는 `StoredMediaBinding`은 Electron 메인 프로세스 전용 프로젝트 JSON 및 `userData/sources/approved/`에만 보관합니다.

`SourceResolver`는 미확보/허가 검토/파일 손실/렌더 가능 상태를 분리하고, 같은 videoId의 등록 자산을 앱 내에서 자동 매칭합니다. YouTube 클립 렌더는 `sourceTime = youtubeTime + startOffsetSeconds`로 변환하고 FFmpeg 직전에 파일·허가·해시를 재확인합니다. YouTube **게시**는 별도의 재게시 권한과 사용자 승인을 요구합니다. SHA-256·길이 검증은 YouTube 콘텐츠와의 실제 동일성/법적 권리 진위까지 증명하지 않으므로 해당 검증 및 승인 원격 스토리지 어댑터는 후속 단계입니다. [검증 가이드](YF1_AUTHORIZED_SOURCES.md).

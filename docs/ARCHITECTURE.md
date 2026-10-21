# 아키텍처 · 도메인 모델 (초기 설계)

상위 기준: [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md). 상태: **기획/미구현**. 아키텍처 원칙은 고정하고 구현 언어/프레임워크는 ADR 검증 전 후보로 취급합니다.

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
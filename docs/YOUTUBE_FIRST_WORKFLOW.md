# YouTube-first 영상 클리핑 · 핵심 제품 요구사항 및 구현 조사

- 작성/정책 조사: 2026-10-22
- 상태: **YF-0/1/2 코드 구현. 개인용 yt-dlp 공개 미디어→MP4 직접 출력 기본 흐름 사용자 실기 성공 (2026-10-22)**. 오프라인/합성 FFmpeg CI도 통과. 실제 3개 클립/QC/설치 패키징·권리자·게시 수용은 미완료. 서비스 약관·원저작물 권리 확인 필요. [현황](IMPLEMENTATION_STATUS.md).
- 선행 의사결정: [ADR-0002](adr/0002-youtube-first-source-acquisition.md)
- 중요도: **P0 최우선 제품 가설**. Phase 0의 로컬 FFmpeg 테스트 및 Phase 2의 YouTube **업로드** 기능은 이 요구사항을 충족하지 않는다.

## v2.0 우선 적용: AI 분석/추천 중심 (2026-10-22)

**새 기본 UX는 URL→AI 자동 분석→추천 클립 선택/소폭 수정→자동 레이아웃/자막/소리/CTA 순차 승인→MP4**다. 이 문서에 남아 있는 수동 IN/OUT/원본 탐색 기술계획은 기존 구현/기술의 역사적 기록이며 신규 UX를 대체하지 않는다. 새 기본 플로우는 [기획](PRODUCT_BLUEPRINT.md), [UX](UX_WORKFLOWS.md), [로드맵](ROADMAP.md)을 따른다. 공개 YouTube URL→개인용 FFmpeg MP4 실제 사용자 성공(2026-10-22)은 유지하되 AI 자동 추천/8단계 마법사가 구현됐다는 뜻은 아니다.

## 1. 기존 YouTube-first 제품 정의 (v1 기록)

ShortFab의 주 사용자는 **원본 영상을 직접 촬영·제작하거나 MP4 파일을 보유하지 않는다**. 사용자가 발견한 **기존 YouTube 동영상 URL**이 기본 출발점이다. 사용자는 해당 영상에서 의미 있는 장면을 찾아, 구간을 선택하고, 세로 화면·자막·나레이션·CTA로 **새로운 숏폼**을 만든다. 로컬 파일은 개발 테스트와 예외/보조 경로다.

**상위 UX 요구사항:** `YouTube 링크 붙여넣기 → 영상 확인·탐색 → 구간 후보 선택 → 이용 가능 경로/권리 확인 → 렌더 가능한 미디어 확보 → 스타일 편집 → MP4 익스포트 → 별도 승인 후 게시`.

- **목표 UX:** 적격한 소스라면 사용자가 원본 영상을 별도 제작하거나, 수동으로 FFmpeg 입력용 파일을 준비하지 않아도 링크 중심으로 작업을 완성한다.
- **현실 제약:** 임의의 공개 YouTube URL에서 독립 MP4를 추출·다운로드·재편집하는 기능은 공식 API로 일반 제공되지 않는다. 모든 공개 링크가 곧 렌더 가능하다고 주장하지 않는다.
- **개인용 P0 격차 해소(사용자 확인):** 공식 플레이어 구간 탐색에 머물지 않고 실제 YouTube 클립 **MP4 익스포트 성공**까지 확인했다. 다만 3개 실영상·다른 OS/지역·다운로드·재게시 권리 및 배포 게이트는 계속 미완료로 관리한다.
- 타인의 콘텐츠를 사용한 재편집·재게시 권리와 **YouTube 서비스 자체에서 미디어를 내려받는 권한**은 별개다. 라이선스 표시, 공개 영상 여부, 사용자 확인 체크박스, Premium 오프라인 저장, Shorts 리믹스 허용만으로 독립 MP4 추출 허용을 추정하지 않는다.

## 2. 구현 경로 비교 (2026-10-22 조사)

| 경로 | URL로 탐색 | 단독 MP4 생성 | 제3자 영상 | 제약·판정 |
|---|---|---|---|---|
| **A. YouTube 공식 IFrame API** | 예: 시각 탐색·seek·마커 | 아니오 | 보이는 범위에서 재생 가능 | **즉시 구현 우선**. 자체 MP4 export 경로는 아님 |
| **B. YouTube 공식 Clips** | 예: 해당 영상에서 5–60초 클립 공유 | 아니오(원본 시청 링크/구간) | 원본이 허용할 때 | **빠른 공유 fallback**. 독립 렌더/자막 합성 기능과 혼동 금지. 앱 API 자동 생성 가능 여부 별도 검증 |
| **C. YouTube 공식 Shorts Remix/Cut** | YouTube 앱 내 지원 | 앱 밖 독립 MP4 보장 안 됨 | 원본/음원 권한·재사용 설정에 따라 | **YouTube 앱으로 안내**. ShortFab 자체 FFmpeg 원본 확보 수단 아님 |
| **D. 제작자/권리자 제공 원본 URL·클라우드 파일** | 예 | **예** | **예, 재편집·배포 권한이 있을 때** | **첫 제품용 렌더 경로**. 사용자는 YouTube URL로 시작하고 뒤의 파일 접근은 소스 어댑터가 해결 |
| **E. 본인 YouTube Studio 다운로드/Takeout** | 예 | 예, 파일 확보 후 | 본인 소스만 | 백업 경로. YouTube Data API의 직접 다운로드 기능은 아님. Studio 다운로드에 품질 제한 가능 |
| **F. yt-dlp 등 비공식 추출기** | 예 | 기술적으로 가능할 수 있음 | 기술적 추출 ≠ 사용 허가 | **제품 기본/배포 경로 아님**. YouTube 약관·정책, 서면 승인, 접근 제한, 가변적인 기술 호환성 평가 전 사용 금지 |

A/B/C는 **YouTube 콘텐츠를 별도 MP4로 만들지 못한다**. D는 링크를 원본과 연결하는 파트너/허가 경로가 있는 경우에만 요구를 충족한다. F는 기술적으로 인기가 있지만 현재 정책/운영 가정에서는 범용 링크→MP4를 약속할 근거가 되지 못한다.

### 정책과 기술 근거

- YouTube 서비스 약관은 서비스가 명시적으로 허용하거나 YouTube 및 해당 권리자의 사전 허가 등이 있는 경우 외 콘텐츠 다운로드/변형을 제한: https://www.youtube.com/t/terms
- YouTube API Developer Policies, **E. Handling YouTube Data and Content**: YouTube 사전 서면 승인 없는 시청각 콘텐츠 다운로드·임포트·캐시·저장 금지: https://developers.google.com/youtube/terms/developer-policies
- YouTube Data API `videos.list`는 **메타데이터** 조회이며 MP4를 다운로드하는 일반 엔드포인트가 아님: https://developers.google.com/youtube/data/reference/rest/v3/videos/list
- IFrame API의 `seekTo`/`getCurrentTime`은 재생 위치 제어/조회이지 원본 파일 접근이 아님: https://developers.google.com/youtube/iframe_api_reference
- YouTube Clips 공식 도움말: 5–60초 구간이 원본 시청 페이지에서 반복 재생되고 공유됨: https://support.google.com/youtube/answer/10332730
- YouTube Shorts Remix 공식 도움말: 지원 영상/크리에이터 설정에 따라 YouTube 앱 안에서 재사용: https://support.google.com/youtube/answer/10623810
- 본인 영상 다운로드(Studio/Takeout), 다른 사용자 업로드는 해당 방식으로 다운로드 불가: https://support.google.com/youtube/answer/56100
- 비공식 추출기 **yt-dlp**는 YouTube PO Token 제한, 쿠키 로그인 위험, 포맷 변경을 명시: https://github.com/yt-dlp/yt-dlp/wiki/Extractors

## 3. 목표 상태: URL이 입력의 주축

1. 입력창 기본 탭을 **YouTube URL**로 하고 붙여넣기 즉시 링크/영상 ID를 검증한다.
2. 영상이 임베드 가능하면 공식 플레이어로 탐색한다. 공식 API/권한 범위에서 제목/썸네일/채널/길이 등 메타데이터를 얻고, API 키/할당량이 없으면 누락 항목은 명시한다.
3. IFrame Player API의 실제 시각 `getCurrentTime`, `seekTo`, 재생 상태, `start/end`를 타임라인/클립 후보와 연결한다. 영상의 FPS 정확도와 FFmpeg 컷 지점은 구분한다.
4. 프로젝트 저장: `YouTubeReference(videoId, canonicalUrl, title?, duration?, channelId?, selectedRanges[])`. **영상 URL 자체로 파일을 얻었다고 표시하지 않는다.**
5. `SourceResolver`가 렌더 가능한 미디어를 순차적으로 탐색한다: 사용자 소유/파트너의 승인된 원본 링크 매핑 → 사용자가 연결한 Drive/스토리지/권리자 자산 → 공식 본인 채널 파일 → 정당하게 확보한 로컬 파일. **YouTube 영상 트래픽에서 직접 미디어 URL을 추출하지 않는다.**
6. `RightsGrant`에 출처, 라이선스/계약 ID, 사용 범위(발췌·변형·상업적 사용·SNS 재게시), 귀속 표기, 기한, 플랫폼별 허용, 접근 방식 근거를 기록한다. 자동확인 불가 시 사람이 확인한다.
7. `MediaBinding`이 YouTube videoId와 승인된 미디어의 자산 ID를 연결한다. 파일 해시/길이/화면/오프셋을 검사하고 검증이 끝나면 `renderable=true`로 전환한다.
8. 승인된 미디어만 로컬 FFmpeg worker로 전달하고 결과가 생성되면 YouTube/다른 플랫폼에 **별도 게시 승인**을 요청한다.
9. 해결 불가한 경우 **탐색/클립 후보 저장은 유지**하고, 공식 YouTube Clips 공유 또는 적법한 원본 제공을 요청하는 UX로 분기한다. 허가 없이 녹화/추출을 자동 실행하지 않는다.

### 사용자에게 보일 소스 상태

- `loading`: 링크/메타데이터 분석 중
- `preview_only`: YouTube 공식 플레이어로 보기와 구간 저장 가능. 별도 MP4 export 불가
- `rights_review`: 소스가 있지만 재편집/게시 권리 검토 중
- `source_link_required`: YouTube 참조는 준비됐지만 인코딩 가능한 원본을 연결해야 함
- `ready_to_render`: 승인된 원본·싱크가 연결돼 MP4 생성 가능
- `blocked`: 비공개/연령/지역 제한, 재사용 허가 없음, 이용 불가 등 원인 분류
- `source_lost`: 재열기 시 원본이 없거나 자격증명 만료

## 4. 계약·기술 구현 계획

```text
YouTube URL input
  -> normalize URL / parse videoId
  -> YouTubeReference
  -> official IFrame Player API -> marker/range editor
  -> SourceResolver.resolve(reference, grant)
       |-- authorized cloud file / creator supplied asset
       |-- owned channel export / local authorized file
       |-- no legally accessible file -> preview/share only
  -> rights & file provenance validation -> MediaBinding
  -> FFprobe -> clip trims -> FFmpeg output -> Publish approval
```

### 제안 타입(설계; 소스에 아직 추가하지 않음)

```ts
type SourceState =
  | 'loading' | 'preview_only' | 'rights_review'
  | 'source_link_required' | 'ready_to_render' | 'blocked' | 'source_lost';

interface YouTubeReference {
  videoId: string;
  url: string;
  title?: string;
  channelId?: string;
  durationSeconds?: number;
}
interface RightsGrant {
  evidenceRef: string;
  rightsHolder: string;
  allowClip: boolean;
  allowDerivativeEdit: boolean;
  allowRepost: boolean;
  allowedPlatforms: string[];
  expiresAt?: string;
}
interface MediaBinding {
  referenceVideoId: string;
  sourceAssetId: string;
  provider: 'partner' | 'authorized_cloud' | 'owner_export' | 'local';
  expectedDurationSeconds: number;
  startOffsetSeconds: number;
  fingerprint: string;
  rightsGrantId: string;
}
interface SourceResolver {
  resolve(reference: YouTubeReference, grant?: RightsGrant):
    Promise<{ state: SourceState; binding?: MediaBinding; explanation: string }>;
}
```

- Electron 메인 프로세스만 실제 파일 경로, 다운로드 작업, 외부 스토리지 토큰을 소유한다. UI는 참조 ID와 상태만 취급한다.
- URL 주입/SSRF 방지: 사용자 임의 URL에서 `file:`/`localhost`/내부 네트워크/리다이렉트로 무차별 파일을 다운로드하는 API를 만들지 않는다. 승인된 공급자 호스트와 자산 ID/만료 URL을 별도 검증한다.
- `SourceResolver`는 **미디어 취득 가능성을 발견하는 추상 계층**이지 자동 YouTube 다운로드 어댑터가 아니다. 자격증명은 OS 보안 저장소, 캐시는 권리·수명 제한 하에 관리한다.
- 클립 타임코드 매핑 `sourceTime = youtubeTime + startOffsetSeconds`을 명시적으로 보관하고, 기준 프레임·원본 길이 오차 테스트를 만든다.
- 한계: 자막/STT/AI 추천은 렌더 원본 또는 허용된 자막 자산 없이는 무조건 활성화하지 않는다.

## 4A. 실현성 실험(Spike) — URL→클립 변환 기술 선택

**목표:** 제품 기능과 기술 현실을 구분하고, 같은 YouTube 비디오 ID로 탐색된 구간이 실제 인코딩 가능한 원본을 통해 MP4로 재현되는지를 측정한다. 아래 실험은 **영상 접근/다운로드 방식까지 명시적으로 허용되는 자체 테스트 또는 사전 승인된 자산**에 한정한다.

### Spike A — 공식 탐색/타임라인

- 샘플 YouTube URL의 \`videoId\` 추출·표준화, 공식 IFrame \`onReady\`/현재 시각/seek·state와 구간 IN/OUT 연동.
- 구간 10/30/60초 후보 저장·재열기·미디어 소스 미연결 상태 재현. 실제 YouTube 영상과 로컬 테스트 원본 사이 타임 오프셋 검증.
- 실패 기준: 미리보기만 가능할 때 렌더 버튼이 켜지거나, URL을 "실제 원본 다운로드 완료"로 표시.

### Spike B — 권리자 제공 원본 자동 연계 (**제품 1차 구현 후보**)

- 테스트 videoId와 권리자 제공 MP4 URL/Google Drive 또는 서명된 자산 URL을 연결하는 허가 목록(manifest)을 준비한다.
- \`SourceResolver\`가 videoId→assetId를 찾고 메인 프로세스에서 허용된 호스트/인증·파일 크기·MIME·hash/FFprobe/제한 시간/취소를 검사한다.
- 사용자는 링크만 붙여넣고 컷을 고른다. FFmpeg는 원본 파일을 이용해 3개의 새 MP4를 인코딩한다. 사용자의 수동 파일 선택은 필요 없어야 한다.
- 실패 기준: 원본이 다른 영상이거나 토큰 만료/링크 실패일 때 잘못된 소스로 렌더하거나 무한 재시도/SSRF 우회가 발생.

### Spike C — 비공식 \`yt-dlp\` 사용 가능성 조사 (**조건부, 제품 기본값 아님**)

- \`yt-dlp\`는 URL을 받은 후 스트림/메타데이터 및 구간 추출을 수행할 수 있는 독립적인 실행 프로그램이고, FFmpeg로 재인코딩할 수 있다. 작업 컨트롤러(별도 프로세스·timeout·진행률·종료/취소·버전 검증·SHA-256 캐시)는 설계할 수 있다.
- 그러나 현재 YouTube 플랫폼 정책은 사전 서면 승인 없는 다운로드/저장을 제한하고, 추출기는 PO Token 등 접근 제한에 따라 실패할 수 있다. **기술 실험 가능성과 제품 출시·배포 승인 여부를 각각 Go/No-Go로 결정**해야 한다.
- 기술 실험에서도 미허가 공개 영상의 대량 다운로드, 브라우저 쿠키 빼내기, 인증 우회, DRM 우회, 차단 회피를 필수 기능으로 설계하지 않는다. 약관/허가가 충족되지 않으면 *그 YouTube 영상 다운로드 실험도 진행하지 않는다*.
- 구간 추출 후 CPU/GPU 재인코딩, 오디오 싱크, 자막/CTA 지원, 설치 용량·OS별 실행/업데이트, 에러율·정지율을 측정한다.
- \`yt-dlp\`를 채택하게 되더라도 **공식 Google OAuth YouTube 업로드 권한을 다운로드 권한으로 오용하지 않는다**. 이를 구현할 경우 권한·정책 결정을 별도 ADR로 기록한다.

### 공통 테스트 산출물

\`videoId / preview availability / rights evidence / source provider / link-to-asset match / can-render / output hash / exact duration / failure reason\`을 기록한다. **최종 제품 성공 지표는 "링크를 붙여넣은 뒤 사용자가 원본을 직접 촬영·업로드하지 않고 적법한 MP4 클립을 만들 수 있는 비율"**이다.

## YF-0 구현 노트 (2026-10-22)

- `src/YouTubePreview.tsx`는 공식 YouTube IFrame Player API를 호출하여 `getDuration`, `getCurrentTime`, `seekTo`, `playVideo`, `pauseVideo`를 다룹니다. 권리 없는 원본을 다운로드하거나 HTML5 `<video>`의 src로 노출하지 않습니다.
- 프로젝트 클립은 `source: 'local' | 'youtube'`로 명확하게 분리하며 기존 로컬 프로젝트의 source 필드 누락은 `local`로 간주합니다. YouTube 동영상 길이(`youtubeDuration`)는 클립의 상한 검증용 메타데이터이고 렌더 파일이 아닙니다.
- YouTube URL이 다른 videoId로 바뀌면 기존 YouTube 후보를 제거하고 새 메타데이터를 요청합니다. 기존 로컬 클립은 보존합니다.
- 공식 플레이어의 재생 제한(퍼가기 금지, 연령·지역·로그인, 오류 153 등)과 배포된 Electron의 origin/referrer 동작은 실기 테스트 대상입니다. 이 제한을 회피하여 오디오/비디오 데이터를 취득하지 않습니다.
- 상태: **공식 IFrame 탐색을 이용한 클립 선택→개인용 MP4 익스포트 사용자 성공 확인**. 이 절의 과거 preview-only 설계는 승인 원본 없는 YF-1 경로 기준이며, 개인용 직접 다운로더 경로는 이제 별도로 동작합니다. 전체 IFrame 반복/URL 교체·재열기 테스트와 권리자 원본 실증은 별도입니다.

## 5. 우선순위가 바뀐 개발 로드맵

| 단계 | 구현 | 수용 확인 |
|---|---|---|
| **YF-0 (최우선)** | YouTube URL 기본 입력, IFrame 시각 제어·IN/OUT/후보 저장, 불가 상태 UX | 로컬 파일 없이 공개 영상 URL로 3개 구간을 탐색·저장/재열기. 다운로드·MP4 불가 상태 명시 |
| **YF-1** | `SourceResolver` + `RightsGrant` + 승인된 원본/클라우드 연결 + 싱크/해시 검증 | 사용자가 영상 촬영 없이 YouTube URL + 사용 허가된 원본 매핑만으로 9:16 MP4 3개 익스포트 |
| **YF-2** | URL→제작자 제공 원본 자동 탐색/연동·파트너 파일 제공, 계정/허가 워크플로 | 별도 MP4 파일 선택을 최소화하고 소스 확보 실패·권리 만료를 정확하게 안내 |
| **YF-3 (조건부)** | 공식 YouTube Clips/Remix 공유 연계 UX. 비공식 추출은 정책·파트너 서면 승인/운영 검토 후 별도 ADR 필요 | 독립 MP4가 불가능할 때 합법적인 공유/외부 편집 경로 제공. 허위 성공 표시 금지 |

Phase 1 스타일/CTA 및 Phase 2 공식 YouTube **게시** 검증을 없애지는 않지만, **YouTube URL→실제 클립 준비 가능성**이 제품의 선행 핵심 게이트다.

## 개인용 직접 MP4 출력 사용자 수용 기록 (2026-10-22)

- **사용자 실기 성공:** 기존 YouTube 영상의 URL로 탐색하고 구간 후보를 선택한 뒤 ShortFab에서 실제 **MP4 익스포트 성공**. 개인용 로컬 yt-dlp + FFmpeg 경로가 해당 사용 환경에서 연결됨을 확인했습니다.
- **코드·CI 별개 근거:** `electron/personal.test.ts`의 가짜 downloader/캐시, `electron/render.test.ts`의 합성 영상 MP4 3개, `src/shared/timeline.test.ts`의 구간 시각 역행 방지 등은 CI로 검증.
- **남은 검증:** 3개 실제 클립 출력/재열기, MP4 길이/화면/음성/싱크 상세 QC, 다양한 영상의 성공률, 제한 영상 실패 UX, 패키징 및 라이선스/게시 승인.
- **경계:** 이 사용자 수용은 YouTube 공식 다운로드 API/파트너 계약/재게시 권한의 증명이 아니며, 개인용도 저작권·서비스 약관 검토가 필요합니다.

[종합 수용 현황](IMPLEMENTATION_STATUS.md) · [ADR-0003](adr/0003-personal-youtube-clipping.md).

## 6. 제품 출시 수용 기준과 미해결 과제

- **필수:** 사용자가 원본 영상을 직접 촬영하지 않아도 YouTube URL만으로 영상 발견·구간 후보 설정을 시작할 수 있다.
- **필수:** 권한이 있는 미디어는 원본 파일을 직접 만들 필요 없이 가져와 새 9:16 MP4를 생성할 수 있다.
- **금지:** 단순 YouTube 링크/썸네일/임베드만으로 **영상 파일을 확보했다고 오표시**하거나 다운로드/재게시를 자동 허용하지 않는다.
- **필수:** 파일 연결 불가인 영상도 마커/프로젝트를 저장·공유할 수 있으며, 다음 행동을 제시한다.
- **출시 미해결:** 임의의 제3자 YouTube 영상 링크 하나만 넣고 항상 새 MP4를 생성할 수 있다는 약속은 현재 제공할 수 없음. 실제 가능 범위(권한/계약/공식 서비스 기능)를 검증해야 하며, 이를 제품 출시 시 숨기지 않는다.
- **검증 준비물:** 본인/파트너의 YouTube 시험 영상 1개 + 배포·편집 허가된 해당 원본 파일 또는 승인된 저장소 링크 1개, 사용 권한 문서 1건. 일반 공개 제3자 영상은 별도로 합법적 가능 범위를 확인한다.

## 개인용 직접 클리핑 구현 예외 (2026-10-22, ADR-0003)

사용자가 ShortFab을 **개인적으로 사용**하면서 기존의 승인 원본/파트너 카탈로그 절차 때문에 YouTube URL을 MP4로 출력할 수 없는 장애를 지적했습니다. 이 목적을 위한 **별도의 개인용 로컬 실험 경로**를 구현했습니다. 공식 IFrame 플레이어에서 시간을 고른 뒤 `yt-dlp`를 로컬 CLI로 호출해 공개 영상을 가져오고, FFmpeg가 선택 구간을 9:16 MP4로 렌더합니다. 영상 ID 검증, 사용자 설정/플러그인 비활성화, 캐시/다운로드 제한, 게시 권한의 별도 확인을 적용합니다. 권리자 제공 원본과 파트너 카탈로그 경로는 고급 옵션으로 유지합니다.

이 변경으로 이전 문서에 있는 “비공식 추출기 제품 기본 경로 금지”는 **배포형/사업용 기본 경로에 관한 정책 설계**이며, 개인용 로컬 실험 경로의 현재 코드 상태를 설명하지 못합니다. 임의 공개 YouTube 영상이 항상 내려받기 가능하거나 개인적 이용이라는 이유로 저작권·YouTube 약관을 무조건 만족한다고 주장하지 않습니다. 실제 맥의 YouTube 다운로드 성공과 약관 적합성은 검증되지 않았습니다. [새 개발/수용 지침](PERSONAL_YOUTUBE_EXPORT.md), [추가 의사결정](adr/0003-personal-youtube-clipping.md).

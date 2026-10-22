# ShortFab 개발환경 · Phase 0 확인 · Phase 1 저장/복원 검증

> **2026-10-22 제품 UX 전환:** 앞으로 신규 개발은 [AI Guided Creation v2.0 제품 기획](PRODUCT_BLUEPRINT.md)과 [AG0~AG8 로드맵](ROADMAP.md)을 따른다. URL→AI 클립 추천→자동 화면/자막/사운드/CTA를 매 단계 수정·승인하는 마법사가 목표이며, 이 문서의 수동 UI 실행법은 **현재까지 구현된 레거시 기능**의 사용법이다. AG1 Wizard 및 AG2 실제 대사 기반 추천 코드가 추가되었으며, Mac/Windows 실제 영상 실기 수용은 미완료. 기존 개인용 URL→수동 클립→MP4 성공은 유지하고 회귀 테스트한다.

상태: 2026-10-22 **기존 Phase 0/Phase 1 첫 묶음 + 개인용 실제 YouTube URL→클립→MP4 익스포트 사용자 확인 완료**. CI 타입·린트·합성 MP4 3개 테스트·빌드 통과. 실클립 3개/오디오 QC/설치 패키징·실제 YouTube 게시 및 예외/경합 검증은 후속입니다. [수용 현황](IMPLEMENTATION_STATUS.md).

## 요구사항

- macOS 또는 Windows, Node.js 22.x, npm.
- FFmpeg와 FFprobe가 로컬 PATH에 있어야 합니다. macOS 예시: `brew install ffmpeg`. Windows는 FFmpeg 설치 후 `ffmpeg -version`, `ffprobe -version`을 확인하고 PATH를 반영합니다.
- 사용자 소유 또는 사용권이 확인된 MP4/MOV/MKV/WEBM/M4V 파일.
- 환경변수 `SHORTFAB_FFMPEG_PATH`, `SHORTFAB_FFPROBE_PATH`로 실행 파일 위치를 따로 지정할 수 있습니다.

## 실행

```bash
npm install
npm run dev
```

새 프로젝트는 lockfile이 아직 없습니다. 최초 의존성 설치 이후 lockfile을 생성·커밋하여 CI에서 `npm ci`를 사용하도록 바꿔야 합니다. 외부 바이너리를 앱 설치 패키지에 포함하는 작업도 아직 미완료입니다.

## 확인

```bash
npm run check
npm run lint
npm test
npm run build
```

1. FFmpeg/FFprobe 버전 확인 후 `npm run dev`로 Electron 데스크톱 창 열기.
2. 로컬 파일 선택 → 길이/해상도/오디오 상태가 표시되는지 확인.
3. 타임라인에서 30초 이하 구간 IN/OUT 지정 → 미리보기.
4. 720p(720×1280) MP4 출력 → 재생/길이/영상·오디오/크롭 확인.
5. 1080p 출력, 오디오 없는 원본, 짧은 원본, 잘못된 구간, 취소/재시도, 파일 덮어쓰기 확인.
6. **YF-0 및 직접 출력 실기 체크:** 개인용 공개 YouTube URL 입력 → IFrame API 재생·seek/현재 시각·길이 → IN/OUT·후보 추가 → **파일 바인딩 없이 개인용 MP4 출력 가능** → 실제 출력 성공(2026-10-22 사용자 확인). 이후 후보 3개·재열기·구간 루프·URL 교체·재생 시간 및 제한 영상 안내는 추가 회귀 테스트. 별도 YF-1 승인 원본 경로는 소스 연결 없으면 여전히 렌더 불가일 수 있습니다.
7. 명령 실패, 손상된 영상, 저장 경로 접근권한 문제 시 에러 메시지를 확인합니다.
8. 프로젝트 이름을 변경하고 클립 후보를 3개 생성하여 각각 IN/OUT/720p·1080p 설정 후 앱 재시작 → 저장값 복원 확인.
9. 원본 파일을 이동한 뒤 프로젝트를 다시 열면 `원본을 찾을 수 없음` 상태이고 렌더 불가인지 확인. `원본 파일 재연결`로 같은 파일을 선택하면 클립 설정 유지 여부 확인. 다른 파일을 선택하면 재연결이 거절되어야 합니다.
10. 새로운 프로젝트를 만든 뒤 이전 프로젝트로 돌아갈 때 자동 저장 여부 및 짧은 간격의 연속 수정·저장 오류를 확인합니다.
11. **임시로 잘못된 클립 값 회귀 점검:** YouTube 영상 길이를 받은 뒤 클립 생성 → IN을 OUT보다 크게 입력하거나 이름을 지워도 편집 UI는 유지하고 `수정 필요 · 저장 대기`가 표시되는지 확인. 650ms 이상 지나도 IPC `project:save` 검증 오류를 발생시키지 않아야 하며, 이 상태로 프로젝트 이동/익스포트 시 명확한 수정 메시지를 보여야 합니다. 값을 유효하게 고치면 저장됨으로 변경되고 재실행 후 값이 복원되어야 합니다. 소수점 `1.1–1.3초`는 최소 `0.2초` 클립으로 허용합니다. UI/OS 실기 점검은 별도 확인이 필요합니다.

`src/shared/contracts.test.ts`는 유효하지 않은 구간/URL 및 크롭 필터를 검사합니다. 렌더링 실테스트, Tauri 비교, GPU, macOS/Windows 패키징은 다음 단계의 별도 검증 게이트입니다.

## 아키텍처/보안

- Electron 메인 프로세스만 실제 소스 경로와 저장 경로를 관리합니다.
- 렌더러는 `contextIsolation`, `sandbox`, `nodeIntegration: false` 환경에서 제한된 preload 메서드만 호출합니다.
- FFmpeg 명령은 `spawn`으로 배열 인자만 받고 셸을 사용하지 않습니다.
- **로컬 파일 소스 입력은** 임의 원격 URL 다운로드를 하지 않습니다. 별도의 **개인용 YouTube 경로**는 검증된 videoId로 로컬 yt-dlp를 호출해 접근 가능한 공개 영상을 내려받고 FFmpeg로 출력합니다. 승인 HTTPS/YF-1 경로는 독립이며 저작권/약관·재게시 허가는 별도 확인합니다.
- 성공 전 출력은 임시 파일이며 성공 검증 후에만 최종 파일명으로 이동합니다. 예상치 못한 앱 중단에 따른 임시파일 정리는 추후 개선이 필요합니다.

## 사용자 실기 수용 기록 — 직접 YouTube 클립 MP4 성공 (2026-10-22)

- **사용자 확인:** ShortFab 앱에서 YouTube 영상을 원본 파일로 미리 준비하지 않고, 클립 후보를 선택하여 MP4 익스포트까지 성공.
- **따라서 완료:** 개인용 YouTube URL → 공식 플레이어 구간 선택 → yt-dlp·FFmpeg 익스포트의 기본 P0 흐름 1건 이상 수용 성공.
- **검증 근거 구분:** 사용자의 성공 보고와 GitHub CI의 가짜 yt-dlp/합성 FFmpeg 테스트는 서로 다른 증빙. 파일 해시, 출력 세부 품질 수치 및 다른 URL/플랫폼 결과를 추정하지 않음.
- **추가 필요:** 실제 클립 3개 연속 출력·캐시 재사용·오디오 싱크/크롭 확인, 실패/재시도, 앱 재시작, Windows/패키징, 자동 YouTube 게시.
- **상세 기록:** [구현 현황/다음 단계](IMPLEMENTATION_STATUS.md) 및 [개인용 클립 명세](PERSONAL_YOUTUBE_EXPORT.md).

## Phase 1 프로젝트 저장 구현

- Electron 앱 사용자 데이터 폴더 아래 `projects/{projectId}.json`에 프로젝트 메타데이터와 클립 편집값을 저장합니다. 원본 영상을 복사하지 않고 절대 경로·파일 크기·길이·해상도를 내부 JSON에 보관합니다. 저장 시 임시 파일 → 교체를 사용합니다.
- 렌더러에는 원본의 실제 경로를 보내지 않고 `ProjectView` 및 `shortfab-media://` 프리뷰 URL만 제공합니다. IPC는 임의 프로젝트 파일 경로나 임의 렌더 입력 파일 경로를 허용하지 않습니다.
- 원본이 이동되거나 없어지면 `missing`으로 열리고 연결 복구 전에는 렌더가 비활성화됩니다. 파일 크기·길이·해상도 비교는 **완전한 암호학적 파일 동일성 검사가 아니며**, 정밀한 fingerprint 검사는 추후 과제입니다.
- Phase 1 프로젝트 저장·재열기/클립 후보/원본 재연결 기본 흐름은 사용자 확인으로 **완료** 처리했습니다. GitHub Actions에서 `npm install`, `npm run check`, `npm run lint`, `npm test`, `npm run build`가 통과했습니다 ([CI run](https://github.com/White-Fantail/shortfab/actions/runs/39657881821)). 위 8–10번의 모든 오류·경합 경계 사례 및 OS별 실기 검증까지 완료되었다는 의미는 아닙니다.

## 패키징

`npm run package:mac`, `npm run package:win` 스크립트와 수동 `Desktop packaging smoke test` Action이 준비됐지만 **실제 설치, 코드서명, FFmpeg 번들, GPU 성능 검증은 아직 없습니다.** 런타임 바이너리 번들/라이선스와 설치 테스트를 통과하기 전에는 배포용으로 표시하지 않습니다.

## Phase 2 YouTube 게시 개발

- Google Cloud YouTube Data API v3 활성화, Desktop OAuth 클라이언트 설정과 `SHORTFAB_GOOGLE_CLIENT_ID` 환경변수 설정이 필요합니다.
- Chromium 창이 아닌 시스템 브라우저에서 동의를 완료하고, Electron `safeStorage`에 암호화된 갱신용 토큰/게시 기록을 보관합니다. 보안 저장소가 지원되지 않는 경우 계정 연결은 실패해야 합니다.
- 성공적으로 익스포트한 **현재 프로젝트의 선택 클립**에서만 게시가 가능하며, OS 승인 창에서 별도 업로드 승인이 필요합니다. 기본 공개 범위는 비공개이고 아동용 여부를 명시적으로 선택합니다.
- YouTube 게시 작업은 최대 8 MiB씩 순차 전송, 중단 시 기존 세션 확인, 수동 재개, 영상 ID 후속 상태 확인으로 설계했습니다. 실계정 업로드 및 OS별 검증은 아직 필요합니다.
- [Phase 2 설정 및 수용 검사](PHASE2_YOUTUBE.md)

## YouTube URL → 실제 숏폼 (기본 직접 출력 사용자 확인, 추가 시험 필요)

- 로컬 영상으로 성공한 Phase 0·1 테스트는 **기존 YouTube 영상을 직접 파일 보유 없이 클리핑**하려는 사용자 요구의 충분조건이 아닙니다.
- **YF-0 (기본 탐색 흐름 사용자 확인):** 새 프로젝트 기본 YouTube 소스, 공식 IFrame Player API `getCurrentTime`/`seekTo`·IN/OUT·후보 마커로 실제 영상 클립을 선택해 MP4까지 사용자 확인을 받았습니다. 반복 재생·변경 URL·재열기·배포 Electron origin 제약은 추가 검증이 필요합니다.
- **YF-1:** \`YouTubeReference\`, \`RightsGrant\`, \`MediaBinding\`, \`SourceResolver\`를 도입해 권한 있는 권리자 제공 원본/스토리지 자산을 YouTube videoId에 연결합니다. 소스 fingerprint/타임 오프셋 검증 후 기존 FFmpeg 파이프라인을 사용합니다.
- **YF-1 테스트:** 직접 촬영하지 않은 YouTube 테스트 영상의 URL + 별도로 승인된 해당 원본 자산 1개로 시작하여 3개 클립을 MP4로 내보냅니다. 원본 미확보/권한 만료/다른 영상 연결 시 작업이 차단되어야 합니다.
- **YF-2:** 파일 수동 선택 없이 파트너 제공 파일을 URL에 자동 연결하는 흐름·권리 계약 증빙 저장. 3개 클립 후보/실패한 소스 연결 프로젝트를 재열어도 작업이 복원되어야 합니다.
- **개인용 로컬 직접 출력 경로 구현·실기 확인:** yt-dlp를 사용하여 접근 가능한 공개 영상의 미디어를 받은 뒤 FFmpeg로 MP4로 출력할 수 있으며 **2026-10-22 사용자가 익스포트 성공을 확인**했습니다. 이는 공식 YouTube 다운로드 API나 재게시 라이선스의 존재를 뜻하지 않으며, 로그인·DRM 우회는 지원하지 않습니다.
- 상세 스펙과 정책 링크: [YOUTUBE_FIRST_WORKFLOW.md](YOUTUBE_FIRST_WORKFLOW.md) / [ADR-0002](adr/0002-youtube-first-source-acquisition.md).

## 다음 구현

**다음: 사용자 성공한 기본 YouTube URL→MP4 흐름의 회귀 검증 확대**입니다. 실제 영상에서 다른 클립 3개 저장·재열기 및 MP4 출력·A/V 싱크·캐시 재사용을 기록하고, 설치 패키지·Windows·URL 변경·구간 루프·접근 제한/실패 처리도 확인합니다. 이후 자막·TTS·CTA·스타일 및 YouTube 실계정 게시를 분리해 진행합니다.

Phase 2 Google 인증/실제 비공개 업로드/상태·재개 통합 테스트와 Phase 1 저장/재열기 앱 통합 검증, YouTube IFrame API 타임코드 탐색, FFmpeg 배포 검증. 이후 Composition 스타일·자막·오디오·CTA·버전 스냅샷을 개발합니다.

## YF-1 승인 원본 테스트 (코드 완료, 실기 미완료)

YouTube URL로 실제 클립 3개를 먼저 저장합니다. 권리자 제공 파일의 허가 증빙 참조, 발췌/변형 편집 권한, 필요시 재게시 권한을 명시합니다. SHA-256 값이 있으면 등록 전에 입력하고, 원본 길이와 시작 오프셋이 YouTube 마커 시간대를 포괄하는지 확인합니다. Electron에서 파일을 선택한 뒤 MP4를 출력합니다.

같은 videoId를 다른 프로젝트에 넣으면 `userData/sources/approved/{videoId}.json`에 보관된 연결을 자동 재검증합니다. 소스를 변경/삭제하거나 권리를 만료시키면 렌더/업로드를 차단해야 합니다. 오프셋은 `sourceTime = youtubeTime + offsetSeconds`입니다. 3개 MP4의 실제 FFprobe 길이/화면·프레임/오디오 및 YouTube 원본 콘텐츠 일치 여부는 별도 수동 검증이 필요합니다.

로컬 파일 검증 결과는 권리자와 실제 라이선스 및 YouTube 영상과의 내용 동일성을 *자동 보증하지 않습니다*. 사용자 선언을 기술적 권리 증명으로 취급하지 마세요. 승인 클라우드 스토리지 자동 취득은 다음 작업입니다. [상세 체크리스트](YF1_AUTHORIZED_SOURCES.md).


## YF-1 클라우드 연결 개발/테스트

환경변수 `SHORTFAB_APPROVED_SOURCE_HOSTS`에 실제 허가된 원본 배포 호스트를 쉼표로 등록한 후 Electron을 실행합니다. 예: `SHORTFAB_APPROVED_SOURCE_HOSTS=media.partner.example npm run dev`. HTTPS 직접 미디어 URL과 **권리자 SHA-256 64자리** 및 기존 권리자 허가 입력을 제공하고 클라우드 연결 버튼을 누릅니다. 앱은 원본을 개인 데이터 폴더에 저장하고 다음 프로젝트에서도 등록된 videoId로 자동 매핑하도록 구현했습니다.

보안 검사: HTTPS만, 호스트 exact allowlist, IPv4 공인 DNS 접속 주소 고정, 리다이렉트 차단, TLS 인증서 검증, 응답 크기 최대 2 GiB, 120초 제한, checksum 필수·전체 비교, FFprobe/시간 범위 검증. 미디어 URL(서명 토큰 포함)을 프로젝트에 보존하지 않습니다. `src/shared/cloud.test.ts`에는 부적절한 URL/호스트/사설 주소/해시 누락의 단위 테스트를 추가했습니다.

미검증: 실제 CDN/파트너 URL E2E, 파트너 인증 갱신, 파일 동일성·AV 싱크·3개 MP4 결과, OS별 패키징. 원본 직접 파일 URL이 아닌 공유 페이지 링크(Drive의 브라우저 페이지 등)는 지원하지 않습니다.


## YF-2 파트너 카탈로그 연결 개발

실제 이용허가를 받은 파트너가 준비되면 앱 실행 전 `SHORTFAB_APPROVED_SOURCE_HOSTS`에 HTTPS 카탈로그와 미디어 제공 호스트를 **모두** 등록하고 `SHORTFAB_PARTNER_CATALOG_ENDPOINT` 및 `SHORTFAB_PARTNER_PUBLIC_KEY_B64`(Ed25519 SPKI DER base64 공개키)를 설정합니다. YouTube URL을 입력해 IFrame 메타데이터가 확보되면 “YouTube ID로 승인 원본 자동 찾기”가 활성화됩니다. 404는 등록된 원본 없음으로 안내하고, 등록된 영상이면 signed payload가 현재 videoId 및 허가와 일치해야 합니다.

서명 키의 비공개 부분은 **파트너 서버에만** 보유하며 앱/리포지토리에 절대 넣지 마세요. 단위 검증: `electron/partner-contract.test.ts`. YF-1의 `electron/render.test.ts`로 3개 합성 MP4 렌더를 자동 확인합니다. 파트너 계정/API/실영상 연결 시험과 macOS·Windows 패키징 검증은 별도로 수행해야 합니다. [파트너 카탈로그 계약](PARTNER_CATALOG.md).

## 개인용 YouTube URL 직접 MP4 익스포트

macOS에서 `brew install yt-dlp ffmpeg` 설치 후 `npm run dev`로 시작합니다. 공개 YouTube URL → 영상 재생/IN·OUT 선택 → **클립 추가** → **MP4 익스포트**. 이전처럼 권리자/파트너 바인딩을 먼저 연결하지 않아도 개인용 직접 가져오기 코드가 실행됩니다. Electron은 `SHORTFAB_YTDLP_PATH` (선택) 또는 PATH의 yt-dlp를 실행합니다. 다운로드한 원본은 앱 사용자 데이터 폴더 `sources/personal/{videoId}.mp4`에 캐시되어 다음 구간에서 재사용됩니다.

테스트: `electron/personal.test.ts`에서 가짜 yt-dlp로 인수 구성·캐시를 확인하고 `electron/render.test.ts`에서 합성 MP4 3개를 FFmpeg로 출력합니다. **별도로 실제 사용자 환경에서 YouTube 클립 MP4 익스포트 성공을 확인**했습니다. Mac/Windows 설치 패키징·3개 실제 파일 상세 A/V QC 및 다양한 지역/접근 제한 사례는 추가 시험 대상입니다. 취소·실패 시 임시 파일 정리 코드가 있습니다. [개인용 직접 출력 명세](PERSONAL_YOUTUBE_EXPORT.md).


## YouTube 탐색 UI·타임라인 수용 테스트 (2026-10-22)

- YouTube URL 붙여넣기 → **원본 정보 · 이용 안내** 상세 패널이 접힌 상태로 나타나며, 펼칠 때만 긴 안내·원본 링크 노출. 수동 원본 연결 고급 옵션 유지.
- YouTube 플레이어 자체 중복 탐색 바는 숨기고, 앱 타임라인의 **▶ / Ⅱ** 버튼으로 재생/일시정지. 상단에 `현재 MM:SS / 전체 MM:SS` 시각이 250ms 주기로 업데이트됩니다.
- 마우스/터치 포인터로 앱 슬라이더를 누르고 드래그하는 동안 시간 읽기를 외부 플레이어가 덮어쓰지 않습니다. **마우스 놓는 순간에만 한 번 seek** 합니다. YouTube IFrame API에서 seekTo 후 실제 시간이 변경되기 전까지 보고하는 이전 시각은 최대 6.5초 동안 무시하며, 실패 시 자동 동기화를 복원합니다. 키보드/보조기기 range 입력은 즉시 탐색합니다.
- `src/shared/timeline.test.ts`: 이전 시간으로 역행, 연속 탐색, 탐색 실패 시 복구, 매체 전환 초기화 단위 테스트. UI에서 긴 YouTube 영상의 2분→10분→4분 이동을 반복하고 실제 위치 표시와 손잡이가 튀지 않는지 **Mac 실기 확인 필요**.

### 원본 정보 패널 스타일 수용 기준 (2026-10-22)

- 원본 정보·이용 안내와 고급 권리자·파트너 원본 연결의 `<details>` 요약 스타일(여백·글꼴·화살표)을 동일하게 유지합니다. 둘 다 기본 접힘이고, 실제 Mac 창에서 같은 왼쪽 정렬·행 높이·펼침 동작을 확인합니다.


## Phase 1 수동 자막 검증 (2026-10-22)

1. YouTube URL에서 클립을 추가하고 **자막 편집**을 펼친 다음, 자막을 추가해 텍스트·클립 IN 기준 시작/끝을 설정합니다.
2. 기본 흰색 / 강조 노랑 / 미니멀 / 배경 박스 스타일을 번갈아 저장·재열기하고 각 스타일로 MP4를 출력합니다.
3. 자막이 있는 경우 `ffmpeg -filters` 출력에 `ass` 필터가 있는지 확인합니다. FFmpeg에 libass가 없으면 렌더 오류가 발생하며 자막 OFF에서는 정상 출력되어야 합니다.
4. 한글/영어, 줄바꿈, 원본부터 중간 구간을 자른 경우 자막 상대 시각, 720p/1080p, 폰트 및 화면 안전 영역을 실기 확인합니다. 영상의 공식 YouTube 탐색 화면에 보이는 자막은 참고용이며 최종 9:16 프레임 검수는 MP4로 진행합니다.
5. 자막 수정 직후 기존에 내보낸 MP4를 다시 게시하려 하면 새 출력이 필요해야 합니다. 중간 편집의 빈 자막·겹침·길이 초과에서는 저장/출력이 보류되어야 합니다.

자동화: `npm run check && npm run lint && npm test && npm run build`; `electron/render.test.ts` 합성 3클립 테스트 중 첫 번째에 한글 자막 합성을 포함합니다. **Mac/Windows 패키징 및 실제 클립 자막 QC는 별도 수용**입니다.


## 로컬 STT/Whisper.cpp 개발·수용 (2026-10-22)

- Mac: `brew install whisper.cpp ffmpeg`. `whisper-cli --help`와 `ffmpeg -version`을 확인하고 앱의 **자막 편집 → 기본 한국어·영어 모델 설치 (약 148MB)** 클릭. 공식 배포 모델을 HTTPS로 가져와 SHA-256 검증 후 연결합니다. 이미 받은 GGML 다국어 `.bin`은 **다른 GGML 모델 파일 선택…**을 사용할 수 있습니다. 자세한 [모델 안내](STT_LOCAL.md).
- Windows: `whisper-cli.exe`, `ffmpeg.exe`를 PATH에 두거나 `SHORTFAB_WHISPER_PATH`/`SHORTFAB_FFMPEG_PATH`에 각각 절대 경로로 지정합니다.
- 기존 개인 YouTube URL을 열고 클립을 고른 뒤 자막 편집에서 언어 자동/ko/en을 선택하고 AI 자동 자막 생성. 완료 후 각 구간이 **클립 IN을 0초로** 표시하는지, 수동 수정·스타일·MP4 번인이 되는지 확인하세요.
- 기존 자막 교체 취소, 인식 중 취소, CLI/모델 누락, 오디오가 없는 영상, 10분 초과, 자막 30개 초과, 파일 크기·임시 파일 정리를 별도 시험합니다.
- 단위: `src/shared/stt.test.ts`; 합성 FFmpeg→fake whisper SRT 통합: `electron/stt.test.ts`; 모델 설치·검증·캐시·취소: `electron/stt-model-download.test.ts`. **실제 음성 Whisper 모델 정확도/OS 실기 수용은 자동 합성 테스트와 분리**합니다.


## AG1 · Guided Wizard 실기 체크 (2026-10-22 dev)

- 신규 프로젝트: 기본 '단계별 제작'에서 YouTube URL 입력 → 플레이어 길이 갱신 → 원본 승인 → 클립 단계 이동.
- 영상 재생 위치에서 수동 클립 추가 → IN/OUT·제목 수정 → 승인 후 03 화면(9:16 중앙 크롭), 04 자막, 05 원본 소리, 06 CTA OFF, 07 검토, 08 MP4 출력.
- 상단 8단계는 이전 승인/건너뛰기 게이트를 지키고, '다시 생성'은 AI 공급자 미구현으로 비활성화여야 합니다.
- 고급 편집 왕복 시 같은 클립·자막·해상도가 유지되는지, 클립 구간/자막 변경 후 관련 단계만 '다시 확인'이 되는지 재검증합니다.
- 종료/재시작으로 현재 단계·다중 클립 각각의 승인 상태를 재열기 하고 과거 schemaVersion 1 프로젝트 JSON도 열리는지 확인합니다.
- CI: `npm run check && npm run lint && npm test && npm run build`; 추가 단위 테스트 `src/shared/wizard.test.ts`. 앱 자체 조작·YouTube 네트워크·Mac/Windows 설치 테스트 결과는 **별도 기록**합니다.


## AG2 영상 분석/추천 개발·실기 점검

[AG2 상세 문서](AG2_CLIP_RECOMMENDATIONS.md) 참고. Mac: `brew install yt-dlp ffmpeg whisper.cpp`, `ffprobe -version`·`whisper-cli -h` 확인. 앱 클립 단계에서 기본 다국어 GGML 모델 설치 후 한국어/영어 실제 발화형 영상 각각으로 테스트합니다. 첫 분석은 길이에 따라 여러 구간을 전사하므로 무겁고, 이후 '더 짧게/더 역동적으로'는 모델 재실행 없이 cached transcript를 활용해야 합니다.

- URL/길이→원본 승인→클립 02에서 **AI 음성 분석 · 클립 자동 추천**→후보 카드 2개 이상→재생→멀티 선택→구간/전사 문장 IN·OUT 수정→승인→저장·재열기→MP4 수용.
- 후보가 5개보다 적으면 더미 추천 추가 없음. 무음/오디오 트랙 없음/모델·yt-dlp 누락 및 접근 제한 영상에서는 오류/수동 선택을 확인.
- 30분 영상과 최초 60분 분석 상한, 프로그레스, 취소→재시도, 기존 수동 클립·승인 필드 보존, 모델/언어 변경 시 캐시 무효화 확인.
- CI: `npm run check && npm run lint && npm test && npm run build`; `src/shared/recommendations.test.ts` 및 `electron/analyze.test.ts`는 오프라인 합성 실험이며 실제 Whisper 모델/YouTube 네트워크 테스트가 아님.

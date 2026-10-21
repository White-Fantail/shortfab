# ShortFab 개발환경 · Phase 0 확인 · Phase 1 저장/복원 검증

상태: 2026-10-22 **Phase 0 핵심 흐름 및 Phase 1 프로젝트·클립 첫 기능 묶음 사용자 확인 완료**. CI 타입 검사·린트·단위 테스트·빌드 통과, OS별 실기 및 예외/경합 테스트는 후속 과제.

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
6. **YF-0 실기 체크:** 새 프로젝트에서 YouTube 소스가 기본 선택되는지 확인 → 공개 영상 URL을 입력해 IFrame API 로딩, 재생·seek, 영상 길이와 현재 시각 읽기, 타임라인 이동, IN/OUT, 구간 반복 테스트. YouTube 후보 3개 추가→저장·재열기 후 구간 동일성 테스트. URL 교체 시 이전 비디오 후보만 삭제되고 로컬 후보는 유지되는지 확인. 파일 연결 없이 MP4 출력이 비활성화된 preview-only 상태 확인. 퍼가기 금지/연령 제한/비공개 영상은 안내문과 원본 열기 대체 경로 확인.
7. 명령 실패, 손상된 영상, 저장 경로 접근권한 문제 시 에러 메시지를 확인합니다.
8. 프로젝트 이름을 변경하고 클립 후보를 3개 생성하여 각각 IN/OUT/720p·1080p 설정 후 앱 재시작 → 저장값 복원 확인.
9. 원본 파일을 이동한 뒤 프로젝트를 다시 열면 `원본을 찾을 수 없음` 상태이고 렌더 불가인지 확인. `원본 파일 재연결`로 같은 파일을 선택하면 클립 설정 유지 여부 확인. 다른 파일을 선택하면 재연결이 거절되어야 합니다.
10. 새로운 프로젝트를 만든 뒤 이전 프로젝트로 돌아갈 때 자동 저장 여부 및 짧은 간격의 연속 수정·저장 오류를 확인합니다.

`src/shared/contracts.test.ts`는 유효하지 않은 구간/URL 및 크롭 필터를 검사합니다. 렌더링 실테스트, Tauri 비교, GPU, macOS/Windows 패키징은 다음 단계의 별도 검증 게이트입니다.

## 아키텍처/보안

- Electron 메인 프로세스만 실제 소스 경로와 저장 경로를 관리합니다.
- 렌더러는 `contextIsolation`, `sandbox`, `nodeIntegration: false` 환경에서 제한된 preload 메서드만 호출합니다.
- FFmpeg 명령은 `spawn`으로 배열 인자만 받고 셸을 사용하지 않습니다.
- 로컬 소스는 임의의 원격 URL에서 다운로드하지 않습니다. YouTube 미디어 탐색은 별도 공식 임베드로 한정됩니다.
- 성공 전 출력은 임시 파일이며 성공 검증 후에만 최종 파일명으로 이동합니다. 예상치 못한 앱 중단에 따른 임시파일 정리는 추후 개선이 필요합니다.

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

## 최우선 신규 개발: YouTube URL → 실제 숏폼 (미구현)

- 로컬 영상으로 성공한 Phase 0·1 테스트는 **기존 YouTube 영상을 직접 파일 보유 없이 클리핑**하려는 사용자 요구의 충분조건이 아닙니다.
- **YF-0 (코드 구현, 실기 검증 대기):** 새 프로젝트 기본 소스는 YouTube입니다. 공식 IFrame Player API \`getCurrentTime\`/\`seekTo\`·IN/OUT·반복 재생·후보 마커를 프로젝트에 저장/복원하며 URL만 있으면 preview-only로 표시합니다. 앱의 파일 로드 origin 및 YouTube embed 정책에 따라 OS/배포 빌드에서 재생이 제한될 수 있으므로 실제 테스트가 필요합니다.
- **YF-1:** \`YouTubeReference\`, \`RightsGrant\`, \`MediaBinding\`, \`SourceResolver\`를 도입해 권한 있는 권리자 제공 원본/스토리지 자산을 YouTube videoId에 연결합니다. 소스 fingerprint/타임 오프셋 검증 후 기존 FFmpeg 파이프라인을 사용합니다.
- **YF-1 테스트:** 직접 촬영하지 않은 YouTube 테스트 영상의 URL + 별도로 승인된 해당 원본 자산 1개로 시작하여 3개 클립을 MP4로 내보냅니다. 원본 미확보/권한 만료/다른 영상 연결 시 작업이 차단되어야 합니다.
- **YF-2:** 파일 수동 선택 없이 파트너 제공 파일을 URL에 자동 연결하는 흐름·권리 계약 증빙 저장. 3개 클립 후보/실패한 소스 연결 프로젝트를 재열어도 작업이 복원되어야 합니다.
- \`yt-dlp\`는 현재 공식 지원/라이선스 상태로 배포 경로로 확정되지 않았으며, 약관을 위반할 수 있는 다운로드·인증 우회를 기본 기능으로 넣지 않습니다.
- 상세 스펙과 정책 링크: [YOUTUBE_FIRST_WORKFLOW.md](YOUTUBE_FIRST_WORKFLOW.md) / [ADR-0002](adr/0002-youtube-first-source-acquisition.md).

## 다음 구현

**YF-0 실기 수용 검증 및 YF-1 SourceResolver 구현**이 우선입니다. 검증 기록에는 videoId·재생 성공/실패·길이·클립 3개 저장 복원·YouTube URL 교체·MP4 차단 여부를 기록합니다. 개발 모드에서 정상 동작해도 패키징된 Electron의 `file://` origin/YouTube 임베드 제한을 반드시 따로 검증합니다.

Phase 2 Google 인증/실제 비공개 업로드/상태·재개 통합 테스트와 Phase 1 저장/재열기 앱 통합 검증, YouTube IFrame API 타임코드 탐색, FFmpeg 배포 검증. 이후 Composition 스타일·자막·오디오·CTA·버전 스냅샷을 개발합니다.

## YF-1 승인 원본 테스트 (코드 완료, 실기 미완료)

YouTube URL로 실제 클립 3개를 먼저 저장합니다. 권리자 제공 파일의 허가 증빙 참조, 발췌/변형 편집 권한, 필요시 재게시 권한을 명시합니다. SHA-256 값이 있으면 등록 전에 입력하고, 원본 길이와 시작 오프셋이 YouTube 마커 시간대를 포괄하는지 확인합니다. Electron에서 파일을 선택한 뒤 MP4를 출력합니다.

같은 videoId를 다른 프로젝트에 넣으면 `userData/sources/approved/{videoId}.json`에 보관된 연결을 자동 재검증합니다. 소스를 변경/삭제하거나 권리를 만료시키면 렌더/업로드를 차단해야 합니다. 오프셋은 `sourceTime = youtubeTime + offsetSeconds`입니다. 3개 MP4의 실제 FFprobe 길이/화면·프레임/오디오 및 YouTube 원본 콘텐츠 일치 여부는 별도 수동 검증이 필요합니다.

로컬 파일 검증 결과는 권리자와 실제 라이선스 및 YouTube 영상과의 내용 동일성을 *자동 보증하지 않습니다*. 사용자 선언을 기술적 권리 증명으로 취급하지 마세요. 승인 클라우드 스토리지 자동 취득은 다음 작업입니다. [상세 체크리스트](YF1_AUTHORIZED_SOURCES.md).


## YF-1 클라우드 연결 개발/테스트

환경변수 `SHORTFAB_APPROVED_SOURCE_HOSTS`에 실제 허가된 원본 배포 호스트를 쉼표로 등록한 후 Electron을 실행합니다. 예: `SHORTFAB_APPROVED_SOURCE_HOSTS=media.partner.example npm run dev`. HTTPS 직접 미디어 URL과 **권리자 SHA-256 64자리** 및 기존 권리자 허가 입력을 제공하고 클라우드 연결 버튼을 누릅니다. 앱은 원본을 개인 데이터 폴더에 저장하고 다음 프로젝트에서도 등록된 videoId로 자동 매핑하도록 구현했습니다.

보안 검사: HTTPS만, 호스트 exact allowlist, IPv4 공인 DNS 접속 주소 고정, 리다이렉트 차단, TLS 인증서 검증, 응답 크기 최대 2 GiB, 120초 제한, checksum 필수·전체 비교, FFprobe/시간 범위 검증. 미디어 URL(서명 토큰 포함)을 프로젝트에 보존하지 않습니다. `src/shared/cloud.test.ts`에는 부적절한 URL/호스트/사설 주소/해시 누락의 단위 테스트를 추가했습니다.

미검증: 실제 CDN/파트너 URL E2E, 파트너 인증 갱신, 파일 동일성·AV 싱크·3개 MP4 결과, OS별 패키징. 원본 직접 파일 URL이 아닌 공유 페이지 링크(Drive의 브라우저 페이지 등)는 지원하지 않습니다.

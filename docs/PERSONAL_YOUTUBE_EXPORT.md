# 개인용 YouTube 클립 직접 내보내기

상태: **직접 다운로드 및 MP4 연결 코드 구현, 오프라인 다운로드 스텁/합성 FFmpeg 통합 CI 검증. 실제 YouTube 네트워크 다운로드 및 macOS 실기 검증은 미완료.** 2026-10-22

## 제품의 기본 흐름

1. **YouTube 탐색**에 공개 YouTube 영상 링크를 붙여넣습니다. 공식 IFrame 플레이어로 원본의 IN/OUT 구간을 선택합니다.
2. **클립 후보 추가** 후 구간과 720p/1080p를 결정합니다.
3. **선택 클립 MP4 익스포트**를 클릭합니다. 별도 파트너/권리자 파일 연결 없이, 로컬 설치된 `yt-dlp`가 해당 공개 YouTube 영상 ID의 미디어를 가져옵니다. 이후 기존 FFmpeg가 선택 구간을 9:16 30fps MP4로 만듭니다.
4. 다운로드한 원본 영상은 `Electron app.getPath('userData')/sources/personal/{videoId}.mp4`에 남아 동일 영상에서 두 번째·세 번째 클립을 내보낼 때 재다운로드하지 않습니다.
5. 공개 영상 자체의 가져오기를 지원하지 않는 경우(지역/로그인/비공개/DRM/플랫폼 제한/추출 방식 변경) 안전하게 실패 메시지를 보여줍니다. 접근 제어, DRM 또는 로그인 우회를 구현하지 않습니다.

**특징:** 개인용 직접 가져오기는 승인된 외부 소스 매핑(YF-1/YF-2)과 독립된 경로입니다. YouTube 공개 URL만 있어도 다운로드 가능한 경우 MP4 제작을 진행할 수 있습니다. 파트너 카탈로그와 수동 권리자 파일 연결은 접힌 **고급 옵션**으로 남깁니다.

## 설치 및 실행 (개발 데스크톱)

Mac (Homebrew):
```sh
brew install yt-dlp ffmpeg
npm install
npm run dev
```

Windows:
```powershell
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
npm install
npm run dev
```

Electron 앱은 `yt-dlp --version`으로 감지하여 없으면 설치 메시지를 표시합니다. Finder에서 시작한 Mac 앱에서도 `/opt/homebrew/bin`, `/usr/local/bin` 경로를 탐색하도록 다운로드 프로세스 PATH를 확장합니다. 시스템 패키지는 앱이 몰래 설치하지 않습니다. 명시적인 실행 파일 위치는 `SHORTFAB_YTDLP_PATH`로 지정할 수 있습니다. FFmpeg/FFprobe는 기존 시스템 설치 또는 `SHORTFAB_FFMPEG_PATH`/`SHORTFAB_FFPROBE_PATH`가 필요합니다.

## 구현·검증 경계

- 실제 URL 문자열을 명령 인수로 사용하지 않고, 먼저 허용된 11자리 `videoId`로 정규화한 뒤 `https://www.youtube.com/watch?v={id}`를 재구성합니다.
- 사용자 셸을 실행하거나 URL을 명령행에 보간하지 않습니다. `spawn`을 인수 배열로 호출합니다.
- `--ignore-config --no-plugin-dirs --no-remote-components --no-playlist`를 사용하며 로그인 쿠키·사용자 개인 설정을 전달하지 않습니다.
- 첫 다운로드는 최대 1080p의 공개 영상을 로컬에 인코딩 가능 파일로 저장합니다. 최대 파일 크기 4 GiB, 15분 작업 제한, 스테이징 디렉터리에 먼저 저장 후 검사된 파일만 캐시로 이동합니다.
- 캐시/다운로드 길이가 선택한 OUT 시간보다 짧으면 실패합니다. FFmpeg 렌더는 기존 진행 표시/취소/임시 파일/9:16 출력 검증 체계를 사용합니다.
- 클립 구간, 해상도 및 현재 선택된 원본 ID가 프로젝트 저장 기록과 다르면 메인 프로세스에서 렌더를 거부합니다.
- 개인 다운로드 원본에서 만든 MP4에는 `sourceBindingId: youtube:{videoId}`가 기록됩니다. 사용권이 검증된 YF-1 원본이 아니므로 앱 내 **자동 YouTube 게시에는 바로 사용하지 않습니다**. 게시 기능은 별도 권리 확인과 독립된 최종 승인을 요구합니다.
- 다운로드 캐시는 개인 앱 데이터 폴더에 남아 저장공간을 사용합니다. 디스크 관리/자동 캐시 정리는 추후 옵션이며 필요 시 앱 종료 후 해당 개인 캐시를 수동 삭제할 수 있습니다.

## 테스트·남은 검증

- [x] 가짜 로컬 yt-dlp 명령을 통한 YouTube ID 입력·로컬 캐시/재사용 통합 테스트
- [x] FFmpeg 합성 테스트 영상으로 3개의 9:16 MP4 출력/길이/오디오 검사
- [x] TypeScript/ESLint/웹·Electron 빌드 CI 실행
- [ ] 실제 공개 YouTube 영상의 `yt-dlp` 취득 테스트 (네트워크/권리/지역별 제약 존재)
- [ ] 실제 Mac 사용자의 앱에서 yt-dlp/FFmpeg 설치 상태와 다운로드 후 MP4 재생 검증
- [ ] Windows 설치/패키징의 외부 명령 탐색 및 속도/동시성/저장공간 확인
- [ ] 동영상의 이용약관·저작권/재게시 허가 확인 및 패키지 배포 전 정책 재검토

## 책임있는 사용

개인적 시청 또는 개인용 편집이 저작권상 무조건 허용되거나 YouTube 이용약관에 항상 부합하는 것은 아닙니다. 원저작물 권리와 해당 서비스 약관을 확인하고 사용하세요. **로그인/DRM 제한 우회는 지원하지 않습니다.** 앱의 직접 가져오기 성공을 YouTube 플랫폼의 공식 다운로드 허용으로 표시하지 않습니다.

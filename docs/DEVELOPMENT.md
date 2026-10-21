# ShortFab 개발환경 · Phase 0 체크리스트

상태: 2026-10-22 **코드 추가 / Electron 앱 종단간 검증 대기**.

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
6. YouTube 임베드는 **탐색 전용**임을 확인. URL만으로 MP4 생성 버튼이 활성화되지 않아야 합니다.
7. 명령 실패, 손상된 영상, 저장 경로 접근권한 문제 시 에러 메시지를 확인합니다.

`src/shared/contracts.test.ts`는 유효하지 않은 구간/URL 및 크롭 필터를 검사합니다. 렌더링 실테스트, Tauri 비교, GPU, macOS/Windows 패키징은 다음 단계의 별도 검증 게이트입니다.

## 아키텍처/보안

- Electron 메인 프로세스만 실제 소스 경로와 저장 경로를 관리합니다.
- 렌더러는 `contextIsolation`, `sandbox`, `nodeIntegration: false` 환경에서 제한된 preload 메서드만 호출합니다.
- FFmpeg 명령은 `spawn`으로 배열 인자만 받고 셸을 사용하지 않습니다.
- 로컬 소스는 임의의 원격 URL에서 다운로드하지 않습니다. YouTube 미디어 탐색은 별도 공식 임베드로 한정됩니다.
- 성공 전 출력은 임시 파일이며 성공 검증 후에만 최종 파일명으로 이동합니다. 예상치 못한 앱 중단에 따른 임시파일 정리는 추후 개선이 필요합니다.

## 패키징

`npm run package:mac`, `npm run package:win` 스크립트와 수동 `Desktop packaging smoke test` Action이 준비됐지만 **실제 설치, 코드서명, FFmpeg 번들, GPU 성능 검증은 아직 없습니다.** 런타임 바이너리 번들/라이선스와 설치 테스트를 통과하기 전에는 배포용으로 표시하지 않습니다.

## 다음 구현

YouTube IFrame API 기반 In/Out 마커 및 타임코드 연동, 저장 가능한 Project/Clip/Composition 명세, ffmpeg 통합 테스트, FFmpeg 배포 전략과 Electron/Tauri 검증. 이후 자막·오디오·CTA·버전 고정 스타일을 단계적으로 적용합니다.

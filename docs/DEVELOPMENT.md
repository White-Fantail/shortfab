# ShortFab 개발환경 · Phase 0 확인 · Phase 1 저장/복원 검증

상태: 2026-10-22 **Phase 0 핵심 흐름 사용자 확인 / Phase 1 프로젝트 저장 기능 코드 추가, 통합 테스트 대기**.

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
- Phase 1 저장 코드와 새 테스트는 커밋되지만 실제 `npm install` / `npm run check` / `npm test` 및 앱 재시작 검증 결과를 확인하기 전에는 통과로 표시하지 않습니다.

## 패키징

`npm run package:mac`, `npm run package:win` 스크립트와 수동 `Desktop packaging smoke test` Action이 준비됐지만 **실제 설치, 코드서명, FFmpeg 번들, GPU 성능 검증은 아직 없습니다.** 런타임 바이너리 번들/라이선스와 설치 테스트를 통과하기 전에는 배포용으로 표시하지 않습니다.

## 다음 구현

Phase 1 저장/재열기 앱 통합 검증 및 FFmpeg 통합 테스트, YouTube IFrame API 기반 타임코드 탐색, FFmpeg 배포 전략과 Electron/Tauri 검증. 이후 Composition에 스타일·자막·오디오·CTA·버전 스냅샷을 단계적으로 연결합니다.

# 로컬 자동 자막 (Whisper.cpp) — 설치·개발·수용

상태: 2026-10-22 **코드/CI 단계**. 클립 구간 오디오를 FFmpeg로 추출해 Whisper.cpp CLI가 SRT를 만들고 기존 편집/MP4 출력에 연결합니다. 실제 Mac/Windows 실음성 인식 수용은 별도입니다.

## 최초 설치

macOS Homebrew:

```bash
brew install whisper.cpp ffmpeg
whisper-cli --help
ffmpeg -version
```

모델(필수): https://huggingface.co/ggerganov/whisper.cpp/tree/main

ShortFab **자막 편집 → 기본 한국어·영어 모델 설치 (약 148MB)**를 클릭하면 공식 배포처의 `ggml-base.bin` 다국어 모델을 내려받아 로컬에 설치합니다. 사용자의 클릭 **전에는 아무 다운로드도 시작하지 않습니다**. 진행률과 **모델 다운로드 취소**, 다운로드 최대 15분 제한을 지원하고, 동일 SHA-256이 확인된 캐시는 재사용합니다. 기존 `ggml-base.bin` 또는 `ggml-small.bin` 등의 **GGML 다국어** 모델(.bin)을 직접 내려받았다면 **다른 GGML 모델 파일 선택…**을 사용하세요. `*.en.bin`은 영어 전용이므로 한국어에는 사용하지 마세요.

Windows는 `whisper-cli.exe`, `ffmpeg.exe` 설치/경로 구성이 필요합니다. 환경변수 `SHORTFAB_WHISPER_PATH`, `SHORTFAB_FFMPEG_PATH`, `SHORTFAB_WHISPER_MODEL_PATH`를 각각 CLI, FFmpeg, 모델의 경로에 지정할 수 있습니다. 모델 경로는 Electron 사용자 데이터 폴더의 `settings/stt.json`에 로컬 저장하며 UI에는 파일명만 표시됩니다. 환경변수 모델 지정이 있으면 그 경로가 우선합니다.

## 설치 실패 진단 (2026-10-22 수정)

- Whisper 기본 모델 설치는 `huggingface.co`의 공식 `/resolve/` URL에서 시작합니다. 파일은 `cdn-lfs-us-1.hf.co`, `us.aws.cdn.hf.co`, `cas-bridge.xethub.hf.co` 등 제공사의 CDN/Xet 영역으로 이동할 수 있으므로 `*.hf.co` 하위 호스트에 한해 HTTPS 리다이렉트를 허용합니다. 유사 도메인, HTTP, URL 자격증명, 임의 포트는 차단하며 최종 파일은 **고정 SHA-256·바이트 수**가 일치해야만 설치합니다. 실제 148MB 온라인 다운로드 재검증은 별도입니다.
- 자막 MP4 익스포트에 쓰는 FFmpeg는 일반 인코딩뿐 아니라 **`ass` 비디오 필터(libass)**를 지원해야 합니다. macOS Homebrew `ffmpeg`가 해당 필터 없이 설치됐다면 `brew install ffmpeg-full`을 실행합니다. ShortFab은 시스템 FFmpeg의 `ass` 필터를 먼저 확인하고, 없으면 일반적인 Homebrew `ffmpeg-full` 설치 경로를 자동 탐색합니다. 사용자 설정 `SHORTFAB_FFMPEG_PATH`는 우선하며, 해당 실행 파일에서 libass를 찾지 못하면 해결 방법을 표시합니다.
- 명령으로 직접 확인: `ffmpeg -hide_banner -filters | grep -E ' ass +V->V'`. `ass` 항목이 없으면 libass 포함 FFmpeg가 필요합니다.

## 설치 진행률 및 재시도 UX (2026-10-22 dev 코드)

- 클립 추천(02)과 자막(04), 고급 편집에서 동일한 `ModelInstallPanel` 사용. 화면에는 **기존 캐시 확인 → Hugging Face HTTPS 연결/리다이렉트 → 다운로드 바이트·진행률 → SHA-256/파일 크기 검증 → 설정 저장 → 완료** 단계가 표시됩니다.
- 148MB 파일 다운로드의 **수신 MB/전체 MB**, 백분율과 경과 시간, 수신이 12초 이상 멈추면 마지막 데이터 수신 후 경과 시간 및 취소 버튼을 보여줍니다. 다운로드 시작 전 연결 대기와 검증 중에는 무한 진행 표시(확정 100%로 오인 방지)를 사용합니다. 실패 후 오류 메시지와 다시 설치 버튼이 남습니다.
- 모델 설치 진행 이벤트는 `stt:progress`의 `phase=model`에서 구조화된 `model` 데이터를 전달합니다. 오디오 전사와 분리된 상태이므로 모델 설치 메시지를 전사 진행 메시지로 잘못 표시하지 않습니다.
- 회귀 테스트는 이벤트 단계, 캐시 재사용, CDN 리다이렉트 및 무결성 검사를 포함합니다. 실제 148MB 파일 다운로드와 macOS 사용자 화면은 **실기 확인 전**입니다.

## 사용자 흐름

1. YouTube URL 또는 로컬 파일에서 **0.2초~10분** 길이의 클립을 선택합니다.
2. **자막 편집**에서 언어 자동 감지 / 한국어 / English를 선택합니다.
3. 모델 설치 상태를 확인하고 **AI 자동 자막 생성** 버튼을 누릅니다. YouTube 공개 영상은 기존 개인용 캐시가 있으면 재사용하고, 승인된 권리자 원본은 기존 검증 연결을 이용합니다.
4. 기존 자막이 있으면 **교체 확인**이 표시됩니다. 취소하거나 음성 인식에 실패하면 기존 자막이 유지됩니다.
5. 자동 생성된 텍스트/시간을 검토하고 직접 수정하거나 스타일을 바꾸고 MP4로 출력합니다.

## 구현 및 제한

- `src/shared/stt.ts`: SRT 파서, 구간 기준 시간 매핑, 중복/길이/형식 제한 및 자막 편집 스키마 재사용.
- `electron/stt.ts`: FFmpeg로 16 kHz mono PCM WAV 추출 후 `whisper-cli -m MODEL -f WAV -l auto|ko|en -osrt -of PREFIX -np`로 SRT 생성. 취소/타임아웃/임시 파일 정리.
- `electron/stt-model.ts`: 사용자 모델 선택/설정, CLI 실행 여부 확인 및 앱 내 모델 설치.
- `electron/stt-model-download.ts`: 공식 HTTPS 모델 배포 URL에서 약 148MB 모델 내려받기, 허용된 HTTPS 호스트로만 리다이렉트, 저장 용량·SHA-256 검증, 취소·손상 아티팩트 정리 및 캐시 재사용. 사용자 음성은 다운로드 과정에 포함되지 않습니다.
- `electron/main.ts`: 실제 선택된 클립과 소스 식별자를 메인 프로세스에서 다시 검증하고 렌더/저장/게시와 동시 수행 차단.
- 자막은 **클립 IN 기준**이며, 30개/클립, 자막당 100자 제한. 인식 결과는 자동 게시하지 않습니다.
- WAV와 SRT는 임시 파일이며 완료/실패/취소 뒤 삭제합니다. STT 오디오/전사 데이터를 원격 서버로 보내지 않습니다.
- 접근 제한·DRM이나 다운로드 권한을 우회하지 않고, YouTube 이용권 및 재게시 권리는 별도입니다.

## 개발 검증

```bash
npm run check && npm run lint && npm test && npm run build
```

테스트 `electron/stt-model-download.test.ts`는 실제 원격 접속 없이 모델 다운로드 캐시 재사용·가짜 파일 체크섬 검증·허용되지 않은 리다이렉트·중단 정리를 점검합니다. `src/shared/stt.test.ts`는 한국어/영어 SRT·시간/구간/긴 문장/오류를 검증합니다. `electron/stt.test.ts`는 오프라인 합성 MP4의 오디오를 FFmpeg로 변환하고 가짜 whisper-cli SRT를 가져옵니다. 테스트용 가짜 음성 인식은 **실제 GGML 모델의 정확도**를 검증하지 않습니다.

**실기 수용 미완료:** 공식 약 148MB 모델 실제 HTTPS 다운로드/해시 검증·Mac/Windows 설치, 한글/영문·긴 클립 인식 품질, 자막 줄바꿈/안전 영역, Windows/패키징·CLI 설치, 네트워크 제한 영상의 실패 처리. 자동 설치되는 것은 **모델 데이터뿐**이고 whisper-cli 실행 파일/FFmpeg는 사용자가 먼저 설치해야 합니다.

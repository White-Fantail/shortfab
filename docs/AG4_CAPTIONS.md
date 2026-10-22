# AG4 · 자막 카드 선택, 실제 대사 재사용, Hook·강조, 직접 교정

2026-10-22 · dev 구현 노트 · [로드맵](ROADMAP.md) · [스타일 갤러리](STYLE_GALLERY.md).

## 제품 경험

03 화면에서 선택한 레이아웃 이후 **04 자막**으로 진행한다. 사용자가 8개의 자막 스타일을 좌우로 넘겨 **실제 YouTube 정지 프레임 또는 원본 썸네일에서 비교**하고 한 개를 선택한다. 이 단계에서 자동으로 "최적" 스타일을 강제하지 않는다. 첫 4개(classic / bold / minimal / boxed)는 과거 프로젝트와 호환하며 추가 4개(neon / cinema / impact / topline)는 libass 렌더 프리셋을 함께 제공한다. 카드의 타이포그래피는 출력 디자인의 근사 시안이며 MP4와 완전히 동등한 재생형 프리뷰는 후속이다.

문장 생성 경로는 둘이다.

1. AG2 URL 분석을 완료한 상태라면 **'AG2에서 분석한 실제 대사로 자막 만들기'**를 눌러 캐시된 타임코드·텍스트에서 클립 상대 타이밍으로 자막을 만든다. 음성 인식을 다시 실행하거나 Whisper 모델을 설치할 필요가 없다. 말이 없는 구간, 이미 분석한 최초 60분 밖의 구간에서는 사용할 수 없다.
2. AG2 전사가 없거나 새로운 인식이 필요하면 기존 **Whisper로 현재 클립 새로 전사**를 사용한다. 음성 인식 모델과 도구는 준비되어 있어야 한다.

두 경로 모두 기존 자막 문장을 **교체하기 전 확인**을 받으며 사용자가 수정한 레이아웃, 자막 스타일, Hook은 유지한다. 새 인식에는 추측 문장을 넣지 않는다. 최대 30큐 제한 초과 시 처음 30개만 사용하지 않고 오류를 표시해 클립 범위를 줄일 것을 안내한다.

## 문장 편집과 Hook

- Wizard 내 목록에서 문장(100자), clip IN 기준 시작/끝 초, 전체 문장 강조 체크, 듣기/위치 이동, 삭제, 수동 추가 가능. 변경 시 기존 JSON 프로젝트 자동 저장. 빈 문장·타임코드 중복 등의 중간 입력은 검증 안내 후 저장/렌더를 보류하며 정상화 시 재개.
- **Hook OFF가 기본.** 사용자가 '실제 대사에서 Hook·강조 제안'을 누르면 실제 자막에 등장하는 질문/반전/강조 표현을 찾아 **그 표현 자체**를 64자 이내로 제안한다. 근거 없거나 음성을 왜곡한 문구를 창작하지 않는다. 이미 Hook/강조를 지정했다면 확인 전 덮어쓰지 않는다.
- Hook은 화면 상단 0초부터 0.5~5초 표시하는 독립 ASS 레이어다. `banner`(배경 박스)와 `simple`(강조 텍스트) 중 선택하고 텍스트/표시 시간을 수정하거나 OFF로 돌릴 수 있다.
- 자막의 **강조**는 문자 단위 정밀 시간 추정이 아니라 선택한 큐 전체의 스타일(굵은 노란 글씨)을 바꾼다. 소리·자막 원본에 새로운 시간이나 발언을 만들어 넣지 않는다.

## 데이터와 렌더

- `src/shared/subtitles.ts`: 기존 `SubtitleTrack`에 optional `hook`, `SubtitleCue.emphasis`를 추가하고 과거 JSON 데이터는 그대로 읽는다. 모든 스타일은 고정 ID/ASS 프리셋만 허용. Hook 텍스트와 시간은 별도 검증한다.
- `src/shared/caption-suggestions.ts`: AG2 분석 결과에서 실제 전사 문장 범위/문장 길이/연속성을 기준으로 클립 자막을 생성. Hook/강조를 '적용 가능 제안'으로 만든다.
- `electron/subtitles.ts`: libass 상단 Hook과 일반 자막을 분리하고 정확한 상대 시간에 렌더. 전체 큐 강조 스타일을 독립 ASS 스타일로 출력하며 ASS 제어 태그 입력은 기존처럼 무력화한다. `electron/render.ts`는 **Hook만 있는 경우도** 자막 파일을 작성하고 MP4에 합성한다. **2026-10-22 보완:** `ass=filename=captions.ass` 명시 및 실행 FFmpeg의 `ass` 필터 사전 검사·macOS `ffmpeg-full` 탐색. 필터가 없으면 FFmpeg 파서 오류 대신 설치 안내를 표시한다. 이 오류는 사용자 macOS 실기 재검증 전이다.
- `src/App.tsx`, `src/WizardPanel.tsx`, `src/StyleGallery.tsx`, `src/styles.css`: 선택/수정/검증/저장 경로 공유, 자막/Hook 원본 참고 오버레이. YouTube IFrame 오버레이가 최종 크롭 동등 프리뷰는 아님.
- 새 스타일/Hook/강조는 `JSON.stringify(clip.subtitles)`에 반영되므로 스타일을 변경하면 이전 MP4는 최신 출판 자료로 인정하지 않는다. `reconcileWizard`가 해당 클립의 subtitles→review/export를 재검토 처리하며 다른 클립은 건드리지 않는다.

## macOS 일반 FFmpeg에서 자막 출력 장애 대응 (dev, 2026-10-22)

- 일반 Homebrew `ffmpeg`가 `ass` 필터를 제공하지 않아 실제 사용자 MP4 출력이 차단됨. `electron/ffmpeg-ass.ts`의 FFmpeg 선택에서 libass 빌드 우선, 설치되지 않은 경우 기존 일반 FFmpeg를 사용해 `overlay` 자막 합성을 수행하도록 보완.
- `electron/caption-overlay.ts`는 Electron의 격리된 숨김 Canvas를 이용해 검증된 자막 문구를 OS 글꼴로 PNG에 렌더하고, IN 기준 타임라인에 맞춘 FFconcat 한 스트림으로 영상에 합성. Hook과 일반 자막의 겹침, 자막 없는 공백, 강조, 8종 프리셋 및 720/1080을 처리한다. 텍스트를 FFmpeg 필터식으로 보간하지 않음.
- 기본 ASS 필터가 있는 FFmpeg의 기존 렌더 경로는 보존. Canvas 방식은 libass와 폰트·행간·그림자 등이 약간 다를 수 있으며 **실제 Mac 기기에서 성공/시각 품질 확인이 필요**. 자동 테스트는 타임라인/그래프와 합성 회귀를 별도로 실행한다.

## 자동 테스트 vs 실사용 검증

```bash
npm run check
npm run lint
npm test
npm run build
```

테스트 `src/shared/caption-suggestions.test.ts`와 `electron/subtitles.test.ts`에서 실제 전사 입력/Hook/강조/출력 ASS 검증. 추가 FFmpeg 합성 테스트는 오디오·배치·자막/Hook 동시 합성에 대해 실행한다.

실사용 확인은 **한국어·영어 YouTube 발화형 클립**, 8종 스타일 카드 미리보기, AG2 캐시 재사용, 수동 문장/IN/OUT 편집, Hook OFF/ON과 시간이 겹치는 대사 자막, 스타일 변경 후 재열기·MP4·글꼴 렌더·안전 영역을 포함한다. 한/영 폰트, 표기 잘림, macOS/Windows 차이는 **사용자 검증 전에는 완료로 표시하지 않는다**.

## 미구현

정확한 단어별 하이라이트/카라오케와 어절 타이밍, 동적 카메라/안전영역 자동 검사, LLM 기반 Hook 문구 창작, 외부 트렌드 프리셋 자동 업데이트, 최종 출력 동등 동영상 미리보기는 구현되지 않았다. 영상/대사에 대한 과장된 자동 품질 보증은 하지 않는다.

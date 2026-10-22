# 통합 쇼츠 스타일 + 나레이션 자막 연결 (2026-10-22)

## 제품 결정

사용자가 보내준 3개의 Shorts URL은 **화면 구성·자막이 하나의 영상 표현 스타일**이어야 한다는 참고 예시다. 영상 자체는 여기서 프레임 단위로 확인하지 못했으며, 각 링크의 특정 효과를 구현하거나 동일하게 복제했다고 주장하지 않는다.

- https://www.youtube.com/shorts/IEIEl1wEsSY
- https://www.youtube.com/shorts/AAM42L2rDD8
- https://www.youtube.com/shorts/slqbHbXGtQU

기본 순서: **URL → 클립 → 통합 스타일(화면+자막) → 나레이션 → 자막 확인 → CTA → 검토 → MP4**. 원본 오디오가 충분하면 나레이션 OFF로 유지한다.

## 이번 dev 코드

- `src/shared/short-styles.ts`: 고정 ID/version=1인 결합 스타일 8종. 중앙/좌/우 크롭, 블러 전체 보기 4개 레이아웃과 흰색·노랑·미니멀·박스·네온·시네마·임팩트·상단 8개 자막 디자인을 조합한다. 선택 시 `layout`+`subtitles.preset`만 함께 변경하고 기존 cue/Hook은 유지한다.
- `src/StyleGallery.tsx`, `src/WizardPanel.tsx`: 시안 카드 안에 원본 프레임과 스타일 자막 예시를 **동시에 보여준다**. 미리보기는 정지 프레임 시안이지 재생형 영상이나 FFmpeg 합성 결과라고 주장하지 않는다.
- `src/shared/projects.ts`: 클립별 `style` ID/버전, `narration` 설정. 예전 프로젝트의 누락 값은 `null` 처리하여 기존 크롭/자막 구성 그대로 보존.
- `src/shared/wizard.ts`: 단계 순서 변경 및 구성 변경 시 해당 클립만 하위 단계 needs_review. 04 TTS 원고 → 05 검토, 원본 자막은 기존 Whisper/STT 편집 그대로 유지.
- `src/shared/narration.ts`: OFF/TTS, 언어(ko/en), 최대 1,200자/30 문장 검증, 문장별 분리. **입력 원고를 다른 텍스트 생성 모델이 임의 재작성하지 않는다**.
- `electron/narration.ts`: macOS 내장 `/usr/bin/say`(Yuna/Samantha)로 **각 문장을 독립** 음성 파일로 생성한 후 FFprobe로 실제 길이를 읽어 클립 상대 cue를 결정. 지정 음성이 없으면 설치 안내, 영상보다 원고가 길면 길이 안내 후 출력 거부. 오디오는 FFconcat 하나로 연결한다. 사용자 원고는 쉘에서 실행되지 않으며 로컬 임시 파일로 전달하고 작업 후 제거한다.
- `electron/render.ts`: TTS ON이면 위 cue와 합성 음성을 넣고 원본 오디오는 18%로 낮춘 뒤 FFmpeg `amix` (오디오 없는 원본은 TTS만 출력). TTS OFF 기존 원본 음성/자막 렌더는 유지. ASS 부재 시 Canvas PNG overlay 경로에도 같은 cue 적용.
- `electron/main.ts`, `src/App.tsx`: 게시 아티팩트의 스타일 버전/나레이션 정보 서명을 포함하여 기존 MP4의 오게시를 차단한다.

## 제약과 실기 검사

- **코드 반영 상태 ≠ 실사용 수용 완료.** dev Code Quality CI `eb69154` 실행 성공(`check`/`lint`/`test`/`build`). 별도로 리눅스 FFmpeg 합성 소스/AIFF/투명 PNG로 크롭·블러·오버레이 3경로의 출력 MP4 video+audio 스트림 생성 성공. macOS 시스템 음성 실제 동작·자막 싱크 사용자 수용은 여전히 대기. 선택한 macOS voice는 시스템에 설치돼 있어야 한다. Windows TTS 미지원. 별도 보이스 프리뷰 버튼은 없음.
- 인위적인 글자 비율 타이밍이 아니라 실제 각 음성 파일의 길이로 합성하므로 자막 문장/음성이 일치한다. 다만 문장 내 단어/음절별 karaoke 시간 추정·화자별 원본 자막 병행·음성 교차페이드/리미터는 미구현. 문장별 음성 파일의 앞뒤 침묵에 따른 감각적인 타이밍도 실기 품질 검토 필요.
- 같은 파일의 서로 다른 컷/스타일은 프로젝트에 독립 저장된다. 출력 성공과 YouTube 게시·권리 확인은 다르다.
- 실제 프레임 카드와 최종 출력 프레임이 다를 수 있고, 안전 영역·한글 줄바꿈·ASS/Canvas 차이는 실사용 확인이 필요하다.

## 검증 절차 (CI 통과, macOS 실기 수용 대기)

```bash
npm run check
npm run lint
npm test
npm run build
```

프로젝트에서 한영 음성 각 1건, 나레이션 OFF 1건, 나레이션이 영상보다 긴 경우 1건, ASS 사용 가능/Canvas fallback 양쪽, 음성이 없는 원본 1건, 2개 클립 독립 저장/재열기, 나레이션 수정 후 MP4 게시 신선도 갱신 및 취소/임시 파일 정리 확인. [ROADMAP](ROADMAP.md)의 AG5 Exit는 통과 전까지 미완료.

## 앞으로의 스타일 확장

선택형 `StyleBundle`은 단순 font/layout 조합을 넘어 **영상 크롭/분할/줌·텍스트 배치/모션·전환·리듬·타이포그래피·하이라이트 효과**를 한 버전으로 묶는 게 목표다. 임의 실행 코드를 카탈로그로 내려받지 않고, 프리셋 서명·폰트 사용권·한영 예시를 검증하며 사용자가 승인한 버전은 고정한다.

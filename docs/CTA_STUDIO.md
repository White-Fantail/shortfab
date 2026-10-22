# CTA Studio v2.0 — Step 06 AI CTA 제안과 사용자 승인

- 상태: **목표 설계, CTA 렌더/AI 추천 미구현**.
- 기준: [제품 기획](PRODUCT_BLUEPRINT.md), [UX](UX_WORKFLOWS.md), [로드맵](ROADMAP.md).

## 목표

사용자가 복잡한 CTA 설정 패널을 먼저 채우지 않는다. AI가 **영상 내용, 플랫폼, 사용자 목적**을 바탕으로 없음/OFF, 구독/팔로우, 풀영상, 다음 편, 댓글 등의 CTA를 **짧은 문구와 실제 미리보기 카드**로 제안한다. 각 단계의 일관된 **추천 → 소폭 수정 → 승인 → 다음** 방식을 따른다.

## 기본 UX

1. 현재 영상과 대상 플랫폼을 기반으로 CTA 후보 2~3개 + **CTA 없음(기본)**을 보여준다.
2. 카드에서 문구·시작 시간·위치·형식을 바로 비교한다.
3. 선택된 카드에서 문구, 강조 단어, 노출 길이, 위치, 브랜드 로고/색상을 수정한다.
4. 고급 편집에서만 키프레임/애니메이션 상세/플랫폼별 텍스트 오버라이드를 펼친다.
5. 승인 후 Review/Export에 동기화하고 변경할 때만 CTA 관련 단계/렌더를 무효화한다.

## 형식 및 시간 영향

| 타입 | 길이 영향 | 주의 |
|---|---|---|
| OFF | 없음 | 옵션은 저장할 수 있으나 렌더 미포함 |
| overlay | 원본 끝 1~3초에 중첩, 보통 총길이 유지 | 자막·얼굴·SNS 가림영역 회피 |
| endSlate | 뒤에 2~5초 추가 | 총길이 재검증, 오디오 종료점 |
| voice | 텍스트/음성과 함께 필요시 믹싱 | TTS 권리·음량·원본 대사 중첩 |
| combined | 하위 형식의 총 효과 | CTA와 자막/음성 동시 검증 |

수치는 초기 추천 범위이며 클립 길이·플랫폼 정책·콘텐츠에 따라 달라진다.

## 제안 및 렌더 계약

CTAPlan: enabled(default false), goal, type, text, language, presetId+version, brandKitRef?, position, startMs, durationMs, voiceSegment?, platformOverrides, userLockedFields[], acceptedRevision.

- AI 초안과 승인 스냅샷을 구분하고 '다시 생성'은 잠기지 않은 제안 필드만 교체.
- 플랫폼별 권고 문구를 제시하더라도 영상 속 버튼/QR 이미지가 해당 플랫폼의 실제 클릭 가능한 링크라고 주장하지 않는다.
- Preview와 MP4가 같은 안전영역/레이아웃/길이 계산 계약을 사용한다.
- Clip 구간/오디오 구성이 바뀌면 필요 범위만 needs_review. 기존 CTA 문구를 자동 삭제하지 않는다.

## 우선순위/검증

AG6에서 OFF, overlay, endSlate의 실제 FFmpeg 출력과 사용자 문구 편집을 우선. 음성 결합형은 AG5 TTS/믹싱 엔진과 연동. 한영 문구, 플랫폼 UI 가림, 길이 초과, 잘못된 버튼 인상, CTA ON/OFF, 취소/재열기, 해상도별 출력을 실기 확인해야 완료로 기록한다.

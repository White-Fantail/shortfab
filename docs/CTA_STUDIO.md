# CTA Studio — 행동 유도 장면 제작

상위 기준: [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md) §8B. 상태: **기획/미구현**.

## 역할

영상 끝에서 `팔로우/구독/댓글/좋아요/공유/프로필·웹사이트 방문/전체 영상/다음 편` 같은 사용자 행동을 자연스럽게 제안합니다. CTA 사용은 선택이며 **기본 OFF**입니다.

## 사용자 설정

`CTA 사용 → 목표 → 형식 → 문구/브랜드 → 위치/길이 → 선택적 음성 → 플랫폼별 오버라이드 → 미리보기`

| 형식 | 시간 영향 | 미리보기 및 안전 처리 |
|---|---|---|
| 오버레이(원본 마지막 1–3초 권장) | 원본 길이 유지 | 대사/인물/플랫폼 버튼과 겹침 검사 |
| 엔드카드(원본 뒤 2–5초 권장) | 총길이 증가 | 추가 길이 표시·플랫폼 최대 길이 재검증 |
| 음성 CTA | 길이·타이밍에 따라 | 원본 음성과 믹싱, 덕킹, 문장 단절 방지 |
| 결합형 | 구성요소에 따라 | 타임라인·음량·자막 동시 검사 |
| CTA OFF | 영향 없음 | 기존 CTA 세팅은 재선택용으로 보존 가능 |

CTA 텍스트는 사용자가 수정하고 AI 제안 문구는 승인 후 반영합니다. 화면 속 이미지 URL·가짜 버튼이 실제 플랫폼의 클릭 가능 링크가 된다고 표시하지 않습니다.

## 플랫폼별 문구

- YouTube Shorts: `구독`, `풀버전`, `다음 편` 등.
- Instagram Reels / TikTok: `팔로우`, `프로필`, `댓글` 등.
- 플랫폼별 링크/버튼의 **실제 동작**은 API·계정 조건을 확인해야 하며, 영상 안에 인쇄된 버튼이 동작하는 것처럼 표현하지 않습니다.
- 각 플랫폼별 안전 영역 규칙은 버전 관리하고 프리뷰에 가림 영역을 표시합니다.

## 렌더 계약

```text
CTAConfig
  enabled, goal, type (overlay|endSlate|voice|combined)
  position (lastSeconds|afterVideo|customTime), durationMs
  locale, text, animationPresetId, brandKitId, logoRef
  narration { mode, script, voiceId?, volume, duckOriginal }
  platformOverrides { youtube?, instagram?, tiktok? }
  safeAreaRuleVersion, approvedAt?
```

렌더는 CTA 종류에 따른 실제 길이를 계산하고 안전 영역·색 대비·폰트·발화 끝맺음·피크 음량을 검사합니다. CTA가 최대 길이를 넘기면 자동으로 잘라 버리지 말고 타이밍 변경/오버레이 전환/사용자 확인을 제안합니다.

## 수용 테스트

- 30초 영상 마지막 2초 오버레이 → 최종 출력 **30초**.
- 30초 영상 뒤 3초 엔드카드 → 최종 출력 **33초**.
- 나레이션과 원본 발화가 겹칠 때 덕킹 또는 타이밍 조정 선택 가능.
- 선택한 플랫폼을 바꾸면 CTA 목표/문구가 자동 제안되며 사용자 커스텀 값은 지워지지 않음.
- CTA가 OFF이면 자막/나레이션/크롭 설정은 그대로 유지.
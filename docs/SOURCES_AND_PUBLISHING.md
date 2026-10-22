# 소스 권한 · 미디어 입력 · 플랫폼 배포

상위 기준: [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md) §7 및 [UX_WORKFLOWS.md](UX_WORKFLOWS.md). 상태: **YouTube 공식 OAuth/업로드 구현 코드 추가, 실계정 검증 대기**. Instagram/TikTok은 설계·미구현입니다. 정책·API 조건은 출시 전 재확인해야 합니다.

## v2.0 제품 UX와 실제 개인용 구현 구분

[AI Guided UX](UX_WORKFLOWS.md)의 첫 단계는 YouTube URL 입력 후 **자동 콘텐츠 분석과 클립 추천**이다. 분석·미리보기·개인용 MP4 가능 여부·SNS 게시 자격은 서로 다른 상태여야 한다. 사용자는 매 단계 AI 초안을 검토·수정·승인하고 **실제 계정 게시에는 별도 승인**을 해야 한다.

**실제 개인용 현황(2026-10-22):** 공개 접근 가능한 YouTube URL을 yt-dlp로 가져와 FFmpeg MP4로 출력한 사용자 실기 성공이 최소 1건 있다. 아래 초기 YF-1/2 중심의 '미디어 확보 필요' 규정은 **일반 배포/승인 자산 기준**의 설계이며 개인용 직접 MP4 기능을 미구현이라고 판정하는 근거가 아니다. 범용 다운로드 허용, 서비스 약관 적합성, 타인 영상의 재가공/재게시 허가는 별도의 검증 대상이다.

## 초기 소스 권한·미디어 취득 정책 (v1 설계 기록, 일반/승인 배포 기준)

ShortFab은 **YouTube 기존 영상 URL을 입력으로 받고 새 숏폼을 만들어내는 앱**이다. 원본 촬영·로컬 MP4 파일 보유를 사용자에게 기본으로 요구해서는 안 된다. 다만 현재 YouTube Data API는 일반 공개 영상 MP4 다운로드를 제공하지 않으므로, **링크 입력/마커 탐색 기능과 독립 MP4 생성을 엄격히 구분**한다.

- **P0 탐색:** 공식 YouTube IFrame·API가 허용하는 방식으로 구간을 찾고 클립 후보·프로젝트에 저장한다.
- **P0 MP4 변환:** 제작자/권리자가 제공한 동일 영상의 승인된 원본 URL, 권한 있는 클라우드 자산, 소유자 출력본을 \`SourceResolver\`가 연결한다. 저작권자의 2차 편집/재게시 허가 및 YouTube 직접 취득 권한은 서로 다른 조건임을 기록한다.
- **공식 YouTube Clips:** 5~60초 범위 구간을 **원본 페이지에서 공유**하는 기능이다. 새 MP4 파일을 내려받는 기능이 아니다.
- **Shorts Remix/Cut:** 적격 영상의 YouTube 앱 내부 재사용이다. 독립 MP4 편집·크로스포스팅 허가나 원본 다운로드 권한을 의미하지 않는다.
- **비공식 yt-dlp:** 기술적으로 스트림/영상 추출이 가능할 수 있지만 YouTube 약관/개발자 정책, PO Token/쿠키·접근 제한에 취약하다. **개인용 로컬 출력 경로로는 이미 구현되고 실기 성공했으나, 일반 배포/공식 API 경로로 승인된 것은 아니다**. 권한/정책 검증과 별도 승인·ADR 없이는 범용 다운로드 보장이나 자동 재게시 권한을 추가하지 않는다.
- **일반 배포/권리 게이트:** 개인용 공개 URL→MP4 수용 1건 이상은 확인되었지만, 임의의 모든 YouTube URL과 공식 API/약관/재게시 권리까지 보장하는 기능은 **미검증**. 렌더 가능한 미디어를 확보할 수 없는 영상은 임베드 탐색·클립 마커 저장/공유만 제공하고 정확한 상태를 표시한다.

자세한 정책 근거·프로덕션 수용 기준과 제안 인터페이스: [YouTube-first 구현 조사](YOUTUBE_FIRST_WORKFLOW.md), [ADR-0002](adr/0002-youtube-first-source-acquisition.md).

## 입력 소스는 탐색 가능성과 렌더 가능성을 구분

| 소스 | 탐색 | 클립 렌더 | 유의 사항 |
|---|---|---|---|
| 로컬 MP4/MOV 등 | 가능 | 가능 | 파일 접근 권한 및 오디오/코덱 확인 |
| YouTube URL (공식 IFrame) | 타임코드/플레이어 중심 | **URL만으로 보장 불가** | 임의 콘텐츠 다운로드/캐시/변환에 의존하지 않음 |
| 사용자가 관리하는 저장소(향후) | 권한 범위 내 | 적법한 원본 접근 시 | 토큰과 저장·전송 권한 확인 |
| 본인 영상 원본 파일 | 가능 | 가능 | 사용자 제공 원본의 출처·매칭 확인 |

YouTube URL 입력은 썸네일/제목/임베드/마커를 제공할 수 있지만, 임베드 접근이나 URL 소유 선언만으로 다운로드 권한이 생기지 않습니다. 실제 렌더 전에 원본을 연결하고 길이·타임코드·fingerprint를 비교합니다. 불일치하면 타임 오프셋 보정 UI를 제공합니다.

## SNS 업로드는 게시와 분리

1. 완성 MP4 생성 → 플랫폼/계정별 기술 요건(비율·길이·코덱 등)과 권한 확인.
2. 제목·설명·해시태그·커버·공개 범위 확인 → 사용자 명시적 게시 승인.
3. 플랫폼별 `queued → uploading → processing → published | failed | action_required` 상태 추적.
4. 실패한 플랫폼만 안전하게 재시도. 중복 게시 방지 키·원격 게시 ID·URL 저장.
5. 공식 API 이용 권한이 없으면 파일 익스포트 + 수동 게시 경로 제공. “업로드 성공”과 “실제 공개 게시됨”은 다름.

## 공식 API 연동 범위

- **YouTube**: IFrame 프리뷰 탐색과 YouTube Data API `videos.insert` 업로드/세션 재개·`videos.list` 처리 확인 코드를 추가했습니다. Google Desktop OAuth PKCE/최소 `youtube.upload` 및 별도 승인, 토큰 암호화를 사용합니다. 실제 Google 앱 등록·실업로드·API 정책/쿼터 검증은 [Phase 2 지침](PHASE2_YOUTUBE.md)에 따라 진행해야 합니다. Shorts 분류는 플랫폼 기준에 따라 달라집니다.
- **Instagram**: Meta Content Publishing API, Professional 계정·권한/제약 확인, 미디어 컨테이너 및 게시 상태 추적.
- **TikTok**: Content Posting API 권한 승인과 앱 감사, 공개 범위 정책, 임시 제한 준수. 불가 시 사용자 수동 게시 또는 허용된 초안 워크플로.
- **음원·효과음·폰트·나레이션**: 소스별 라이선스를 확인하고 타 플랫폼으로 재배포할 수 없는 자산은 사용을 제한.

## 링크 (개발 전 변경사항 확인 필요)

- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/iframe_api_reference
- https://developers.google.com/youtube/data/reference/rest/v3/videos/insert
- https://support.google.com/youtube/answer/56100
- https://developers.facebook.com/documentation/instagram-platform/content-publishing
- https://developers.tiktok.com/docs/en/content-posting-api-get-started
- https://ads.tiktok.com/resources/help/article/how-to-use-the-commercial-music-library
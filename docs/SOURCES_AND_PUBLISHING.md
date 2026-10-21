# 소스 권한 · 미디어 입력 · 플랫폼 배포

상위 기준: [PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md) §4, §10. 상태: **YouTube 공식 OAuth/업로드 구현 코드 추가, 실계정 검증 대기**. Instagram/TikTok은 설계·미구현입니다. 정책·API 조건은 출시 전 재확인해야 합니다.

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
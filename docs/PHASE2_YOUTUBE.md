# Phase 2 · YouTube 공식 게시 연결

상태: **개발 코드 통합, 실계정 OAuth/업로드/OS별 검증 대기** (2026-10-22). 인증 승인은 실제 Google Cloud 프로젝트와 테스트 사용자가 있어야 가능합니다. Phase 1의 자막/TTS/CTA 완료와 독립적으로 MP4 익스포트 기반 게시를 구현했습니다.

## 개발자 준비

1. Google Cloud Console에서 YouTube Data API v3를 활성화하고, OAuth 동의 화면(테스트 사용자 포함)을 구성합니다.
2. **Desktop app** OAuth 클라이언트를 생성합니다. 웹 클라이언트의 localhost redirect URI를 고정 등록하는 대신 데스크톱의 loopback 임시 포트를 사용합니다.
3. 앱을 실행하는 환경에 `SHORTFAB_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com`을 설정합니다. 일부 Google 데스크톱 OAuth 클라이언트에서 토큰 요청에 `client_secret`를 요구하는 경우 **개발 환경에서만** `SHORTFAB_GOOGLE_CLIENT_SECRET`을 별도로 설정할 수 있습니다. 배포되는 앱의 정적 비밀값은 비밀로 취급할 수 없으므로 프로덕션에서는 공식 요구사항과 클라이언트 구성/자격증명 브로커 설계를 재검증해야 합니다. 소스·문서·로그에 비밀값을 커밋하지 않습니다.
4. macOS Keychain, Windows DPAPI 또는 Linux의 OS 비밀 서비스에 접근할 수 있어야 합니다. Electron `safeStorage` 사용 불가/비암호화 Linux `basic_text` 폴백에서는 **계정 연결을 차단**합니다.

## 사용자 흐름

1. 로컬 프로젝트와 클립을 열고 해당 클립 MP4를 **성공적으로 익스포트**합니다.
2. YouTube 항목에서 **Google로 연결**을 누르고 기본 브라우저에서 `youtube.upload` 단일 권한으로 동의합니다. 별도 임베디드 로그인/비밀번호 수집은 하지 않습니다.
3. 제목(1~100자), 설명(0~5000자), 공개 범위(**기본 비공개**), **아동용 여부를 명시적으로 선택**합니다.
4. **별도 승인 후 업로드**를 누른 뒤 OS 네이티브 승인 창의 **업로드 승인** 버튼을 눌러야 `videos.insert`가 시작됩니다. 익스포트 완료나 연결만으로 업로드하지 않습니다.
5. 업로드는 8 MiB 분할/이어서 업로드를 사용하고, 성공 시 원격 영상 ID와 URL을 저장합니다. 파일 전송 완료와 YouTube 처리 완료는 분리됩니다.
6. **상태 새로고침**으로 `videos.list(part=status,processingDetails)`를 호출합니다. YouTube에서 처리 성공을 확인한 경우에만 `published`로 기록하며, 이 상태가 **전체 공개**나 Shorts 분류를 보증하지 않습니다.
7. 실패하면 동일 영상·설정의 새 게시 작업 생성을 차단하고, 세션이 남아 있는 기록에서 **이어서 업로드**만 허용합니다. 세션을 잃은 경우 안전상 새 업로드를 자동 생성하지 않고 YouTube Studio 확인을 안내합니다.
8. OAuth 또는 YouTube API를 사용할 수 없으면 익스포트된 MP4를 YouTube Studio에서 **수동으로 업로드**합니다.

## 로컬 저장·위협 모델

- 토큰(갱신용), 업로드 세션 URL, 로컬 출력 경로와 작업 기록은 Electron 메인 프로세스의 `userData/publishing/vault.dat`에 OS `safeStorage`로 **전체 암호화**해 기록합니다. 임시 쓰기 → rename. 프로젝트 JSON, renderer, IPC, 로그에 액세스/리프레시 토큰·세션 URL·출력 경로를 노출하지 않습니다.
- IPC에는 프로젝트별 작업 ID, 텍스트/상태/진행도, 검증된 `https://www.youtube.com/watch?v=` 링크만 반환합니다. 원격 세션 URL은 YouTube API 호스트와 업로드 경로를 검증합니다.
- PKCE(S256), 랜덤 `state`, 127.0.0.1 임시 포트, 제한된 callback path, 2분 만료, 시스템 브라우저를 사용합니다.
- 게시 작업은 현재 활성 프로젝트/렌더 완료 파일에 바인딩됩니다. 재개 전 파일 크기와 SHA-256을 비교합니다. 영상 파일을 읽을 수 없어지면 재개하지 않습니다.
- 연결 해제 시 로컬 토큰을 삭제하고 Google 토큰 철회를 최선 노력으로 요청합니다. 이전 게시 이력은 유지합니다.
- 앱 비정상 종료 시 진행 중 작업을 실패/확인 필요 상태로 표시하고, 새 세션 생성 없이 기존 세션만 재개합니다.

## 검증 체크리스트

- [ ] 정상 OAuth 테스트 사용자 연결·재연결·해제 및 Google 앱 액세스 해제 확인
- [ ] macOS Keychain, Windows DPAPI, Linux Secret Service와 지원되지 않는 OS 저장소 테스트
- [ ] 임베드 탐색 URL만으로는 업로드 불가, 렌더 후 현재 프로젝트/클립에 한해 업로드 가능
- [ ] 승인 창 취소, 제목/범위/아동용 필수 유효성, 중복 클릭 및 중복 영상 방지
- [ ] 시험용 비공개 MP4 업로드 및 YouTube Studio/처리 상태/URL 상호 확인
- [ ] 401/403/429/5xx, 만료 토큰, 실패한 업로드 세션, 재시작 후 이어올리기 검증
- [ ] 인증 실패/권한·할당량 제한에서 익스포트 및 수동 게시 대체 경로 확인
- [ ] Google OAuth 앱 검증/YouTube Data API 감사·할당량·게시 정책 및 배포 심사

단위 테스트: `src/shared/publishing.test.ts`는 입력·분할 상태·처리 단계 순서의 순수 로직을 검증합니다. **Google 테스트 계정 없이 실제 업로드 성공으로 간주하지 않습니다.**

참고: [YouTube insert](https://developers.google.com/youtube/data/reference/rest/v3/videos/insert), [resumable upload](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol), [video status](https://developers.google.com/youtube/data/reference/rest/v3/videos/list), [desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).

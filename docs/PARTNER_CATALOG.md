# YF-2 · 승인 파트너 카탈로그 원본 자동 탐색

상태: **영상 ID 조회·디지털 서명 검증·다운로드·프로젝트 연결 코드 구현, 실제 파트너 운영/실영상 수용 검증 미완료** (2026-10-22).

## 제품 동작

사용자가 **YouTube URL**을 입력하고 공식 IFrame 플레이어에서 길이를 읽으면, **“YouTube ID로 승인 원본 자동 찾기”** 버튼을 사용할 수 있습니다(승인 파트너 카탈로그를 설정한 경우).

1. Electron 메인 프로세스가 URL에서 11자리 `videoId`만 꺼냅니다. 외부 카탈로그에는 YouTube 영상 주소 전체, 프로젝트 이름, 클립 타임라인, 인증정보를 전송하지 않습니다.
2. 운영자가 고정한 `SHORTFAB_PARTNER_CATALOG_ENDPOINT`에 `?videoId=…`를 붙여 HTTPS JSON을 조회합니다. HTTP 404는 등록된 원본 없음입니다. 리다이렉트는 허용하지 않습니다.
3. 등록된 파트너 Ed25519 공개키로 응답 본문을 검증합니다. 서명된 영상 ID가 현재 영상과 정확히 일치하고, 허가·체크섬·URL·만료가 유효해야 합니다.
4. 서명으로 검증된 미디어 URL이 `SHORTFAB_APPROVED_SOURCE_HOSTS`에 포함된 HTTPS 직접 파일 주소인지 재검사합니다. 원본은 TLS 인증서 및 DNS/IP 검사와 2 GiB/120초 제한 아래 다운로드되며 SHA-256을 검증합니다.
5. FFprobe와 기존 길이/시각 오프셋 검증을 통과하면 `MediaBinding`으로 프로젝트와 로컬 등록소에 저장합니다. 저장된 클립은 기존 FFmpeg 렌더를 그대로 사용합니다. 이미 승인·등록된 파일이 존재하면 재열기 시 로컬 연결을 우선 재사용합니다.

카탈로그가 없다면 기존의 **로컬 원본 연결**, **허용 HTTPS 직접 원본 URL 연결**, **YouTube 미리보기**를 계속 사용합니다. 임의의 YouTube 영상을 다운로드하거나 YouTube 스트림 URL을 추출하는 기능이 아닙니다.

## 운영자 환경변수

```sh
SHORTFAB_APPROVED_SOURCE_HOSTS=catalog.rightsholder.example,media.rightsholder.example
SHORTFAB_PARTNER_CATALOG_ENDPOINT=https://catalog.rightsholder.example/v1/shortfab-sources
SHORTFAB_PARTNER_PUBLIC_KEY_B64=<Ed25519 SPKI DER 공개키의 base64>
```

세 가지를 모두 앱 프로세스 실행 환경에 제공해야 합니다. 여기의 도메인은 **설정 형식의 예시**이며 실제 파트너가 아닙니다. 파일 URL의 호스트는 allowlist에 포함되어야 합니다. 자체 CDN/기타 파트너 서버와 계약하지 않았다면 자동 검색 버튼은 비활성화됩니다. 공개키는 공개 정보이고 **파트너 서명 개인키는 절대 앱/저장소에 넣지 않습니다**.

## 카탈로그 프로토콜 v1

- 메서드: `GET <configured endpoint>?videoId=<11 characters>`
- HTTP 200: JSON `{ "signedPayload": "<base64url UTF-8 JSON>", "signature": "<base64url Ed25519 signature>" }`
- HTTP 404: 해당 ID에 사용권이 있는 원본 없음
- 그 외 응답, TLS 오류, 리다이렉트, 과도한 응답(32 KiB 초과)은 실패
- `signature`는 **인코딩되기 전 JSON UTF-8 바이트 원문**에 대한 Ed25519 서명입니다. 받는 쪽에서는 base64url 디코딩한 바이트를 그대로 검증해야 하므로 JSON 필드 순서/공백을 재직렬화해서 검증하지 않습니다.

서명된 payload 내용:

```json
{
  "schemaVersion": 1,
  "videoId": "abcdefghijk",
  "downloadUrl": "https://media.rightsholder.example/asset.mp4?token=short-lived",
  "sha256": "64-character-lowercase-hexadecimal-sha256",
  "rightsHolder": "Example Rights Holder",
  "evidenceRef": "signed-agreement-reference",
  "allowClip": true,
  "allowDerivativeEdit": true,
  "allowRepost": false,
  "expiresAt": "2027-03-01",
  "startOffsetSeconds": 0,
  "issuedAt": "2026-10-22T00:00:00.000Z",
  "validUntil": "2026-10-22T00:20:00.000Z"
}
```

실제 `sha256`은 64자 hex여야 합니다. 편집 권한 `allowClip`과 `allowDerivativeEdit`는 **둘 다 true**여야 하며, `allowRepost`가 false라면 MP4 익스포트는 가능해도 YouTube 재업로드는 막습니다. signed offer의 발행 시각은 현재보다 5분 이상 앞설 수 없고 유효기간은 최대 24시간이며 만료된 응답을 거부합니다. `expiresAt`은 콘텐츠 사용권의 만료 날짜로, signed URL 유효기간(`validUntil`)과 별개입니다.

파트너는 **자체 서명 개인키**로 해당 JSON 바이트에 서명하며 권리자·라이선스·원본 파일 해시·YouTube ID 대응을 책임집니다. 앱은 서명된 주장을 검증하지만, **공식 YouTube 스트림과 프레임/음성이 실제 동일한지**, 파트너 계약이 진짜인지, 계약이 실시간으로 철회됐는지는 별도로 독립 검증하지 못합니다.

## 보안과 저장

- 호스트 exact allowlist, 공개 IPv4 DNS 응답 검증 및 접속 주소 고정, 표준 TLS 검사, 리다이렉트 금지
- 제한된 JSON 본문 크기(32 KiB), 응답 15초 제한, 필수 Ed25519 서명/비디오 ID 대조
- 파일 URL은 앱 메모리에서만 쓰고 저장하지 않음. 서명 URL 쿼리/토큰을 로깅하지 않음
- 미디어 파일 전체 SHA-256 및 FFprobe/시각 범위 검증. 실패 시 임시 파일 삭제
- 프로젝트 내 미디어 경로는 Electron 메인 전용이며 렌더러로 전달하지 않음
- 등록된 로컬 파일은 열기/렌더 단계에서 다시 검증하지만 **서명된 카탈로그 응답의 실시간 철회·갱신은 미지원**. 철회/라이선스 조회 캐시 정책이 후속 필수 작업임

## 수용 검증 (남은 작업)

- [x] Ed25519 올바른 서명/위변조/다른 videoId/허가 누락/만료 단위 테스트
- [x] 승인 다운로드 링크 host/IPv4/IP 사설 범위 검사 단위 테스트
- [x] FFmpeg 합성 픽스처의 9:16 클립 3개 출력 테스트 (이전 YF-1)
- [ ] 테스트 파트너 HTTPS + 서명키 발급/회전 + 실제 승인 미디어 제공
- [ ] YouTube 기존 영상 링크 ↔ 파트너 제공 비트스트림의 프레임/오디오 내용 동일성 별도 확인
- [ ] 실제 CDN ↔ Electron 앱 전체 E2E: 조회 → 서명 → 다운로드 → 원본 매핑 → 클립 3개 → 저장/재열기
- [ ] 라이선스 철회, 파트너 URL 만료/갱신, 키 회전, 동영상 삭제, 재게시 권리 변경 처리
- [ ] Windows/macOS 패키징/방화벽/네트워크 장애 테스트

**현재 구현은 이용허가된 파트너 카탈로그 프로토콜의 동작 기반이지, 일반 YouTube 공개 링크를 변환하는 범용 서비스가 아닙니다.**

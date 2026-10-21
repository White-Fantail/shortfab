# ADR-0002: Electron Phase 0 프로토타입

- Date: 2026-10-22
- Status: **실험용 구현 채택 / 최종 데스크톱 스택 결정 보류**

## 의도

처음부터 SaaS 업로드/AI에 의존하지 않고 로컬 파일→In/Out→9:16 MP4를 확인한다. React + Vite + TypeScript 인터페이스, Electron 메인/격리 프리로드, ffprobe/FFmpeg 하위 프로세스를 최소 구현으로 구성한다.

## 실험의 제약

1. FFmpeg/FFprobe는 현재 사용자가 설치한 PATH 바이너리를 사용한다. FFmpeg 라이선스·OS별 패키징 해결로 간주하지 않는다.
2. Electron은 **벤치마크 후보**다. Tauri 대비 크기/메모리, GPU 가속, macOS/Windows 코드서명, 네이티브 API, 프록시 성능은 아직 측정하지 않았다.
3. renderer는 실제 소스 경로나 셸 명령을 전달할 수 없고, sourceId/시간 범위/지원 해상도만 IPC로 전달한다.
4. 1차 프리뷰는 HTML5 비디오의 중앙 `object-fit: cover` 크롭이다. 회전 영상, VFR, 오디오 싱크, 프레임 정확도는 통합 검증 후 보완한다.
5. YouTube는 공식 플레이어로만 탐색하며 URL 미디어 다운로드에 의존하지 않는다.

## 승인 게이트

최소 두 운영체제 패키징 스모크, 동일 샘플 출력, 취소·실패 복원, macOS/Windows 배포 바이너리 정책 확인 후 최종 선택을 기록한다.

상위 결정: [ADR-0001](0001-local-first-hybrid.md). 개발 명령: [DEVELOPMENT.md](../DEVELOPMENT.md).

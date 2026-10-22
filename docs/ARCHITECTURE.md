# ShortFab 아키텍처 v2.0 — AI 단계별 쇼츠 제작

- 2026-10-22 기준 **목표 설계**. 현재 구현 완료와 구분한다.
- 제품 정의: [PRODUCT_BLUEPRINT](PRODUCT_BLUEPRINT.md) · 상태: [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md) · 실행 순서: [ROADMAP](ROADMAP.md).
- 현재 Electron + React/TypeScript, 로컬 프로젝트 JSON, IFrame, 개인용 yt-dlp/FFmpeg, Whisper STT 연결 및 YouTube OAuth 코드를 **교체하지 않고 단계적으로 확장**한다.

## 1. 시스템 경계

    React Wizard UI (8 steps / preview / Advanced Edit)
         │
         ├── Project/Workflow State Store (local, atomic, versioned)
         ├── AI Orchestrator (analysis, proposals, retries, cancel)
         │    ├── Source Analyzer (meta, audio/STT, scene metadata)
         │    ├── Clip Recommender (heuristics + optional LLM)
         │    ├── Layout Planner (scene/face/speaker)
         │    ├── Subtitle Stylist (text, timing, presets)
         │    ├── Audio Planner (narration OFF/TTS/BGM/mix)
         │    └── CTA Planner (goal and platform)
         ├── Preview Composer (proxy/real manifest)
         └── Electron main process
              ├── Source/rights resolver & personal media cache
              ├── Media worker (FFmpeg, ffprobe, whisper-cli)
              ├── Render queue & output manifest
              └── OAuth / publish queue (explicit user approval)

UI는 파일 경로·토큰·AI 키를 직접 소유하지 않는다. Electron IPC로 검증된 작업 요청/진행/결과만 주고받는다. AI 모델·TTS·장면 모델은 각기 교체 가능한 어댑터로 구성한다.

## 2. 권장 도메인 모델 (AG1 상태/AG2 전사 추천 일부 구현, 후속 AI 합성은 목표)

- **Project**: id, revision, name, youtubeReference?, sourceStatus, selectedClipIds, sourceAnalysisRef?, clips[], currentWizardStep, createdAt, updatedAt.
- **SourceAnalysis**: sourceHash/videoId, duration, language, transcriptSegments(start/end/text/confidence), optionalSceneSegments, speakerSegments, fingerprint, modelVersion, completedAt.
- **ClipSuggestion**: suggestionId, in/out, headline, summary, transcriptExcerpt, reasons[], signals?, generationId, generatorVersion; `score`를 노출한다면 의미와 비실측임을 명시.
- **ClipComposition**: clipId, sourceRange, steps{clip,frame,caption,audio,cta,review,export}, layoutPlan, captions, audioPlan, ctaPlan, approvedRevision, renderManifestId?.
- **StepRecord<T>**: status, proposedValue?, acceptedValue?, userOverrides/lockedPaths[], proposalVersion, acceptedAt?, sourceFingerprint, dependenciesHash, failure?, history[].
- **LayoutPlan**: ratio/resolution, sceneIntervals[{start,end,mode,crop,focusTargets,overlaySafeAreas}], manualOverrides.
- **CaptionPlan**: transcriptVersion, cues, stylePresetId/version, emphasis[], optionalHook, userTextLocks.
- **AudioPlan**: sourceGain, narration{enabled,script,voiceId,segments}, bgm{enabled,assetId/licenseRef,gain}, sfx[], ducking.
- **CTAPlan**: enabled(default false), goal, presentation(overlay/endSlate/voice/combined), text, start/end, animationPresetId, platformOverrides.
- **RenderManifest**: compositionRevision, sourceFingerprint, layout/subtitle/audio/CTA hashes, rendererVersion, outputSpec; **RenderArtifact**: manifestHash, path, duration, size, probe/QC.
- **PublishJob**: renderArtifactHash, account, platform, settings, userApprovedAt, state, remoteId?. 게시 자격은 원본 경로/권리 상태와 별도 검증.

**AG1 실제 구현:** `src/shared/wizard.ts`는 `WizardRecord`(version 1, activeStep, source, clipId별 단계 record)·`StepPlan`(status, proposalVersion, proposed, approved, lockedFields)·`SourceAnalysis`/`ClipSelection`/`RenderManifest` 기본 TypeScript 계약을 제공한다. `ProjectRecord`의 optional `wizard` 필드로 옛 schemaVersion 1 JSON을 자동 정규화하며 서버 저장 전에도 유효성을 검사한다. `reconcileWizard`는 클립 범위·제목·해상도·자막 수정 시 관련 상태만 needs_review로 바꾸며 다른 클립을 격리한다. **제안 생성·RenderManifest 출력 연동 및 상태별 비동기 job 관리, 해시 기반 그래프는 아직 구현되지 않았다.**

## 3. Step 상태 머신

`not_started → generating → proposed → accepted` 가 일반 흐름이며 `failed → generating` 재시도, `accepted → needs_review → accepted` 재승인을 허용한다. 나레이션/CTA처럼 선택 사항은 `skipped`를 허용한다.

- **proposed**: AI 후보가 준비되었으나 사용자가 승인하지 않은 상태.
- **accepted**: 사용자 승인 스냅샷과 출처·버전 기록.
- **needs_review**: 상위 입력이 바뀌어 제안은 존재하지만 다시 확인이 필요한 상태. 값을 삭제하지 않는다.
- **failed**: 작업 오류 및 재시도 가능 상태. 기존 승인 결과를 유지한다.
- **generating**: jobId/abort/dedupe key/시간/이벤트 상태가 추적되는 실제 진행 상태.
- 새 AI 초안은 **임시 버전**으로 별도 저장; 승인 전에는 output의 기존 accepted 구성을 변경하지 않는다.
- 출력이 무효라면 '최신 결과' 표시/게시 가능 상태를 해제하되 파일 자체를 사용자 동의 없이 삭제하지 않는다.

## 4. 의존성 및 무효화

| 상위 변경 | 자동 재검토 범위 | 보존 원칙 |
|---|---|---|
| YouTube URL/videoId | SourceAnalysis, clip, 모든 하위 단계 | 옛 프로젝트/클립 기록 유지, 새 소스로 명시적 전환 |
| Clip start/end | frame, caption timing/text match, audio, CTA timing, review, export | 수동 수정된 자막/오디오는 복구 가능하게 유지하고 충돌 표시 |
| Layout scene/crop | review, export (caption 안전 영역 재검사) | 자막 교정/오디오 원고 유지 |
| Caption text/timing/style | review, export, 필요한 경우 audio voice alignment | clip/layout 유지 |
| AudioPlan | review, export | 다른 단계 유지 |
| CTAPlan | review, export | 자막/화면/소리 설정 유지 |
| Export spec | export/QC만 | AI 추천 및 편집 유지 |

해시 기반 dependency graph로 최소 무효화한다. 편집 폼에서 값이 일시적으로 유효하지 않으면 자동 저장/렌더 전 단계에서 명확하게 처리하며 기존 값이 날아가지 않도록 Draft와 Accepted를 분리한다.

## 5. AI 파이프라인 계약

1. **Source ingest**: URL 정규화→title/duration/권한/소스 준비. IFrame 탐색, 개인용 공개 영상 yt-dlp 캐시(접근 가능할 때), 허가 소스 YF-1/2 옵션. 모든 URL에 대해 성공을 보장하지 않는다.
2. **Analyze**: audio extraction→whisper.cpp transcriptSegments + optional scene/speaker data. sourceFingerprint+modelVersion+config로 분석 캐시.
3. **Recommend clips**: rule-based valid candidates + optional LLM re-ranking/explanations. 모델 출력 타임코드/중복/침묵/과장된 사실 확인을 서버/메인 프로세스에서 검증.
4. **Compose frame**: 장면별 layoutPlan, 크롭 경계, 추적 지원 여부·confidence, 프록시 시각화.
5. **Captions**: transcript to cues + typography/emphasis/Hook, 수동 교정 잠금과 스타일 버전.
6. **Audio**: 원본 우선, OFF 또는 원고 후보→사용자 승인→TTS→BGM 권리 검사→믹싱.
7. **CTA**: OFF 기본 또는 컨텐츠/목적 맞춤 문구, 기간/안전 영역 검증.
8. **Preview/Render**: 승인 Composition을 Manifest로 고정해 렌더→ffprobe/QC→아티팩트 해시 저장. 다른 설정으로 편집되면 새 Manifest 필요.
9. **Publish**: 외부 계정 권한·라이선스·artifact hash/중복 검증→OS 별도 승인→공식 API→상태 추적.

실시간/비싼 AI 요청은 멱등 key, rate/cost budget, timeout/cancel/retry를 설계한다. 'AI 기능 미설치'와 '영상 다운로드 불가'는 다른 오류 코드다. STT/LLM/remote TTS의 입력 데이터 전송은 사용자에게 고지하고 가능한 경우 로컬 모드 제공.

## 6. 프리뷰 동등성 전략

YouTube iframe은 원본 탐색용이다. **합성된 숏폼의 신뢰할 수 있는 최종 프리뷰가 아니다.** 단계 03 이후 레이아웃/자막/오디오/CTA가 필요한 경우 낮은 해상도의 동일 FFmpeg 필터 그래프 프록시를 생성·캐시해 미리보기를 일치시킨다. 빠른 레이아웃 목업은 '참고용'으로 표시하고 실제 출력 QC를 별도로 수행한다.

## 7. 권리·보안·운영

- 현행 개인용 직접 출력: 공개 YouTube 링크→yt-dlp→FFmpeg(실기 한 건 이상 성공). 사용 가능 영상 범위, 약관/재게시 권리는 **독립 조건**.
- 승인된 권리자 파일/HTTPS 원본과 서명 파트너 매핑은 선택형 고급 소스 경로. UserSourceStatus와 PublishEligibility는 분리.
- 외부 API 토큰 및 키는 OS 보안 저장소/메인 프로세스. AI 프롬프트에 키·저작권 증빙·개인 정보 불필요하게 전송 금지.
- 렌더/AI 작업 취소·재시도와 회복 가능 저장, 소스 캐시/임시 파일 수명 관리 및 디스크 할당량 제한.
- 실제 SNS 게시 전 계정, 렌더 최신성, 권리·승인·플랫폼 API 조건 검증. 업로드 완료와 플랫폼 처리 완료 분리.

## 8. 구현/테스트 순서

AG1 Wizard/StepRecord 마이그레이션 → AG2 STT/ClipRecommender → AG3 LayoutPlan/프록시 → AG4 captions → AG5 audio → AG6 CTA/Review → AG7 MP4/게시/실사용. 단위: 상태 머신·invalidations·잠금/재생성·타임코드·FFmpeg manifest. 통합: 옛 저장 프로젝트, 다중 후보 3개, 모드 전환, 취소/재열기, 출력 프리뷰 일치. 실제 Mac/Windows/Google API 검증은 별도 기록.


## AG2 실제 로컬 추천기/캐시 설계 · 2026-10-22

`analysis:start`는 Electron main에서 프로젝트·videoId·IFrame 길이·모델 유효성을 검증하고 분석 작업 잠금을 건다. `AnalyzeVideoTask`는 개인용 yt-dlp의 기존 원본 다운로드/캐시를 사용하므로 renderer에 파일 시스템 경로를 전달하지 않는다. FFprobe로 오디오 유무를 확인하고 9분 슬라이스를 로컬 FFmpeg로 16kHz mono PCM 추출, `whisper-cli` SRT 전사를 재사용한다. `parseAnalysisSrt`는 타임코드를 원본 절대 초로 변환하고 데이터 범위를 검증한다. 진행/취소 이벤트는 IPC로 전달하며 실패 시 이전 클립·전사 캐시는 보존한다.

전사 결과는 `userData/analysis` 내 모델 경로+파일 메타데이터 해시/언어/영상 ID/분석 버전이 다른 별도 JSON으로 저장한다. 현재 `ClipAnalysis`는 원본 길이, 실제 분석 범위, 전사 segments, 추천 candidates, 로컬 랭킹 근거, 모델 fingerprint를 포함한다. `recommendClips`는 여러 문장을 9~60초 후보로 결합하고 유효성/겹침/말 밀집/질문·반전 표현으로 우선순위를 매긴다. **LLM 기반 서술·관심도 예측은 현재 적용되지 않는다.** 최초 60분까지 전사하며 짧은 오디오/무음은 추천 개수를 강제하지 않는다. 명시적 새 분석 외엔 캐시된 실제 전사를 재사용한다.

Clip 추천 후보는 프로젝트에 추가할 때에만 `ProjectClip`으로 바뀌고 `WizardRecord.clips[clipId].steps.clips.proposed` 메타데이터로 제안 버전을 기록한다. 기존 수동 수정/승인 필드는 재추천할 때 변경되지 않는다. 추천 카드/선택은 UI의 임시 상태, 재열기 시 추천 후보는 별도 캐시에서 로드한다. Clip 승인·출력은 기존 권리/게시 분리 정책을 그대로 지킨다.


## AG3 선택형 Style Registry / 정지 프레임 시안 / FFmpeg

`src/shared/layout-styles.ts`의 선언형 `LayoutStyle`(고정 ID + 0..100 focus)과 `LAYOUT_STYLES` 4종이 `ProjectClip.layout`에 기록된다. legacy clip은 중앙 크롭 50%로 정규화한다. 변경되면 `reconcileWizard`가 해당 클립의 layout/review/export만 재검토 처리한다.

`StyleGallery`는 카드 스크롤/탭 선택을 담당한다. 원본 YouTube 썸네일은 참고 이미지이며, 필요 시 Electron `preview:frame` 요청을 통해 선택 클립 시점의 FFmpeg JPEG 프레임을 최대 900KB로 생성한다. 이미지/실제 프레임 캐시 상태는 renderer 임시 상태이고, 파일 절대 경로는 절대로 전달되지 않는다. 사용자가 취소할 수 있으며 해당 프레임은 **움직이는 동영상 합성 프리뷰가 아니다**.

`RenderTask`는 저장된 `LayoutStyle`로 동일한 `layoutFilter`를 적용한다. 크롭은 `scale/crop/setsar/fps`, 원본 전체 보기는 `split + blur background + contain foreground + overlay` 복합 FFmpeg 필터 그래프로 렌더한다. ASS 자막은 단일/복합 필터 경로에 모두 합성된다. 선택한 layout의 시그니처를 artifact에 기록하여 `YouTubePublisher.start` privileged 검증에서 스타일 변경 후 오래된 MP4 게시를 막는다. AG4 자막은 별도 기본 4종 ASS 스타일을 동일 Gallery로 선택한다.

**향후 확장:** 스타일 ID + 버전 + 렌더 실행 선언/검증 + 예제 + 회귀 픽스처 + 호환성 정책을 가진 정식 remote style catalog, 실제 짧은 proxy MP4 프리뷰, Trend Studio 원격 업데이트/롤백. 현재 고정 스타일 4종과 정적 카드만 실제 구현이다.

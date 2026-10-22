import type { ProjectClip, ProjectEdits } from './shared/projects';
import { StyleGallery } from './StyleGallery';
import { layoutDefault, validateLayout, type LayoutStyleId } from './shared/layout-styles';
import type { SubtitlePreset } from './shared/subtitles';
import { WIZARD_STEPS, stepPlan, type WizardFields, type WizardRecord, type WizardStep } from './shared/wizard';
import type { RenderProgress } from './shared/contracts';
import type { SttLanguage, SttStatus } from './shared/stt';
import type { AnalyzeProgress, ClipAnalysis, ClipRecommendation, RecommendationMode } from './shared/recommendations';

export const WIZARD_LABELS: Record<WizardStep, string> = {
  source: '원본', clips: '클립', layout: '화면', subtitles: '자막',
  audio: '소리', cta: 'CTA', review: '검토', export: '출력',
};
const statusLabel = {
  not_started: '시작 전', generating: '분석 중', proposed: '제안 도착',
  accepted: '승인됨', needs_review: '다시 확인', failed: '재시도 필요', skipped: '건너뜀',
};
const optional = new Set<WizardStep>(['subtitles', 'audio', 'cta']);
const time = (seconds: number) => {
  const n = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
};

type Props = {
  wizard: WizardRecord;
  frameImage: string | null;
  frameBusy: boolean;
  frameError: string;
  onLoadFrame: () => void;
  onCancelFrame: () => void;
  analysis: ClipAnalysis | null;
  analysisBusy: boolean;
  analysisProgress: AnalyzeProgress | null;
  analysisError: string;
  analysisLanguage: SttLanguage;
  onAnalysisLanguage: (language: SttLanguage) => void;
  onAnalyze: (mode: RecommendationMode, refresh: boolean) => void;
  onCancelAnalysis: () => void;
  selectedRecommendationIds: string[];
  onToggleRecommendation: (id: string) => void;
  onPreviewRecommendation: (candidate: ClipRecommendation) => void;
  onAddRecommendations: () => void;
  draft: ProjectEdits;
  clip: ProjectClip | null;
  sourceDuration: number | null;
  youtubeId: string | null;
  validClip: boolean;
  validationError: string | null;
  ready: boolean;
  busy: boolean;
  rendering: boolean;
  progress: RenderProgress;
  sttSetup: SttStatus | null;
  sttBusy: boolean;
  status: string;
  error: string;
  onUrl: (value: string) => void;
  onAddClip: () => void;
  onSelectClip: (id: string, start: number) => void;
  onClip: (patch: Partial<ProjectClip>) => void;
  onGoTo: (step: WizardStep) => void;
  onAccept: (step: WizardStep, fields: WizardFields, skip?: boolean) => void;
  onAdvanced: () => void;
  onRender: () => void;
  onCancelRender: () => void;
  onTranscribe: () => void;
  onInstallModel: () => void;
};

export function WizardProgress({ wizard, clipId, onGoTo, disabled }: {
  wizard: WizardRecord; clipId: string | null; onGoTo: (step: WizardStep) => void; disabled: boolean;
}) {
  const canReach = (index: number) => WIZARD_STEPS.slice(0, index).every((step) =>
    ['accepted', 'skipped'].includes(stepPlan(wizard, clipId, step).status));
  return <nav className="wizard-steps" aria-label="제작 단계">
    {WIZARD_STEPS.map((step, index) => {
      const state = stepPlan(wizard, clipId, step).status;
      const selected = wizard.activeStep === step;
      return <button key={step} type="button" aria-current={selected ? 'step' : undefined}
        className={`wizard-step-link ${selected ? 'current' : ''} ${state === 'accepted' ? 'complete' : ''}`}
        disabled={disabled || !canReach(index)} onClick={() => onGoTo(step)}>
        <span className="wizard-step-number">{state === 'accepted' ? '✓' : index + 1}</span>
        <span>{WIZARD_LABELS[step]}</span>
        {state === 'needs_review' && <span className="wizard-review-dot" title="다시 확인 필요">!</span>}
      </button>;
    })}
  </nav>;
}

export function WizardPanel(props: Props) {
  const { wizard, clip, draft, sourceDuration, youtubeId, validClip, validationError,
    ready, busy, rendering, progress, sttSetup, sttBusy, status, error } = props;
  const step = wizard.activeStep;
  const current = stepPlan(wizard, draft.selectedClipId, step);
  const currentIndex = WIZARD_STEPS.indexOf(step);
  const next = WIZARD_STEPS[currentIndex + 1];
  const clips = draft.clips.filter((item) => item.source === 'youtube');
  const disabled = busy || rendering || props.analysisBusy || props.frameBusy;
  const sourceValid = Boolean(youtubeId && sourceDuration !== null && sourceDuration > 0);
  const canAccept = step === 'source' ? sourceValid :
    Boolean(clip && validClip && !validationError);
  const navigate = (target: WizardStep) => props.onGoTo(target);
  const approve = (skip = false) => {
    const fields: WizardFields = {};
    if (step === 'source') { fields.videoId = youtubeId; fields.duration = sourceDuration; }
    if (clip) {
      fields.clipId = clip.id;
      if (step === 'clips') { fields.start = clip.start; fields.end = clip.end; }
      if (step === 'layout') { fields.width = clip.width; fields.style = validateLayout(clip.layout).id; fields.focus = validateLayout(clip.layout).focus; }
      if (step === 'subtitles') { fields.cueCount = clip.subtitles?.cues.length ?? 0; fields.style = clip.subtitles?.preset ?? 'classic'; }
      if (step === 'audio') fields.originalAudio = true;
      if (step === 'cta') fields.enabled = false;
      if (step === 'review') fields.manualComposition = true;
    }
    props.onAccept(step, fields, skip);
  };
  return <section className="wizard-panel" aria-label={`${WIZARD_LABELS[step]} 단계`}>
    <div className="wizard-panel-heading">
      <span className="eyebrow">STEP {String(currentIndex + 1).padStart(2, '0')} / 08 · {statusLabel[current.status]}</span>
      <h1>{{
        source: '어떤 영상으로 만들까요?', clips: '쇼츠에 넣을 장면을 고르세요',
        layout: '세로 화면을 정하세요', subtitles: '자막을 확인하세요',
        audio: '소리를 결정하세요', cta: '마무리 CTA를 선택하세요',
        review: '최종 구성을 확인하세요', export: 'MP4를 완성하세요',
      }[step]}</h1>
    </div>

    {step === 'source' && <>
      <label htmlFor="wizard-url">YouTube 영상 URL</label>
      <input id="wizard-url" type="url" placeholder="https://www.youtube.com/watch?v=…"
        value={draft.youtubeUrl} disabled={disabled} onChange={(event) => props.onUrl(event.target.value)} />
      {draft.youtubeUrl && !youtubeId && <p className="warning" role="alert">올바른 YouTube 링크를 입력하세요.</p>}
      <div className="wizard-insight">
        <strong>{sourceValid ? '✓ 영상 길이 확인' : '영상 정보 확인 대기'}</strong>
        <p>{sourceValid ? `영상 길이 ${time(sourceDuration!)} · 원본 YouTube 플레이어에서 재생할 수 있습니다.` :
          '링크를 넣으면 오른쪽에서 원본을 확인할 수 있습니다. 영상 길이를 불러온 뒤 다음 단계로 이동하세요.'}</p>
        <small>원본을 확인하고 다음 단계에서 로컬 음성 분석·추천 후보를 생성할 수 있습니다. Whisper 모델과 yt-dlp가 준비되어 있어야 합니다.</small>
      </div>
      <p className="hint">개인용 MP4 익스포트에는 yt-dlp와 FFmpeg가 필요합니다. 원본 사용 권리와 플랫폼 약관은 별도로 확인하세요.</p>
    </>}

    {step === 'clips' && <>
      <div className="wizard-insight">
        <strong>원본 대사 분석 → 클립 자동 추천</strong>
        <p>Whisper.cpp로 실제 음성을 로컬 전사한 뒤 문장 경계·질문·대사 밀도를 기준으로 쇼츠 후보를 추천합니다. 인기 점수나 인물 인식은 제공하지 않습니다.</p>
        {sourceDuration !== null && sourceDuration > 3600 &&
          <small>길이가 긴 영상은 최초 60분까지만 분석합니다. 나머지는 수동 탐색을 이용하세요.</small>}
      </div>
      <div className="wizard-analysis-controls">
        <label htmlFor="analysis-language">음성 언어</label>
        <select id="analysis-language" value={props.analysisLanguage} disabled={disabled}
          onChange={(event) => props.onAnalysisLanguage(event.target.value as SttLanguage)}>
          <option value="auto">자동 감지</option>
          <option value="ko">한국어</option>
          <option value="en">English</option>
        </select>
        <button className="primary full" type="button" disabled={disabled || !sourceValid ||
          !sttSetup?.engineAvailable || !sttSetup.modelAvailable}
          onClick={() => props.onAnalyze('balanced', false)}>
          {props.analysisBusy ? '실제 음성 분석 중…' : props.analysis ? '저장된 음성으로 다시 추천' : 'AI 음성 분석 · 클립 자동 추천'}
        </button>
        {props.analysisBusy && <>
          <div className="progress-head"><span>{props.analysisProgress?.message ?? '분석 준비 중…'}</span>
            <strong>{props.analysisProgress?.percent ?? 0}%</strong></div>
          <div className="progress-track"><div style={{ width: `${props.analysisProgress?.percent ?? 0}%` }} /></div>
          <button type="button" className="cancel full" onClick={props.onCancelAnalysis}>분석 취소</button>
        </>}
        {(!sttSetup?.engineAvailable || !sttSetup?.modelAvailable) && <>
          <p className="hint">로컬 Whisper.cpp와 다국어 GGML 모델이 필요합니다. Mac: <code>brew install whisper.cpp ffmpeg yt-dlp</code>. 영상/대사 내용은 외부 AI 서비스로 전송하지 않습니다.</p>
          {!sttSetup?.modelAvailable && <button type="button" className="secondary full" disabled={disabled}
            onClick={props.onInstallModel}>기본 Whisper 다국어 모델 설치</button>}
        </>}
        {props.analysisError && <p className="warning" role="alert">{props.analysisError}</p>}
      </div>
      {props.analysis && <>
        <div className="wizard-recommend-heading">
          <strong>{props.analysis.candidates.length}개 대사 기반 추천 후보</strong>
          <small>{props.analysis.analyzedSeconds < props.analysis.duration ?
            '최초 60분 분석' : '원본 분석'} · {props.analysis.segments.length}개 전사 구간 · {props.analysis.language}</small>
        </div>
        {props.analysis.note && <p className="hint">{props.analysis.note}</p>}
        {!!props.analysis.candidates.length && <>
          <div className="wizard-rerank">
            <button type="button" disabled={disabled} className={props.analysis.mode === 'balanced' ? 'selected' : ''}
              onClick={() => props.onAnalyze('balanced', false)}>추천 다시 보기</button>
            <button type="button" disabled={disabled} className={props.analysis.mode === 'shorter' ? 'selected' : ''}
              onClick={() => props.onAnalyze('shorter', false)}>더 짧게</button>
            <button type="button" disabled={disabled} className={props.analysis.mode === 'energetic' ? 'selected' : ''}
              onClick={() => props.onAnalyze('energetic', false)}>더 역동적으로</button>
            <button type="button" disabled={disabled} onClick={() => props.onAnalyze(props.analysis!.mode, true)}>원본 재분석</button>
          </div>
          <div className="wizard-suggestion-list" aria-label="자동 추천된 클립 후보">
            {props.analysis.candidates.map((candidate, index) => <article key={candidate.id} className="wizard-suggestion-card">
              <label className="wizard-suggestion-select">
                <input type="checkbox" disabled={disabled} checked={props.selectedRecommendationIds.includes(candidate.id)}
                  onChange={() => props.onToggleRecommendation(candidate.id)} />
                <strong>추천 {index + 1} · {candidate.title}</strong>
              </label>
              <div className="wizard-suggestion-meta">
                <span>{time(candidate.start)} – {time(candidate.end)} · {time(candidate.end - candidate.start)}</span>
                <button type="button" disabled={disabled} onClick={() => props.onPreviewRecommendation(candidate)}>▶ 이 구간 보기</button>
              </div>
              <p className="wizard-transcript">“{candidate.transcript}”</p>
              <p className="hint">추천 이유: {candidate.reason}</p>
            </article>)}
          </div>
          <button type="button" className="primary full" disabled={disabled || !props.selectedRecommendationIds.length ||
            clips.length >= 100} onClick={props.onAddRecommendations}>
            선택한 {props.selectedRecommendationIds.length}개 후보를 클립으로 추가
          </button>
        </>}
      </>}
      <div className="section-rule" />
      <p className="eyebrow">직접 선택 (분석 실패·무음 영상 대안)</p>
      <button className="secondary full" type="button" disabled={disabled || !sourceValid || clips.length >= 100}
        onClick={props.onAddClip}>+ 현재 재생 위치에서 수동 클립 만들기</button>
      <div className="wizard-clip-list" aria-label="선택 가능한 클립">
        {clips.map((item) => <button key={item.id} type="button"
          className={`wizard-clip-card ${item.id === clip?.id ? 'active' : ''}`}
          disabled={disabled} onClick={() => props.onSelectClip(item.id, item.start)}>
          <strong>{item.title}</strong><span>{time(item.start)} → {time(item.end)} · {time(item.end - item.start)}</span>
          <small>{item.id === clip?.id ? '선택한 클립' : '클립 선택·미리보기'}</small>
        </button>)}
      </div>
      {clip && <>
        <label htmlFor="wizard-clip-title">클립 제목</label>
        <input id="wizard-clip-title" maxLength={100} value={clip.title} disabled={disabled}
          onChange={(event) => props.onClip({ title: event.target.value })} />
        <div className="wizard-range">
          <label>시작 (초)<input type="number" min={0} step={0.1} value={clip.start} disabled={disabled}
            onChange={(event) => props.onClip({ start: Number(event.target.value) })} /></label>
          <label>끝 (초)<input type="number" min={0} max={sourceDuration ?? undefined} step={0.1} value={clip.end} disabled={disabled}
            onChange={(event) => props.onClip({ end: Number(event.target.value) })} /></label>
        </div>
        {props.analysis && <div className="wizard-transcript-editor">
          <strong>실제 대사로 구간 다듬기</strong>
          <p className="hint">문장을 선택해 클립 시작 또는 끝 시점을 맞춥니다. 나머지 구간과 자막은 유지됩니다.</p>
          {props.analysis.segments.filter((segment) =>
            segment.end >= clip.start - 0.1 && segment.start <= clip.end + 0.1
          ).slice(0, 24).map((segment, index) => <div className="wizard-speech-row"
            key={`${segment.start}-${index}`}>
            <span><small>{time(segment.start)}</small> {segment.text}</span>
            <div>
              <button type="button" disabled={disabled || segment.start >= clip.end - 0.2}
                onClick={() => props.onClip({ start: segment.start })}>IN</button>
              <button type="button" disabled={disabled || segment.end <= clip.start + 0.2}
                onClick={() => props.onClip({ end: segment.end })}>OUT</button>
            </div>
          </div>)}
        </div>}
      </>}
      {!clips.length && <p className="hint">아직 선택한 클립이 없습니다. 원본 재생 위치에서 클립을 만들어 주세요.</p>}
    </>}

    {step === 'layout' && <>
      <div className="wizard-insight">
        <strong>스타일을 직접 고르세요</strong>
        <p>같은 원본으로 만든 4개 세로 화면 시안을 넘겨보고 선택합니다. 얼굴 자동 인식·트래킹 없이 선택한 프레임 위치와 배경 구성이 실제 FFmpeg 출력에 반영됩니다.</p>
      </div>
      <div className="style-frame-actions">
        <button type="button" className="secondary" disabled={!clip || disabled}
          onClick={props.onLoadFrame}>{props.frameImage ? '선택 클립 프레임 새로 가져오기' : '선택 클립의 실제 프레임으로 비교'}</button>
        {props.frameBusy && <button type="button" className="cancel" onClick={props.onCancelFrame}>프레임 불러오기 취소</button>}
        {props.frameError && <p className="warning" role="alert">{props.frameError}</p>}
      </div>
      <StyleGallery kind="layout" videoId={youtubeId} frameImage={props.frameImage}
        selected={validateLayout(clip?.layout).id} focus={validateLayout(clip?.layout).focus}
        disabled={!clip || disabled} onChoose={(id) => props.onClip({ layout: layoutDefault(id as LayoutStyleId) })} />
      {clip && validateLayout(clip.layout).id !== 'blur-fill' && <label className="wizard-focus-control">
        <span>화면 가로 중심 · {Math.round(validateLayout(clip.layout).focus)}%</span>
        <input type="range" min={0} max={100} step={1} disabled={disabled}
          value={validateLayout(clip.layout).focus} onChange={(event) =>
            props.onClip({ layout: { ...validateLayout(clip.layout), focus: Number(event.target.value) } })} />
        <small>← 원본 왼쪽 · 원본 오른쪽 →</small>
      </label>}
      <p className="eyebrow">영상 해상도</p>
      <div className="wizard-choice-grid">
        {([720, 1080] as const).map((width) => <button type="button" key={width}
          className={clip?.width === width ? 'selected' : ''} disabled={!clip || disabled}
          onClick={() => props.onClip({ width })}>{width}p <small>{width === 720 ? '빠른 출력' : 'Full HD'}</small></button>)}
      </div>
      <p className="hint">오른쪽 YouTube 플레이어는 원본 참고용입니다. 선택 클립 프레임을 가져오면 정확한 시점의 정지 이미지를 이용합니다. 실제 동영상 재생/자막 타이밍 프리뷰는 아닙니다.</p>
    </>}

    {step === 'subtitles' && <>
      <div className="wizard-insight">
        <strong>자막 스타일을 비교해 고르세요</strong>
        <p>4개의 자막 스타일을 좌우로 넘겨 보고 선택하세요. 이미 인식하거나 수정한 자막 문장과 타임코드는 스타일을 바꿔도 그대로 보존합니다.</p>
      </div>
      <div className="style-frame-actions">
        <button type="button" className="secondary" disabled={!clip || disabled}
          onClick={props.onLoadFrame}>{props.frameImage ? '선택 클립 프레임 새로 가져오기' : '선택 클립의 실제 프레임으로 비교'}</button>
        {props.frameBusy && <button type="button" className="cancel" onClick={props.onCancelFrame}>프레임 불러오기 취소</button>}
        {props.frameError && <p className="warning" role="alert">{props.frameError}</p>}
      </div>
      <StyleGallery kind="subtitle" videoId={youtubeId} frameImage={props.frameImage}
        selected={clip?.subtitles?.preset ?? 'classic'}
        sampleText={clip?.subtitles?.cues[0]?.text} disabled={!clip || disabled}
        onChoose={(id) => clip && props.onClip({
          subtitles: { preset: id as SubtitlePreset, cues: clip.subtitles?.cues ?? [] },
        })} />
      <p className="hint">{clip?.subtitles?.cues.length ?? 0}개 자막 · 실제 MP4에는 인식/입력된 자막만 합성합니다. 예시 문구는 출력하지 않습니다.</p>
      <button type="button" className="primary full"
        disabled={!clip || !validClip || !!validationError || disabled || sttBusy || !sttSetup?.engineAvailable || !sttSetup?.modelAvailable}
        onClick={props.onTranscribe}>{sttBusy ? '자동 자막 생성 중…' : '로컬 음성 인식으로 자막 생성'}</button>
      {!sttSetup?.modelAvailable && <button type="button" className="secondary full"
        disabled={disabled} onClick={props.onInstallModel}>기본 다국어 모델 설치</button>}
      <button type="button" className="secondary full" onClick={props.onAdvanced}>문장·타임코드·자막 스타일 수정 (고급 편집)</button>
    </>}

    {step === 'audio' && <div className="wizard-insight">
      <strong>원본 소리 유지</strong>
      <p>기존 MP4 출력은 원본 오디오를 보존합니다. AI 나레이션·TTS·음악 믹싱은 AG5 구현 전이므로 제공되는 것처럼 표시하지 않습니다.</p>
    </div>}
    {step === 'cta' && <div className="wizard-insight">
      <strong>CTA 없음 (OFF)</strong>
      <p>현재 출력에는 CTA 합성이 없습니다. 팔로우·구독 문구 및 엔드카드 편집은 AG6에서 추가됩니다.</p>
    </div>}
    {step === 'review' && <>
      <div className="wizard-insight">
        <strong>현재 구현 범위의 구성 검토</strong>
        <p>원본 영상 미리보기는 합성 결과가 아닙니다. 최종 렌더 동등 프리뷰와 통합 QC는 AG6에서 추가됩니다.</p>
      </div>
      <dl className="wizard-summary">
        <div><dt>선택 클립</dt><dd>{clip?.title ?? '없음'}</dd></div>
        <div><dt>구간</dt><dd>{clip ? `${time(clip.start)} – ${time(clip.end)}` : '—'}</dd></div>
        <div><dt>영상</dt><dd>{clip?.width ?? '—'}p · {validateLayout(clip?.layout).id}</dd></div>
        <div><dt>자막</dt><dd>{clip?.subtitles?.cues.length ?? 0}개 · {clip?.subtitles?.preset ?? 'classic'}</dd></div>
        <div><dt>음성·CTA</dt><dd>원본 음성 · CTA 없음</dd></div>
      </dl>
    </>}
    {step === 'export' && <>
      <div className="wizard-insight">
        <strong>{clip ? `${clip.title} · ${clip.width}p MP4` : '선택한 클립이 없습니다'}</strong>
        <p>기존에 확인된 YouTube 공개 영상→로컬 다운로드→FFmpeg 익스포트 경로를 사용합니다. 권리/업로드 승인은 별도입니다.</p>
      </div>
      <button type="button" className="primary full" disabled={!ready} onClick={props.onRender}>
        {rendering ? '출력 중…' : 'MP4 파일 출력'}</button>
      {rendering && <button type="button" className="cancel full" onClick={props.onCancelRender}>출력 취소</button>}
      <div className="progress-area"><div className="progress-head"><span>출력 진행</span><strong>{progress.percent}%</strong></div>
        <div className="progress-track"><div style={{ width: `${progress.percent}%` }} /></div></div>
      <p className="status" aria-live="polite">{status}</p>
      {error && <p className="error" role="alert">{error}</p>}
    </>}

    {validationError && step !== 'source' && <p className="warning" role="alert">수정 필요: {validationError}</p>}
    <div className="wizard-footer">
      {currentIndex > 0 && <button type="button" disabled={disabled} onClick={() => navigate(WIZARD_STEPS[currentIndex - 1])}>← 이전</button>}
      <button type="button" className="wizard-advanced" disabled={disabled} onClick={props.onAdvanced}>조금 수정 · 고급 편집</button>
      {step !== 'export' && step !== 'clips' && step !== 'layout' && step !== 'subtitles' && <button type="button" title="이 단계의 자동 추천은 후속 개발 예정입니다." disabled>다시 생성 · 준비 중</button>}
      {step !== 'export' && <>
        {optional.has(step) && <button type="button" disabled={!canAccept || disabled}
          onClick={() => approve(true)}>건너뛰기</button>}
        <button type="button" className="primary" disabled={!canAccept || disabled || !next}
          onClick={() => approve(false)}>
          {current.status === 'needs_review' ? '다시 승인하고 다음 →' : '이대로 사용하고 다음 →'}
        </button>
      </>}
    </div>
    <p className="wizard-generate-note">{step === 'clips' ? '추천은 실제 Whisper 전사와 로컬 휴리스틱으로 생성됩니다. 이미 채택·수정한 클립은 유지됩니다.' : step === 'layout' || step === 'subtitles' ? '고정 스타일 갤러리에서 선택한 값만 적용됩니다. 사용자 편집과 클립 데이터는 보존됩니다.' : '이 단계의 AI 자동 추천은 후속 개발 예정입니다. 승인한 사용자 수정값은 덮어쓰지 않습니다.'}</p>
  </section>;
}

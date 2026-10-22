import type { ProjectClip, ProjectEdits } from './shared/projects';
import { WIZARD_STEPS, stepPlan, type WizardFields, type WizardRecord, type WizardStep } from './shared/wizard';
import type { RenderProgress } from './shared/contracts';
import type { SttStatus } from './shared/stt';

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
  const disabled = busy || rendering;
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
      if (step === 'layout') fields.width = clip.width;
      if (step === 'subtitles') fields.cueCount = clip.subtitles?.cues.length ?? 0;
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
        <small>현재는 원본 탐색을 지원합니다. 전사·장면 자동 분석은 AG2에서 추가됩니다.</small>
      </div>
      <p className="hint">개인용 MP4 익스포트에는 yt-dlp와 FFmpeg가 필요합니다. 원본 사용 권리와 플랫폼 약관은 별도로 확인하세요.</p>
    </>}

    {step === 'clips' && <>
      <div className="wizard-insight">
        <strong>클립 직접 선택 · AI 추천 준비 중</strong>
        <p>AG2에서 영상 분석으로 자동 후보를 추천합니다. 지금은 오른쪽 플레이어에서 원하는 장면을 찾고 구간을 저장할 수 있습니다.</p>
      </div>
      <button className="primary full" type="button" disabled={disabled || !sourceValid || clips.length >= 100}
        onClick={props.onAddClip}>+ 현재 재생 위치에서 30초 클립 만들기</button>
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
      </>}
      {!clips.length && <p className="hint">아직 선택한 클립이 없습니다. 원본 재생 위치에서 클립을 만들어 주세요.</p>}
    </>}

    {step === 'layout' && <>
      <div className="wizard-insight">
        <strong>현재 실제 MP4 레이아웃: 9:16 중앙 크롭</strong>
        <p>인물 추적·2인 분할·장면별 자동 배치는 AG3에서 구현됩니다. 지금 승인하면 기존 중앙 크롭 방식으로 출력합니다.</p>
      </div>
      <div className="wizard-choice-grid">
        {([720, 1080] as const).map((width) => <button type="button" key={width}
          className={clip?.width === width ? 'selected' : ''} disabled={!clip || disabled}
          onClick={() => props.onClip({ width })}>{width}p <small>{width === 720 ? '빠른 출력' : 'Full HD'}</small></button>)}
      </div>
      <p className="hint">오른쪽 영상은 YouTube 원본 탐색이며, 합성된 9:16 결과가 아닙니다.</p>
    </>}

    {step === 'subtitles' && <>
      <div className="wizard-insight">
        <strong>{clip?.subtitles?.cues.length ? `자막 ${clip.subtitles.cues.length}개 · ${clip.subtitles.preset}` : '현재 자막 없음'}</strong>
        <p>기존 Whisper.cpp 전사 기능과 4종 번인 스타일을 사용할 수 있습니다. AI 추천 스타일 및 문장별 수정 화면은 AG4에서 추가됩니다.</p>
      </div>
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
        <div><dt>영상</dt><dd>{clip?.width ?? '—'}p · 9:16 중앙 크롭</dd></div>
        <div><dt>자막</dt><dd>{clip?.subtitles?.cues.length ?? 0}개</dd></div>
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
      {step !== 'export' && <button type="button" title="AI 자동 제안은 다음 단계에서 추가됩니다." disabled>다시 생성 · 준비 중</button>}
      {step !== 'export' && <>
        {optional.has(step) && <button type="button" disabled={!canAccept || disabled}
          onClick={() => approve(true)}>건너뛰기</button>}
        <button type="button" className="primary" disabled={!canAccept || disabled || !next}
          onClick={() => approve(false)}>
          {current.status === 'needs_review' ? '다시 승인하고 다음 →' : '이대로 사용하고 다음 →'}
        </button>
      </>}
    </div>
    <p className="wizard-generate-note">AI 다시 생성: 이 단계의 자동 추천기가 아직 연결되지 않았습니다. 승인한 수정값은 자동으로 덮어쓰지 않습니다.</p>
  </section>;
}

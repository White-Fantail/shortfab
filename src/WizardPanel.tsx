import { useState } from 'react';
import type { ProjectClip, ProjectEdits } from './shared/projects';
import { StyleGallery } from './StyleGallery';
import { validateLayout } from './shared/layout-styles';
import { selectShortStyle, fixedPositions, defaultFixedSlot, defaultFixedSlots, type FixedSlot, type FixedPosition } from './shared/short-styles';
import { splitNarration, type NarrationVoice } from './shared/narration';
import type { SubtitleCue } from './shared/subtitles';
import { WIZARD_STEPS, stepPlan, type WizardFields, type WizardRecord, type WizardStep } from './shared/wizard';
import type { RenderProgress } from './shared/contracts';
import type { ModelInstallProgress, SttLanguage, SttStatus } from './shared/stt';
import { ModelInstallPanel } from './ModelInstallPanel';
import type { AnalyzeProgress, ClipAnalysis, ClipRecommendation, RecommendationMode, TranscriptSegment } from './shared/recommendations';
import { repeatedSpeechWarnings, transcriptClock } from './shared/transcript-refinement';

export const WIZARD_LABELS: Record<WizardStep, string> = {
  source: '원본', clips: '클립', layout: '스타일', audio: '나레이션',
  subtitles: '자막 확인', cta: 'CTA', review: '검토', export: '출력',
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
  modelInstalling: boolean;
  modelProgress: ModelInstallProgress | null;
  modelStartedAt: number;
  modelLastByteAt: number;
  onCancelModel: () => void;
  status: string;
  error: string;
  onUrl: (value: string) => void;
  onAddClip: () => void;
  onComposition: (id: string, action: 'toggle' | 'up' | 'down') => void;
  onPlayClip: (id: string, start: number) => void;
  onSelectClip: (id: string, start: number) => void;
  onClip: (patch: Partial<ProjectClip>) => void;
  onGoTo: (step: WizardStep) => void;
  onAccept: (step: WizardStep, fields: WizardFields, skip?: boolean) => void;
  onAdvanced: () => void;
  onRender: () => void;
  onCancelRender: () => void;
  onTranscribe: () => void;
  onImportCaptions: () => void;
  hasCachedTranscript: boolean;
  onSuggestDecorations: () => void;
  captionDraftMessage: string;
  sttMessage: string;
  onSeekCaption: (seconds: number) => void;
  onUpdateCaption: (id: string, patch: Partial<SubtitleCue>) => void;
  onRemoveCaption: (id: string) => void;
  onAddCaption: () => void;
  onInstallModel: () => void;
  onPreviewTranscript: (segment: TranscriptSegment) => void;
  onSetTranscriptBoundary: (edge: 'start' | 'end', seconds: number) => void;
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
  const [clipView, setClipView] = useState<'suggestions' | 'sequence' | 'detail'>('suggestions');
  const [fixedImageError, setFixedImageError] = useState('');
  const { wizard, clip, draft, sourceDuration, youtubeId, validClip, validationError,
    ready, busy, rendering, progress, sttSetup, sttBusy, status, error } = props;
  const step = wizard.activeStep;
  const current = stepPlan(wizard, draft.selectedClipId, step);
  const currentIndex = WIZARD_STEPS.indexOf(step);
  const next = WIZARD_STEPS[currentIndex + 1];
  const clips = draft.clips.filter((item) => item.source === 'youtube');
  const sequenceParts = draft.shortClipIds.map((id) => draft.clips.find((item) => item.id === id)).filter((item): item is ProjectClip => !!item);
  const sequenceSeconds = sequenceParts.reduce((total, item) => total + item.end - item.start, 0);
  const disabled = busy || rendering || props.analysisBusy || props.frameBusy;
  const sourceValid = Boolean(youtubeId && sourceDuration !== null && sourceDuration > 0);
  const transcriptRows = clip && props.analysis ? props.analysis.segments.filter((segment) =>
    segment.end >= clip.start - 0.1 && segment.start <= clip.end + 0.1
  ).slice(0, 24) : [];
  const repeatedSpeech = repeatedSpeechWarnings(transcriptRows);
  const canAccept = step === 'source' ? sourceValid : step === 'clips' ?
    Boolean(sequenceParts.length && !validationError) : Boolean(clip && validClip && !validationError);
  const navigate = (target: WizardStep) => props.onGoTo(target);
  const updateFixed = (position: FixedPosition, slot: FixedSlot) => {
    if (!clip?.style) return;
    props.onClip({ style: { ...clip.style,
      fixed: { ...defaultFixedSlots(clip.style.id), ...clip.style.fixed, [position]: slot } } });
  };
  const uploadFixedImage = async (position: FixedPosition, file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) {
      setFixedImageError('PNG, JPEG 또는 WebP 파일만 사용할 수 있으며 1MB 이하여야 합니다.');
      return;
    }
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('이미지 파일을 읽지 못했습니다.'));
        reader.readAsDataURL(file);
      });
      setFixedImageError('');
      updateFixed(position, { kind: 'image', dataUrl, scale: 100 });
    } catch (error) {
      setFixedImageError(error instanceof Error ? error.message : '이미지 불러오기 오류');
    }
  };
  const approve = (skip = false) => {
    const fields: WizardFields = {};
    if (step === 'source') { fields.videoId = youtubeId; fields.duration = sourceDuration; }
    if (clip) {
      fields.clipId = clip.id;
      if (step === 'clips') { fields.start = clip.start; fields.end = clip.end; fields.partCount = sequenceParts.length; fields.duration = sequenceSeconds; }
      if (step === 'layout') { fields.width = clip.width; fields.style = clip.style?.id ?? 'legacy'; fields.focus = validateLayout(clip.layout).focus; }
      if (step === 'subtitles') { fields.cueCount = clip.subtitles?.cues.length ?? 0; fields.style = clip.subtitles?.preset ?? 'classic'; fields.hook = !!clip.subtitles?.hook; fields.emphasisCount = clip.subtitles?.cues.filter(item => item.emphasis).length ?? 0; }
      if (step === 'audio') { fields.mode = clip.narration?.mode ?? 'off'; fields.voice = clip.narration?.voice ?? 'ko'; }
      if (step === 'cta') fields.enabled = false;
      if (step === 'review') fields.manualComposition = true;
    }
    props.onAccept(step, fields, skip);
  };
  return <section className="wizard-panel" aria-label={`${WIZARD_LABELS[step]} 단계`}>
    <div className="wizard-panel-heading">
      <span className="eyebrow">STEP {String(currentIndex + 1).padStart(2, '0')} / 08 · {statusLabel[current.status]}</span>
      <div className="wizard-heading-row">
        <h1>{{
          source: '어떤 영상으로 만들까요?', clips: '쇼츠에 넣을 장면을 고르세요',
          layout: '쇼츠 스타일을 고르세요', subtitles: '대사가 자막으로 나오는지 확인하세요',
          audio: '나레이션을 추가할까요?', cta: '마무리 CTA를 선택하세요',
          review: '최종 구성을 확인하세요', export: 'MP4를 완성하세요',
        }[step]}</h1>
        <details className="wizard-help-badge">
          <summary aria-label="단계 설명 열기">ⓘ 설명</summary>
          <p>{{
            source: 'YouTube URL을 입력하면 영상을 확인하고 클립을 추천받을 수 있습니다.',
            clips: '원본에서 여러 장면을 골라 쇼츠 순서대로 조립합니다.',
            layout: '화면 구도, 자막, 고정 영역을 카드로 비교합니다.',
            audio: '원본 음성을 유지하거나 추가 나레이션을 만들고 고정 영역의 내용을 설정합니다.',
            subtitles: '자동 생성한 대사를 교정하거나 TTS 원고와 자막을 연결합니다.',
            cta: '현재 버전의 CTA 합성은 미지원입니다.',
            review: '선택한 장면과 설정을 확인합니다.',
            export: '확정된 장면을 하나의 MP4로 출력합니다.',
          }[step]}</p>
        </details>
      </div>
    </div>

    {step === 'source' && <>
      <label htmlFor="wizard-url">YouTube 영상 URL</label>
      <input id="wizard-url" type="url" placeholder="https://www.youtube.com/watch?v=…"
        value={draft.youtubeUrl} disabled={disabled} onChange={(event) => props.onUrl(event.target.value)} />
      {draft.youtubeUrl && !youtubeId && <p className="warning" role="alert">올바른 YouTube 링크를 입력하세요.</p>}
      <details className="wizard-insight wizard-collapsible"><summary>{sourceValid ? '✓ 영상 길이 확인' : '영상 정보 확인 대기'}</summary>
        <p>{sourceValid ? `영상 길이 ${time(sourceDuration!)} · 원본 YouTube 플레이어에서 재생할 수 있습니다.` :
          '링크를 넣으면 오른쪽에서 원본을 확인할 수 있습니다. 영상 길이를 불러온 뒤 다음 단계로 이동하세요.'}</p>
        <small>원본을 확인하고 다음 단계에서 로컬 음성 분석·추천 후보를 생성할 수 있습니다. Whisper 모델과 yt-dlp가 준비되어 있어야 합니다.</small>
      </details>
      <p className="hint">개인용 MP4 익스포트에는 yt-dlp와 FFmpeg가 필요합니다. 원본 사용 권리와 플랫폼 약관은 별도로 확인하세요.</p>
    </>}

    {step === 'clips' && <>
      <div className="wizard-short-summary" aria-live="polite">
        <strong>이번 쇼츠 · {sequenceParts.length}개 장면 · {time(sequenceSeconds)}</strong>
        <details className="wizard-help-badge"><summary>ⓘ 구성 안내</summary>
          <p>하나의 원본에서 여러 구간을 골라 순서대로 연결합니다. 편집 클립을 바꿔도 재생 순서는 유지됩니다.</p>
        </details>
      </div>
      <div className="wizard-clip-toolbar"><div className="wizard-clip-tabs" role="tablist" aria-label="클립 작업 전환">
        {([
          ['suggestions', '추천 클립'],
          ['sequence', `쇼츠 구성 (${sequenceParts.length})`],
          ['detail', '클립 상세'],
        ] as const).map(([id, label]) => <button type="button" key={id} role="tab"
          aria-selected={clipView === id} className={clipView === id ? 'active' : ''}
          disabled={disabled && clipView !== id}
          onClick={() => setClipView(id)}>{label}</button>)}
      </div>
        <details className="wizard-help-badge wizard-clip-help"><summary aria-label="선택한 탭 설명">ⓘ</summary>
          <p>{clipView === 'suggestions' ? '분석된 대사에서 클립 후보를 선택합니다. 언제든 수동으로 장면을 추가할 수도 있습니다.' :
            clipView === 'sequence' ? '위에서 아래로 재생합니다. ▶ 재생으로 각 장면을 확인하고 ▲▼로 순서를 변경할 수 있습니다.' :
            '선택한 장면의 제목과 IN/OUT, 원본 대사 경계를 수정합니다.'}</p>
        </details>
      </div>
      <div className="wizard-clip-scroll" role="tabpanel" aria-label={clipView === 'suggestions' ? '추천 클립' : clipView === 'sequence' ? '쇼츠 구성' : '클립 상세'}>
        {clipView === 'suggestions' && <>
      <details className="wizard-insight wizard-collapsible"><summary>원본 대사 분석 → 클립 자동 추천</summary>
        <p>Whisper.cpp로 실제 음성을 로컬 전사한 뒤 문장 경계·질문·대사 밀도를 기준으로 쇼츠 후보를 추천합니다. 인기 점수나 인물 인식은 제공하지 않습니다.</p>
        {sourceDuration !== null && sourceDuration > 3600 &&
          <small>길이가 긴 영상은 최초 60분까지만 분석합니다. 나머지는 수동 탐색을 이용하세요.</small>}
      </details>
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
          <ModelInstallPanel installed={!!sttSetup?.modelAvailable}
            installing={props.modelInstalling} progress={props.modelProgress}
            startedAt={props.modelStartedAt} lastByteAt={props.modelLastByteAt}
            disabled={disabled} onInstall={props.onInstallModel}
            onCancel={props.onCancelModel} />
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
            clips.length >= 100} onClick={() => { props.onAddRecommendations(); setClipView('sequence'); }}>
            선택한 {props.selectedRecommendationIds.length}개 후보를 클립으로 추가
          </button>
        </>}
      </>}

          <p className="wizard-inline-label">직접 선택</p>
          <button className="secondary full" type="button" disabled={disabled || !sourceValid || clips.length >= 100}
            onClick={() => { props.onAddClip(); setClipView('sequence'); }}>+ 현재 재생 위치에서 수동 클립 만들기</button>

        </>}
        {clipView === 'sequence' && <>
          <div className="wizard-clip-section-heading"><strong>쇼츠 재생 순서</strong></div>
          <div className="wizard-assembly-list" aria-label="최종 쇼츠 재생 순서">
            {sequenceParts.map((item, index) => <article className="wizard-assembly-item" key={item.id}>
              <span className="wizard-assembly-number">{index + 1}</span>
              <div className="wizard-assembly-info">
                <strong>{item.title}</strong>
                <small>{time(item.start)} → {time(item.end)} · 장면 {time(item.end - item.start)}</small>
              </div>
              <div className="wizard-assembly-actions">
                <button type="button" aria-label={`${item.title} 앞으로 이동`} disabled={disabled || index === 0}
                  onClick={() => props.onComposition(item.id, 'up')}>▲</button>
                <button type="button" aria-label={`${item.title} 뒤로 이동`} disabled={disabled || index === sequenceParts.length - 1}
                  onClick={() => props.onComposition(item.id, 'down')}>▼</button>
                <button type="button" disabled={disabled} onClick={() => props.onPlayClip(item.id, item.start)}
                  aria-label={`${item.title} 재생`}>▶ 재생</button>
                <button type="button" disabled={disabled}
                  onClick={() => { props.onSelectClip(item.id, item.start); setClipView('detail'); }}>상세 편집</button>
                <button type="button" disabled={disabled} onClick={() => props.onComposition(item.id, 'toggle')}>제외</button>
              </div>
            </article>)}
            {!sequenceParts.length && <p className="hint">아직 쇼츠에 포함된 장면이 없습니다. 추천 후보를 추가하거나 아래에서 수동 클립을 만드세요.</p>}
          </div>
          <div className="wizard-clip-section-heading"><strong>보관한 클립</strong></div>
          <div className="wizard-clip-library">
            {clips.filter((item) => !draft.shortClipIds.includes(item.id)).map((item) =>
              <div key={item.id} className="wizard-clip-library-item">
                <span>{item.title} · {time(item.end - item.start)}</span>
                <button type="button" disabled={disabled ||
                  (sequenceParts.length > 0 && sequenceParts[0].source !== item.source)}
                  onClick={() => props.onComposition(item.id, 'toggle')}>+ 쇼츠에 포함</button>
                <button type="button" disabled={disabled}
                  onClick={() => { props.onSelectClip(item.id, item.start); setClipView('detail'); }}>수정</button>
              </div>)}
          </div>
          <button className="secondary full" type="button" disabled={disabled || !sourceValid || clips.length >= 100}
            onClick={props.onAddClip}>+ 현재 위치에서 장면 추가</button>

        </>}
        {clipView === 'detail' && <>
          <div className="wizard-clip-section-heading"><strong>클립 상세 편집</strong></div>
          <div className="wizard-detail-selector" aria-label="편집할 클립 선택">
            {clips.map((item) => <button type="button" key={item.id}
              className={item.id === clip?.id ? 'active' : ''} disabled={disabled}
              onClick={() => props.onSelectClip(item.id, item.start)}>{item.title}</button>)}
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
          <strong>음성 인식 결과로 시작·끝 맞추기</strong>
          <p className="hint">Whisper가 추정한 대사와 시간입니다. <b>▶ 듣기</b>로 원본을 확인하고,
            <b> IN 시작</b>은 해당 대사 시작 시각을, <b>OUT 끝</b>은 대사 종료 시각을 클립에 적용합니다.
            표시된 글은 틀릴 수 있으며 기존 자막은 바뀌지 않습니다.</p>
          <div className="wizard-transcript-current" aria-live="polite">
            <span>현재 선택 클립</span>
            <strong>{transcriptClock(clip.start)} → {transcriptClock(clip.end)}</strong>
            <small>길이 {(clip.end - clip.start).toFixed(2)}초</small>
          </div>
          {repeatedSpeech.length > 0 && <p className="wizard-transcript-warning" role="status">
            같은 문장이 {repeatedSpeech[0].count}회 연속 인식되었습니다.
            실제 반복 발화일 수도 있고 음성 인식 오류일 수도 있으니 ▶ 듣기로 확인하세요.
          </p>}
          {!transcriptRows.length && <p className="hint">이 클립 근처에 인식된 대사가 없습니다.
            위 시작·끝 시간을 직접 수정하거나 원본 영상을 재생해 확인하세요.</p>}
          {transcriptRows.map((segment, index) => {
            const atStart = Math.abs(clip.start - segment.start) < 0.05;
            const atEnd = Math.abs(clip.end - segment.end) < 0.05;
            return <div className="wizard-speech-row" key={`${segment.start}-${index}`}>
              <div className="wizard-speech-content">
                <small>{transcriptClock(segment.start)} – {transcriptClock(segment.end)}</small>
                <span>{segment.text}</span>
              </div>
              <div className="wizard-speech-actions">
                <button type="button" disabled={disabled} title="이 구간의 실제 원본 영상과 소리 확인"
                  onClick={() => props.onPreviewTranscript(segment)}>▶ 듣기</button>
                <button type="button" className={atStart ? 'marker-applied' : ''}
                  aria-pressed={atStart} title="현재 클립 시작점을 이 대사 시작 시각으로 변경"
                  disabled={disabled || segment.start >= clip.end - 0.2 + 1e-6}
                  onClick={() => props.onSetTranscriptBoundary('start', segment.start)}>
                  {atStart ? '✓ IN 시작' : 'IN 시작'}</button>
                <button type="button" className={atEnd ? 'marker-applied' : ''}
                  aria-pressed={atEnd} title="현재 클립 끝점을 이 대사 종료 시각으로 변경"
                  disabled={disabled || segment.end <= clip.start + 0.2 - 1e-6}
                  onClick={() => props.onSetTranscriptBoundary('end', segment.end)}>
                  {atEnd ? '✓ OUT 끝' : 'OUT 끝'}</button>
              </div>
            </div>;
          })}
        </div>}
      </>}

          {!clips.length && <p className="hint">먼저 추천 또는 쇼츠 구성에서 클립을 추가해 주세요.</p>}
        </>}
      </div>
    </>}

    {step === 'layout' && <>
      <details className="wizard-insight wizard-collapsible"><summary>스타일을 직접 고르세요</summary>
        <p>화면 구성과 자막 디자인을 하나로 묶은 스타일을 선택합니다. 쇼츠 구성에 포함된 모든 장면에 동일한 스타일을 적용하고, 각 장면의 대사와 타이밍은 유지합니다.</p>
      </details>
      <div className="style-frame-actions">
        <button type="button" className="secondary" disabled={!clip || disabled}
          onClick={props.onLoadFrame}>{props.frameImage ? '선택 클립 프레임 새로 가져오기' : '선택 클립의 실제 프레임으로 비교'}</button>
        {props.frameBusy && <button type="button" className="cancel" onClick={props.onCancelFrame}>프레임 불러오기 취소</button>}
        {props.frameError && <p className="warning" role="alert">{props.frameError}</p>}
      </div>
      <StyleGallery videoId={youtubeId} frameImage={props.frameImage}
        configuredStyle={clip?.style} selected={clip?.style?.id ?? null} focus={validateLayout(clip?.layout).focus}
        sampleText={clip?.narration?.mode === 'tts' ? splitNarration(clip.narration.text)[0] : clip?.subtitles?.cues[0]?.text}
        disabled={!clip || disabled} onChoose={(id) => props.onClip(selectShortStyle(id, clip?.subtitles))} />
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
      <details className="wizard-insight wizard-collapsible"><summary>선택한 스타일로 대사를 표시합니다</summary>
        <p>03 스타일 단계에서 화면과 자막 디자인을 함께 고릅니다. 여기서는 원본 음성 자막을 교정하거나 나레이션 자막을 확인합니다.</p>
      </details>
      <div className="style-frame-actions">
        <button type="button" className="secondary" disabled={!clip || disabled} onClick={props.onLoadFrame}>
          {props.frameImage ? '실제 클립 프레임 새로 가져오기' : '실제 클립 프레임에서 비교'}</button>
        {props.frameBusy && <button type="button" className="cancel" onClick={props.onCancelFrame}>불러오기 취소</button>}
        {props.frameError && <p className="warning" role="alert">{props.frameError}</p>}
      </div>
      {clip?.narration?.mode === 'tts' ? <details className="wizard-insight wizard-collapsible"><summary>나레이션 대사 → 자막 자동 연결</summary>
        <p>나레이션 음성의 문장별 길이를 측정해 출력 시 정확한 같은 문장을 자막으로 합성합니다.
          자막 문장을 바꾸려면 이전 나레이션 단계에서 원고를 수정하세요.</p>
        {splitNarration(clip.narration.text).map((sentence, index) =>
          <p key={index}>{index + 1}. {sentence}</p>)}
      </details> : <>
      <div className="wizard-caption-methods">
        <button type="button" className="primary full" disabled={!clip || disabled || sttBusy ||
          !validClip || !!validationError || !props.hasCachedTranscript} onClick={props.onImportCaptions}>
          AG2에서 분석한 실제 대사로 자막 만들기</button>
        <button type="button" className="secondary full" disabled={!clip || disabled || sttBusy ||
          !validClip || !!validationError || !sttSetup?.engineAvailable || !sttSetup.modelAvailable}
          onClick={props.onTranscribe}>{sttBusy ? '음성 인식 중…' : 'Whisper로 현재 클립 새로 전사'}</button>
        {sttBusy && <button type="button" className="cancel full"
          onClick={() => void window.shortfab?.cancelTranscription()}>음성 인식 취소</button>}
        <ModelInstallPanel installed={!!sttSetup?.modelAvailable}
          installing={props.modelInstalling} progress={props.modelProgress}
          startedAt={props.modelStartedAt} lastByteAt={props.modelLastByteAt}
          disabled={disabled} onInstall={props.onInstallModel}
          onCancel={props.onCancelModel} />
        {props.captionDraftMessage && <p role="status" className="hint">{props.captionDraftMessage}</p>}
        {props.sttMessage && <p role="status" className="hint">{props.sttMessage}</p>}
      </div>

      <section className="wizard-caption-edit" aria-label="문장 및 타임코드">
        <div className="wizard-caption-edit-title">
          <strong>문장·타임코드 교정</strong>
          <button type="button" disabled={!clip || disabled || (clip.subtitles?.cues.length ?? 0) >= 30}
            onClick={props.onAddCaption}>+ 직접 추가</button>
        </div>
        {!clip?.subtitles?.cues.length && <p className="hint">먼저 분석 대사를 가져오거나 Whisper로 인식하세요. 직접 추가도 가능합니다.</p>}
        {(clip?.subtitles?.cues ?? []).map((cue, index) => <div className="wizard-caption-row" key={cue.id}>
          <div className="wizard-caption-row-head">
            <strong>{index + 1} · {time(cue.start)}–{time(cue.end)}</strong>
            <div>
              <button type="button" disabled={disabled} onClick={() =>
                clip && props.onSeekCaption(clip.start + cue.start)}>▶ 듣기</button>
              <button type="button" disabled={disabled} onClick={() => props.onRemoveCaption(cue.id)}>삭제</button>
            </div>
          </div>
          <textarea rows={2} maxLength={100} disabled={disabled}
            aria-label={`자막 ${index + 1} 문장`} value={cue.text}
            onChange={event => props.onUpdateCaption(cue.id, { text: event.target.value })} />
          <div className="wizard-caption-timings">
            <label>IN 초<input type="number" min={0} step={0.1} disabled={disabled}
              value={cue.start} onChange={event =>
                props.onUpdateCaption(cue.id, { start: Number(event.target.value) })} /></label>
            <label>OUT 초<input type="number" min={0} max={clip ? clip.end - clip.start : undefined}
              step={0.1} disabled={disabled} value={cue.end} onChange={event =>
                props.onUpdateCaption(cue.id, { end: Number(event.target.value) })} /></label>
            <label className="wizard-caption-emphasis"><input type="checkbox" disabled={disabled}
              checked={cue.emphasis ?? false} onChange={event =>
                props.onUpdateCaption(cue.id, { emphasis: event.target.checked })} /> 강조</label>
          </div>
        </div>)}
      </section>

      <button type="button" className="secondary full" disabled={disabled} onClick={props.onAdvanced}>
        기타 자막 편집 · 고급 모드</button>
      </>}
    </>}

    {step === 'audio' && <>
      {clip?.style && fixedPositions(clip.style.id).length > 0 && <section className="wizard-fixed-editor">
        <strong>선택한 스타일의 고정 콘텐츠</strong>
        <p className="hint">영상 내내 표시됩니다. 변경하면 스타일 카드에서도 동일하게 확인할 수 있습니다.</p>
        <div className="wizard-fixed-live" aria-label="고정 콘텐츠 실시간 시안">
          <div className="wizard-fixed-live-portrait">
            {(props.frameImage || youtubeId) && <img className="style-thumb-primary" alt=""
              src={props.frameImage || `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`} />}
            {fixedPositions(clip.style.id).map((position) => {
              const slot = clip.style!.fixed?.[position] ?? defaultFixedSlot(position);
              return <span className={`style-example-fixed fixed-${position}`} key={position}
                style={slot.kind === 'text' ? { color: slot.color,
                  background: slot.background ? 'rgba(10,10,18,.82)' : 'transparent',
                  fontSize: `${Math.round(slot.size * 0.26)}px` } : undefined}>
                {slot.kind === 'text' ? slot.text : slot.dataUrl
                  ? <img alt="" src={slot.dataUrl}
                    style={{ maxWidth: `${slot.scale}%`, maxHeight: `${slot.scale}%` }} />
                  : '이미지 선택'}
              </span>;
            })}
            <span className="style-example-text">나레이션 자막 미리보기</span>
          </div>
          <small>선택된 클립에 적용되는 고정 영역 시안입니다. 실제 출력은 영상 전체 구간에 합성됩니다.</small>
        </div>
        {fixedPositions(clip.style.id).map((position) => {
          const slot = clip.style!.fixed?.[position] ?? defaultFixedSlot(position);
          return <div className="wizard-fixed-slot" key={position}>
            <div className="wizard-fixed-slot-heading"><strong>{position === 'top' ? '상단 고정 영역' : '하단 고정 영역'}</strong>
              <select aria-label={position === 'top' ? '상단 콘텐츠 종류' : '하단 콘텐츠 종류'}
                disabled={disabled} value={slot.kind}
                onChange={(event) => updateFixed(position, event.target.value === 'image'
                  ? { kind: 'image', dataUrl: '', scale: 100 } : defaultFixedSlot(position))}>
                <option value="text">텍스트</option><option value="image">이미지</option>
              </select>
            </div>
            {slot.kind === 'text' ? <>
              <label>문구<input type="text" maxLength={100} value={slot.text} disabled={disabled}
                onChange={(event) => updateFixed(position, { ...slot, text: event.target.value })} /></label>
              <div className="wizard-fixed-properties">
                <label>글자 색상<input type="color" value={slot.color} disabled={disabled}
                  onChange={(event) => updateFixed(position, { ...slot, color: event.target.value })} /></label>
                <label>크기 {slot.size}px<input type="range" min={24} max={72} step={2} value={slot.size}
                  disabled={disabled} onChange={(event) => updateFixed(position, { ...slot, size: Number(event.target.value) })} /></label>
                <label className="wizard-fixed-checkbox"><input type="checkbox" checked={slot.background}
                  disabled={disabled} onChange={(event) => updateFixed(position, { ...slot, background: event.target.checked })} /> 배경 띠</label>
              </div>
            </> : <>
              <label>이미지 (PNG/JPEG/WebP · 1MB 이하)
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled}
                  onChange={(event) => { void uploadFixedImage(position, event.target.files?.[0]); event.target.value = ''; }} />
              </label>
              <label>크기 {slot.scale}%<input type="range" min={30} max={100} step={5}
                value={slot.scale} disabled={disabled}
                onChange={(event) => updateFixed(position, { ...slot, scale: Number(event.target.value) })} /></label>
              {slot.dataUrl && <img className="wizard-fixed-preview-image" src={slot.dataUrl} alt="선택한 고정 이미지" />}
              {!slot.dataUrl && <small>이미지를 선택해야 고정 영역이 출력됩니다.</small>}
            </>}
          </div>;
        })}
        {fixedImageError && <p className="warning" role="alert">{fixedImageError}</p>}
      </section>}
      <details className="wizard-insight wizard-collapsible"><summary>원본 소리 또는 추가 나레이션</summary>
        <p>추가 나레이션을 선택하면 macOS 시스템 음성으로 읽고 원본 소리의 볼륨을 낮춰 합성합니다.
          작성한 원고의 문장이 자막으로 자동 출력됩니다. Windows용 TTS는 후속 지원입니다.</p>
      </details>
      <div className="wizard-choice-grid">
        {(['off','tts'] as const).map(mode => <button type="button" key={mode}
          className={(clip?.narration?.mode ?? 'off') === mode ? 'selected' : ''}
          disabled={!clip || disabled}
          onClick={() => props.onClip({ narration: { mode,
            text: clip?.narration?.text ?? '', voice: clip?.narration?.voice ?? 'ko' } })}>
          {mode === 'off' ? '원본 음성만 사용' : '나레이션 추가'}</button>)}
      </div>
      {clip?.narration?.mode === 'tts' && <div className="wizard-narration-editor">
        <label htmlFor="wizard-narration-text">나레이션 원고 (1,200자 이내)</label>
        <textarea id="wizard-narration-text" rows={7} maxLength={1200}
          value={clip.narration.text} disabled={disabled}
          placeholder="읽을 대사를 문장별로 입력하세요. 문장 하나가 자막 한 구간입니다."
          onChange={event => props.onClip({ narration: { ...clip.narration!, text: event.target.value } })} />
        <label htmlFor="wizard-narration-voice">시스템 음성</label>
        <select id="wizard-narration-voice" disabled={disabled} value={clip.narration.voice}
          onChange={event => props.onClip({ narration: {
            ...clip.narration!, voice: event.target.value as NarrationVoice } })}>
          <option value="ko">한국어 (macOS Yuna)</option>
          <option value="en">English (macOS Samantha)</option>
        </select>
        <p className="hint">자막은 원고에서 생성하며 합성 때 문장별 실제 음성 길이로 타이밍을 정합니다.
          원고가 클립보다 길면 출력하지 않고 길이를 조정하도록 안내합니다. 원본 음성 자막은 보존됩니다.</p>
        <p className="hint">현재 {splitNarration(clip.narration.text).length}문장 · 30문장 이하.
          글꼴·크기·위치는 03 스타일에서 선택한 디자인으로 출력됩니다.</p>
      </div>}
    </>}
    {step === 'cta' && <details className="wizard-insight wizard-collapsible"><summary>CTA 없음 (OFF)</summary>
      <p>현재 출력에는 CTA 합성이 없습니다. 팔로우·구독 문구 및 엔드카드 편집은 AG6에서 추가됩니다.</p>
    </details>}
    {step === 'review' && <>
      <details className="wizard-insight wizard-collapsible"><summary>현재 구현 범위의 구성 검토</summary>
        <p>원본 영상 미리보기는 합성 결과가 아닙니다. 최종 렌더 동등 프리뷰와 통합 QC는 AG6에서 추가됩니다.</p>
      </details>
      <dl className="wizard-summary">
        <div><dt>쇼츠 구성</dt><dd>{sequenceParts.length}개 클립 · 총 {time(sequenceSeconds)}</dd></div>
        {sequenceParts.map((item, index) => <div key={item.id}><dt>{index + 1}번째 장면</dt><dd>{item.title} · {time(item.end - item.start)}</dd></div>)}
        <div><dt>현재 편집 중</dt><dd>{clip?.title ?? '없음'}</dd></div>
        <div><dt>구간</dt><dd>{clip ? `${time(clip.start)} – ${time(clip.end)}` : '—'}</dd></div>
        <div><dt>스타일</dt><dd>{clip?.width ?? '—'}p · {clip?.style?.id ?? '기존 개별 설정'}</dd></div>
        <div><dt>자막</dt><dd>{clip?.narration?.mode === 'tts' ? `${splitNarration(clip.narration.text).length}개 · 나레이션 연결` : `${clip?.subtitles?.cues.length ?? 0}개 · 원본 대사`}</dd></div>
        <div><dt>음성·CTA</dt><dd>{clip?.narration?.mode === 'tts' ? '시스템 나레이션 + 원본 소리 낮춤' : '원본 음성'} · CTA 없음</dd></div>
      </dl>
    </>}
    {step === 'export' && <>
      <details className="wizard-insight wizard-collapsible"><summary>{sequenceParts.length ? `${sequenceParts.length}개 장면 · ${time(sequenceSeconds)} · ${sequenceParts[0].width}p MP4` : '쇼츠에 클립을 포함해 주세요'}</summary>
        <p>선택한 순서대로 하나의 세로 MP4를 생성합니다. 각 장면의 자막과 나레이션을 유지합니다. 여러 장면 MP4의 플랫폼 자동 게시 기능은 아직 지원하지 않습니다.</p>
      </details>
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
    <p className="wizard-generate-note">{step === 'clips' ? '추천은 실제 Whisper 전사와 로컬 휴리스틱으로 생성됩니다. 이미 채택·수정한 클립은 유지됩니다.' : step === 'layout' || step === 'subtitles' ? '통합 스타일을 선택하며 자막/나레이션 대사는 보존됩니다.' : '이 단계의 AI 자동 추천은 후속 개발 예정입니다. 승인한 사용자 수정값은 덮어쓰지 않습니다.'}</p>
  </section>;
}

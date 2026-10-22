import type { ProjectClip } from './projects.js';

export const WIZARD_STEPS = ['source', 'clips', 'layout', 'audio', 'subtitles', 'cta', 'review', 'export'] as const;
export type WizardStep = typeof WIZARD_STEPS[number];
export type WizardStatus = 'not_started' | 'generating' | 'proposed' | 'accepted' | 'needs_review' | 'failed' | 'skipped';
export type WizardField = string | number | boolean | null;
export type WizardFields = Record<string, WizardField>;

export interface SourceAnalysis {
  videoId: string | null;
  duration: number | null;
  transcriptAvailable: boolean;
  analyzedAt: string | null;
}
export interface ClipSelection {
  clipIds: string[];
  selectedClipId: string | null;
}
/** A proposed result is never the same object as the user's approved result. */
export interface StepPlan {
  status: WizardStatus;
  proposalVersion: number;
  proposed: WizardFields | null;
  approved: WizardFields | null;
  lockedFields: string[];
}
export interface ClipStepState {
  steps: Partial<Record<Exclude<WizardStep, 'source'>, StepPlan>>;
}
export interface WizardRecord {
  version: 1;
  activeStep: WizardStep;
  source: StepPlan;
  clips: Record<string, ClipStepState>;
}
/** Preview/export callers must snapshot real parameters, not rely on a generic AI proposal. */
export interface RenderManifest {
  projectId: string;
  clipId: string;
  source: 'youtube' | 'local';
  start: number;
  end: number;
  width: 720 | 1080;
  subtitleSignature: string;
  planVersion: number;
}

export function newStepPlan(): StepPlan {
  return { status: 'not_started', proposalVersion: 0, proposed: null, approved: null, lockedFields: [] };
}
export function newWizard(clips: Pick<ProjectClip, 'id'>[] = []): WizardRecord {
  return { version: 1, activeStep: 'source', source: newStepPlan(),
    clips: Object.fromEntries(clips.map((clip) => [clip.id, { steps: {} }])) };
}
function validFields(input: unknown): input is WizardFields {
  return input !== null && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).length <= 40 &&
    Object.entries(input).every(([key, value]) => key.length > 0 && key.length <= 64 &&
      (value === null || typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value)) ||
        (typeof value === 'string' && value.length <= 2048)));
}
function readStep(input: unknown): StepPlan {
  if (!input || typeof input !== 'object') throw new Error('제작 단계 상태가 올바르지 않습니다.');
  const plan = input as Partial<StepPlan>;
  if (!['not_started', 'generating', 'proposed', 'accepted', 'needs_review', 'failed', 'skipped'].includes(plan.status ?? '') ||
      !Number.isSafeInteger(plan.proposalVersion) || plan.proposalVersion! < 0 ||
      !(plan.proposed === null || validFields(plan.proposed)) ||
      !(plan.approved === null || validFields(plan.approved)) ||
      !Array.isArray(plan.lockedFields) || plan.lockedFields.length > 40 ||
      !plan.lockedFields.every((field) => typeof field === 'string' && field.length > 0 && field.length <= 64)) {
    throw new Error('제작 단계 데이터에 잘못된 값이 있습니다.');
  }
  return {
    ...newStepPlan(), status: plan.status === 'generating' ? 'failed' : plan.status!,
    proposalVersion: plan.proposalVersion!,
    proposed: plan.proposed ? { ...plan.proposed } : null,
    approved: plan.approved ? { ...plan.approved } : null,
    lockedFields: [...new Set(plan.lockedFields)],
  };
}
/** Migrates v1 project JSON without wizard data; interrupted generation is retryable on reopening. */
export function normalizeWizard(input: unknown, clips: Pick<ProjectClip, 'id'>[]): WizardRecord {
  if (input === undefined || input === null) return newWizard(clips);
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('제작 마법사 상태가 올바르지 않습니다.');
  const item = input as Partial<WizardRecord>;
  if (item.version !== 1 || !WIZARD_STEPS.includes(item.activeStep as WizardStep) ||
      !item.clips || typeof item.clips !== 'object' || Array.isArray(item.clips)) {
    throw new Error('지원하지 않는 제작 마법사 버전입니다.');
  }
  const stepNames = WIZARD_STEPS.slice(1);
  const normalized = newWizard(clips);
  normalized.activeStep = item.activeStep!;
  normalized.source = readStep(item.source);
  for (const clip of clips) {
    const record = item.clips[clip.id];
    if (!record) continue;
    if (!record.steps || typeof record.steps !== 'object' || Array.isArray(record.steps)) {
      throw new Error('클립 단계 상태가 올바르지 않습니다.');
    }
    for (const [name, value] of Object.entries(record.steps)) {
      if (!stepNames.includes(name as Exclude<WizardStep, 'source'>)) {
        throw new Error('알 수 없는 제작 단계입니다.');
      }
      if (value !== undefined) normalized.clips[clip.id].steps[name as Exclude<WizardStep, 'source'>] = readStep(value);
    }
  }
  return normalized;
}
export function stepPlan(wizard: WizardRecord, clipId: string | null, step: WizardStep): StepPlan {
  if (step === 'source') return wizard.source;
  return clipId ? wizard.clips[clipId]?.steps[step] ?? newStepPlan() : newStepPlan();
}
export function setStepPlan(wizard: WizardRecord, clipId: string | null, step: WizardStep, plan: StepPlan): WizardRecord {
  if (step === 'source') return { ...wizard, source: plan };
  if (!clipId || !wizard.clips[clipId]) return wizard;
  return { ...wizard, clips: { ...wizard.clips, [clipId]: {
    steps: { ...wizard.clips[clipId].steps, [step]: plan },
  } } };
}
export function acceptStep(wizard: WizardRecord, clipId: string | null, step: WizardStep, fields: WizardFields = {}): WizardRecord {
  const current = stepPlan(wizard, clipId, step);
  return setStepPlan(wizard, clipId, step, { ...current, status: 'accepted',
    approved: { ...fields }, lockedFields: [...new Set([...current.lockedFields, ...Object.keys(fields)])] });
}
export function skipStep(wizard: WizardRecord, clipId: string | null, step: WizardStep): WizardRecord {
  const current = stepPlan(wizard, clipId, step);
  return setStepPlan(wizard, clipId, step, { ...current, status: 'skipped', approved: {} });
}
/** A rerun may only update unlocked suggestions; approved values remain untouched. */
export function proposeStep(wizard: WizardRecord, clipId: string | null, step: WizardStep, fields: WizardFields): WizardRecord {
  const current = stepPlan(wizard, clipId, step);
  const proposed = { ...(current.proposed ?? {}) };
  for (const [key, value] of Object.entries(fields)) if (!current.lockedFields.includes(key)) proposed[key] = value;
  return setStepPlan(wizard, clipId, step, { ...current,
    proposalVersion: current.proposalVersion + 1, proposed,
    status: current.status === 'accepted' ? 'needs_review' : 'proposed' });
}
function stale(step: StepPlan): StepPlan {
  return (step.status === 'accepted' || step.status === 'skipped' || step.status === 'proposed')
    ? { ...step, status: 'needs_review' } : step;
}
function staleSteps(wizard: WizardRecord, clipId: string, names: Exclude<WizardStep, 'source'>[]): WizardRecord {
  return names.reduce((next, name) => {
    const current = stepPlan(next, clipId, name);
    return setStepPlan(next, clipId, name, stale(current));
  }, wizard);
}
type WizardEditable = { youtubeUrl: string; youtubeDuration: number | null; clips: ProjectClip[]; shortClipIds?: string[] };
/** Called for EVERY editor change, including Advanced Edit and STT results. */
export function reconcileWizard(wizard: WizardRecord | undefined, before: WizardEditable, after: WizardEditable): WizardRecord {
  let next = normalizeWizard(wizard, after.clips);
  if (before.youtubeUrl !== after.youtubeUrl || before.youtubeDuration !== after.youtubeDuration) {
    next = { ...next, source: stale(next.source) };
  }
  const previous = new Map(before.clips.map((clip) => [clip.id, clip]));
  for (const clip of after.clips) {
    const old = previous.get(clip.id);
    if (!old) continue;
    const rangeChanged = old.start !== clip.start || old.end !== clip.end || old.source !== clip.source;
    const widthChanged = old.width !== clip.width;
    const layoutChanged = JSON.stringify(old.layout ?? null) !== JSON.stringify(clip.layout ?? null);
    const captionsChanged = JSON.stringify(old.subtitles ?? null) !== JSON.stringify(clip.subtitles ?? null);
    const styleChanged = JSON.stringify(old.style ?? null) !== JSON.stringify(clip.style ?? null);
    const narrationChanged = JSON.stringify(old.narration ?? null) !== JSON.stringify(clip.narration ?? null);
    const nameChanged = old.title !== clip.title;
    if (rangeChanged) next = staleSteps(next, clip.id, ['clips', 'layout', 'audio', 'subtitles', 'cta', 'review', 'export']);
    else if (widthChanged || layoutChanged || styleChanged) next = staleSteps(next, clip.id, ['layout', 'subtitles', 'review', 'export']);
    else if (narrationChanged) next = staleSteps(next, clip.id, ['audio', 'subtitles', 'review', 'export']);
    else if (captionsChanged) next = staleSteps(next, clip.id, ['subtitles', 'review', 'export']);
    else if (nameChanged) next = staleSteps(next, clip.id, ['review', 'export']);
  }
  // Editing any piece of an assembled short, or reordering it, makes its
  // aggregate review/export stale. Unrelated library clips remain untouched.
  if (before.shortClipIds || after.shortClipIds) {
    const beforeIds = before.shortClipIds ?? [];
    const afterIds = after.shortClipIds ?? [];
    const orderChanged = JSON.stringify(beforeIds) !== JSON.stringify(afterIds);
    const affected = orderChanged || afterIds.some((id) =>
      JSON.stringify(before.clips.find((clip) => clip.id === id) ?? null) !==
      JSON.stringify(after.clips.find((clip) => clip.id === id) ?? null));
    if (affected) for (const id of afterIds) {
      next = staleSteps(next, id, orderChanged
        ? ['clips', 'review', 'export'] : ['review', 'export']);
    }
  }
  return next;
}

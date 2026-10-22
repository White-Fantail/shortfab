import { describe, expect, it } from 'vitest';
import {
  acceptStep, newWizard, normalizeWizard, proposeStep, reconcileWizard, setStepPlan,
  skipStep, stepPlan, type WizardRecord,
} from './wizard';
import { validateProjectEdits } from './projects';

const id1 = 'c755d938-b33a-46db-a36a-bb2f5cf4c0d1';
const id2 = 'c755d938-b33a-46db-a36a-bb2f5cf4c0d2';
const projectId = 'c755d938-b33a-46db-a36a-bb2f5cf4c0d3';
const clip = (id: string) => ({
  id, source: 'youtube' as const, title: 'A clip', start: 1, end: 15, width: 720 as const, subtitles: null,
});
const editable = (clips = [clip(id1)]) => ({
  youtubeUrl: 'https://youtu.be/abcdefghijk', youtubeDuration: 100, clips,
});

describe('AG1 wizard persistence / state contracts', () => {
  it('migrates legacy projects with independent empty clip plans', () => {
    const saved = validateProjectEdits({
      id: projectId, revision: 0, title: 'Test', ...editable([clip(id1), clip(id2)]),
      selectedClipId: id1,
    }, null);
    expect(saved.wizard?.version).toBe(1);
    expect(saved.wizard?.activeStep).toBe('source');
    expect(Object.keys(saved.wizard?.clips ?? {})).toEqual([id1, id2]);
    expect(stepPlan(saved.wizard!, id1, 'layout').status).toBe('not_started');
  });

  it('preserves accepted fields and locked changes when suggestions are regenerated', () => {
    let wizard = newWizard([clip(id1)]);
    wizard = proposeStep(wizard, id1, 'layout', { crop: 'center', zoom: 1 });
    wizard = acceptStep(wizard, id1, 'layout', { crop: 'manual', zoom: 1.2 });
    wizard = proposeStep(wizard, id1, 'layout', { crop: 'left', zoom: 2, brightness: 1 });
    expect(stepPlan(wizard, id1, 'layout')).toMatchObject({
      status: 'needs_review', proposalVersion: 2,
      approved: { crop: 'manual', zoom: 1.2 }, proposed: { crop: 'center', zoom: 1, brightness: 1 },
    });
  });

  it('invalidates only the modified clip and the affected downstream steps', () => {
    let wizard = newWizard([clip(id1), clip(id2)]);
    for (const id of [id1, id2]) for (const step of ['clips', 'layout', 'subtitles', 'audio', 'cta', 'review', 'export'] as const) {
      wizard = acceptStep(wizard, id, step);
    }
    const before = editable([clip(id1), clip(id2)]);
    const after = { ...before, clips: [{ ...clip(id1), subtitles: { preset: 'classic' as const,
      cues: [{ id: 'cue', start: 0, end: 2, text: 'hello' }] } }, clip(id2)] };
    wizard = reconcileWizard(wizard, before, after);
    expect(stepPlan(wizard, id1, 'clips').status).toBe('accepted');
    expect(stepPlan(wizard, id1, 'subtitles').status).toBe('needs_review');
    expect(stepPlan(wizard, id1, 'review').status).toBe('needs_review');
    expect(stepPlan(wizard, id1, 'export').status).toBe('needs_review');
    expect(stepPlan(wizard, id2, 'export').status).toBe('accepted');
    expect(stepPlan(wizard, id2, 'subtitles').status).toBe('accepted');
  });

  it('marks all dependent steps stale for marker changes; retains other clip statuses', () => {
    let wizard = newWizard([clip(id1), clip(id2)]);
    wizard = acceptStep(wizard, id1, 'layout', { width: 720 });
    wizard = acceptStep(wizard, id1, 'cta', { enabled: false });
    wizard = skipStep(wizard, id2, 'cta');
    const before = editable([clip(id1), clip(id2)]);
    wizard = reconcileWizard(wizard, before, { ...before, clips: [{ ...clip(id1), end: 20 }, clip(id2)] });
    expect(stepPlan(wizard, id1, 'layout').status).toBe('needs_review');
    expect(stepPlan(wizard, id1, 'cta').status).toBe('needs_review');
    expect(stepPlan(wizard, id2, 'cta').status).toBe('skipped');
  });

  it('removes deleted clip status and does not copy it to newly added clips', () => {
    let wizard = acceptStep(newWizard([clip(id1)]), id1, 'clips');
    wizard = reconcileWizard(wizard, editable(), editable([clip(id2)]));
    expect(wizard.clips[id1]).toBeUndefined();
    expect(stepPlan(wizard, id2, 'clips').status).toBe('not_started');
  });

  it('reopens saved state and turns interrupted work into retryable failure', () => {
    let wizard = acceptStep(newWizard([clip(id1)]), id1, 'clips');
    wizard = { ...wizard, activeStep: 'subtitles' };
    wizard = setStepPlan(wizard, id1, 'subtitles', {
      status: 'generating', proposalVersion: 1, proposed: null, approved: null, lockedFields: [],
    });
    const reloaded = normalizeWizard(JSON.parse(JSON.stringify(wizard)) as WizardRecord, [clip(id1)]);
    expect(reloaded.activeStep).toBe('subtitles');
    expect(stepPlan(reloaded, id1, 'clips').status).toBe('accepted');
    expect(stepPlan(reloaded, id1, 'subtitles').status).toBe('failed');
  });

  it('rejects corrupt wizard state on disk instead of trusting renderer data', () => {
    expect(() => normalizeWizard({ version: 99 }, [clip(id1)])).toThrow();
    const wizard = newWizard([clip(id1)]);
    wizard.source.approved = { unsafe: Number.POSITIVE_INFINITY };
    expect(() => normalizeWizard(wizard, [clip(id1)])).toThrow();
  });
});

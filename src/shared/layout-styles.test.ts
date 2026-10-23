import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_STYLES, layoutDefault, layoutFilter, layoutSignature, validateLayout } from './layout-styles';
import { validateProjectEdits } from './projects';
import { acceptStep, newWizard, reconcileWizard, stepPlan } from './wizard';

const clipId = 'a2c61b6b-65b2-4e98-9b13-d8dd8f8120f3';
const projectId = 'c84ac160-6a0b-4d63-bae3-3256f6e6b276';
const clip = (layout = DEFAULT_LAYOUT) => ({
  id: clipId, source: 'youtube' as const, title: 'Selected clip',
  start: 0, end: 20, width: 720 as const, layout, subtitles: null,
});
describe('AG3 selectable style catalog and export contract', () => {
  it('keeps legacy project clips centered and validates all new presets', () => {
    const legacy = validateProjectEdits({
      id: projectId, title: 'Project', revision: 0,
      youtubeUrl: 'https://youtu.be/abcdefghijk', youtubeDuration: 120,
      clips: [{ ...clip(), layout: undefined }], selectedClipId: clipId,
    }, null);
    expect(legacy.clips[0].layout).toEqual(DEFAULT_LAYOUT);
    expect(LAYOUT_STYLES).toHaveLength(4);
    for (const item of LAYOUT_STYLES) {
      const selected = layoutDefault(item.id);
      expect(validateLayout(selected)).toEqual(selected);
    }
    // Older saved project JSON has no zoom attribute.
    expect(validateLayout({ id: 'focus-left', focus: 20 })).toEqual({ id: 'focus-left', focus: 20, zoom: 1 });
  });

  it('rejects invalid, out-of-range or injected style input', () => {
    for (const input of [
      { id: 'custom::movie', focus: 20 }, { id: 'center', focus: NaN },
      { id: 'center', focus: -1 }, { id: 'center', focus: 101 },
      { id: 'center', focus: '75' }, 123,
      { id: 'center', focus: 50, zoom: 0.95 }, { id: 'center', focus: 50, zoom: 2.05 },
      { id: 'center', focus: 50, zoom: Infinity }, { id: 'center', focus: 50, zoom: '1.5' },
    ]) expect(() => validateLayout(input)).toThrow();
  });

  it('produces different output filters and a safe manual crop position', () => {
    expect(layoutFilter(720, layoutDefault('center')).graph).toContain('(iw-ow)*0.5');
    expect(layoutFilter(720, layoutDefault('focus-left')).graph).toContain('crop=720:1280:0:0');
    expect(layoutFilter(720, layoutDefault('focus-right')).graph).toContain('crop=720:1280:iw-ow:0');
    expect(layoutFilter(720, { id: 'focus-right', focus: 27 }).graph).toContain('(iw-ow)*0.27');
    const blurred = layoutFilter(720, layoutDefault('blur-fill'));
    expect(blurred.complex).toBe(true);
    expect(blurred.graph).toContain('boxblur');
    expect(blurred.graph).toContain('overlay=');
    const enlarged = layoutFilter(720, { id: 'focus-left', focus: 35, zoom: 1.5 });
    expect(enlarged.graph).toContain('scale=1080:1920:force_original_aspect_ratio=increase');
    expect(enlarged.graph).toContain('crop=720:1280:(iw-ow)*0.35:(ih-oh)/2');
    expect(layoutFilter(720, { id: 'blur-fill', focus: 50, zoom: 1.5 }).graph)
      .toContain('[front]scale=1080:1920:force_original_aspect_ratio=decrease');
    expect(layoutSignature({ id: 'center', focus: 50, zoom: 1 }))
      .not.toBe(layoutSignature({ id: 'center', focus: 50, zoom: 1.5 }));
  });

  it('isolates layout changes to the selected clip and invalidates downstream approvals', () => {
    const first = clip();
    const second = { ...clip(), id: 'a2c61b6b-65b2-4e98-9b13-d8dd8f8120f4' };
    let state = newWizard([first, second]);
    state = acceptStep(state, first.id, 'layout', { style: 'center' });
    state = acceptStep(state, first.id, 'review');
    state = acceptStep(state, first.id, 'export');
    state = acceptStep(state, second.id, 'layout');
    state = reconcileWizard(state, {
      youtubeUrl: 'https://youtu.be/abcdefghijk', youtubeDuration: 120, clips: [first, second],
    }, {
      youtubeUrl: 'https://youtu.be/abcdefghijk', youtubeDuration: 120,
      clips: [{ ...first, layout: layoutDefault('blur-fill') }, second],
    });
    expect(stepPlan(state, first.id, 'layout').status).toBe('needs_review');
    expect(stepPlan(state, first.id, 'review').status).toBe('needs_review');
    expect(stepPlan(state, first.id, 'export').status).toBe('needs_review');
    expect(stepPlan(state, second.id, 'layout').status).toBe('accepted');
    expect(layoutSignature(layoutDefault('center'))).not.toBe(layoutSignature(layoutDefault('blur-fill')));
    state = acceptStep(state, second.id, 'layout');
    state = acceptStep(state, second.id, 'review');
    const zoomed = { ...second, layout: { ...layoutDefault('center'), zoom: 1.25 } };
    const changed = reconcileWizard(state, {
      youtubeUrl: 'https://youtu.be/abcdefghijk', youtubeDuration: 120, clips: [first, second],
    }, {
      youtubeUrl: 'https://youtu.be/abcdefghijk', youtubeDuration: 120, clips: [first, zoomed],
    });
    expect(stepPlan(changed, second.id, 'layout').status).toBe('needs_review');
    expect(stepPlan(changed, second.id, 'review').status).toBe('needs_review');
  });
});

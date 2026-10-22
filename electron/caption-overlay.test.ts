import { describe, expect, it } from 'vitest';
import { captionIntervals, captionOverlayGraph } from './caption-overlay';

describe('libass-free caption image timeline', () => {
  it('preserves cue gaps and independent hook overlap', () => {
    const slices = captionIntervals({
      preset: 'boxed', cues: [
        { id: 'a', start: 0.5, end: 1.5, text: '안녕' },
        { id: 'b', start: 2, end: 3, text: 'Hello', emphasis: true },
      ], hook: { text: '시작', duration: 1, style: 'banner' },
    }, 4);
    expect(slices.map(item => [item.start, item.end])).toEqual([
      [0, .5], [.5, 1], [1, 1.5], [1.5, 2], [2, 3], [3, 4],
    ]);
    expect(slices[0].cue).toBeNull();
    expect(slices[0].hook?.text).toBe('시작');
    expect(slices[2].hook).toBeNull();
    expect(slices[4].cue?.emphasis).toBe(true);
    expect(slices[5].cue).toBeNull();
  });
  it('supports hook-only tracks and rejects invalid timing', () => {
    expect(captionIntervals({ preset: 'classic', cues: [],
      hook: { text: 'Top', duration: .8, style: 'simple' } }, 2))
      .toHaveLength(2);
    expect(() => captionIntervals({ preset: 'classic', cues: [
      { id: 'bad', start: 1, end: 5, text: 'bad' },
    ] }, 2)).toThrow();
  });
  it('composes either regular or blur layout using only one transparent overlay stream', () => {
    expect(captionOverlayGraph('fps=30', false))
      .toContain('[0:v:0]fps=30[v];[v][1:v]overlay=');
    expect(captionOverlayGraph('[0:v:0]scale=720:1280[v]', true))
      .toContain('[v][1:v]overlay=');
  });
});

import { describe, expect, it } from 'vitest';
import { validateSubtitleTrack } from './subtitles';

const value = { preset: 'boxed', cues: [
  { id: 'cue-1', start: 0, end: 1.5, text: '첫 자막' },
  { id: 'cue-2', start: 1.5, end: 3, text: 'Second line' },
] };

describe('clip-relative subtitle schema', () => {
  it('keeps captions and stable style while allowing legacy null', () => {
    expect(validateSubtitleTrack(null, 4)).toBeNull();
    expect(validateSubtitleTrack(value, 4)).toEqual(value);
  });
  it('rejects overlaps, invalid time, untrusted preset or content', () => {
    for (const input of [
      { ...value, preset: 'remote-script' },
      { ...value, cues: [{ ...value.cues[0], text: '' }] },
      { ...value, cues: [{ ...value.cues[0], end: 5 }] },
      { ...value, cues: [{ ...value.cues[0], start: -1 }] },
      { ...value, cues: [value.cues[0], { ...value.cues[1], start: 1 }] },
      { ...value, cues: [value.cues[0], { ...value.cues[0] }] },
      { ...value, cues: [{ ...value.cues[0], text: 'x'.repeat(101) }] },
    ]) expect(() => validateSubtitleTrack(input, 4)).toThrow();
  });
});

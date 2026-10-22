import { describe, expect, it } from 'vitest';
import { buildAss } from './subtitles';

describe('ASS subtitle renderer', () => {
  it('uses safe built-in styles, clip-relative timings and escaped literal text', () => {
    const ass = buildAss({ preset: 'bold', cues: [
      { id: 'id-1', start: 0.25, end: 2.5, text: '한글 {\\pos(1,1)}\nHello!' },
    ] }, 3);
    expect(ass).toContain('Dialogue: 0,0:00:00.25,0:00:02.50,Bold');
    expect(ass).toContain('한글 ｛＼pos(1,1)｝\\NHello!');
    expect(ass).toContain('PlayResY: 1280');
    expect(ass).not.toContain('{\\pos');
  });
});

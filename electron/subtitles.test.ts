import { describe, expect, it } from 'vitest';
import { buildAss } from './subtitles';

describe('ASS subtitle renderer', () => {
  it('renders a top Hook and emphasized whole cue without unsafe ASS overrides', () => {
    const ass = buildAss({
      preset: 'neon',
      cues: [
        { id: 'a', start: 0, end: 1.2, text: '정말 중요한 장면!', emphasis: true },
        { id: 'b', start: 1.2, end: 2.5, text: '다음 장면입니다.' },
      ],
      hook: { text: '왜 {이렇게} 될까요?', duration: 2, style: 'banner' },
    }, 4);
    expect(ass).toContain('Style: Neon');
    expect(ass).toContain('Style: HookBanner');
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:01.20,Emphasis');
    expect(ass).toContain('Dialogue: 0,0:00:01.20,0:00:02.50,Neon');
    expect(ass).toContain('Dialogue: 1,0:00:00.00,0:00:02.00,HookBanner');
    expect(ass).toContain('왜 ｛이렇게｝ 될까요?');
    expect(ass).not.toContain('Dialogue: 1,0:00:00.00,0:00:02.00,HookBanner,,0,0,0,,왜 {');
  });

  it('keeps hook-only subtitles in ASS even with no ordinary cues', () => {
    const ass = buildAss({ preset: 'topline', cues: [],
      hook: { text: 'Welcome', duration: 1, style: 'simple' } }, 2);
    expect(ass).toContain('Dialogue: 1,0:00:00.00,0:00:01.00,HookSimple');
  });

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

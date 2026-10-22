import { describe, expect, it } from 'vitest';
import { captionsFromAnalysis, hasTranscriptForClip, suggestSubtitleDecorations } from './caption-suggestions';
import { SUBTITLE_PRESETS, validateSubtitleTrack } from './subtitles';
import type { ClipAnalysis } from './recommendations';

const real = (lines: { start: number; end: number; text: string }[]): ClipAnalysis => ({
  videoId: 'abcdefghijk', duration: 140, analyzedSeconds: 140, language: 'ko',
  modelFingerprint: 'test-model', engineVersion: 'ag2-transcript-v1',
  generatedAt: '2026-10-22T00:00:00.000Z', segments: lines,
  candidates: [], mode: 'balanced', status: 'ready', note: null,
});
describe('AG4 transcript editing and style contract', () => {
  it('exposes eight verified styles, preserving legacy schema exactly', () => {
    expect(SUBTITLE_PRESETS).toHaveLength(8);
    const track = { preset: 'boxed', cues: [{ id: 'cue1', start: 0, end: 1.2, text: '안녕하세요' }] };
    expect(validateSubtitleTrack(track, 4)).toEqual(track);
  });
  it('copies ONLY recognized source lines to clip-relative cues, preserving time', () => {
    const source = real([
      { start: 5, end: 6.2, text: '배경 설명입니다.' },
      { start: 10.2, end: 12.5, text: '왜 이런 일이 생긴 걸까요?' },
      { start: 12.8, end: 15.1, text: '실제로 중요한 장면입니다!' },
      { start: 20, end: 21, text: '선택 구간 밖입니다.' },
    ]);
    expect(hasTranscriptForClip(source, 10, 17)).toBe(true);
    const track = captionsFromAnalysis(source, 10, 17, 'cinema');
    expect(track.preset).toBe('cinema');
    expect(track.cues).toHaveLength(2);
    expect(track.cues[0].start).toBeCloseTo(0.2);
    expect(track.cues[1].end).toBeCloseTo(5.1);
    expect(track.cues[0].text).toContain('왜 이런 일이');
    expect(track.cues.map(x => x.text).join(' ')).not.toContain('구간 밖');
  });
  it('creates opt-in real-caption Hook and a subset of highlighted lines', () => {
    const track = { preset: 'neon' as const, cues: [
      { id: 'a', start: 0, end: 1.3, text: '그냥 설명하는 내용입니다' },
      { id: 'b', start: 1.3, end: 2.4, text: '왜 이런 현상이 생겼을까요?' },
      { id: 'c', start: 2.4, end: 3.8, text: '다음 설명을 들어보세요' },
    ] };
    const proposal = suggestSubtitleDecorations(track, 4);
    expect(proposal?.hook.text).toBe(track.cues[1].text);
    expect(proposal?.hook.duration).toBe(3);
    expect(proposal?.emphasizedCueIds).toEqual(['b']);
    expect(track.cues.every(item => !('emphasis' in item))).toBe(true);
  });
  it('validates hook, emphasis and exclusive real input sizes', () => {
    const track = { preset: 'impact', cues: [{ id: 'a', start: 0, end: 2, text: 'Test', emphasis: true }],
      hook: { text: 'Why?', duration: 1.5, style: 'banner' } };
    expect(validateSubtitleTrack(track, 3)).toEqual(track);
    for (const invalid of [
      { ...track, hook: { ...track.hook, duration: 9 } },
      { ...track, hook: { ...track.hook, text: '' } },
      { ...track, hook: { ...track.hook, text: 'A'.repeat(65) } },
      { ...track, hook: { ...track.hook, style: 'fake' } },
      { ...track, cues: [{ ...track.cues[0], emphasis: 'no' }] },
    ]) expect(() => validateSubtitleTrack(invalid, 3)).toThrow();
    expect(suggestSubtitleDecorations({ preset: 'classic', cues: [] }, 3)).toBeNull();
  });
  it('never silently truncates to 30 cues when source is too dense', () => {
    const segments = Array.from({ length: 60 }, (_, i) => ({
      start: i * 1.4, end: i * 1.4 + 0.9, text: '실제 자막 중간 내용이 반복됩니다. 길고 내용이 많습니다.',
    }));
    expect(() => captionsFromAnalysis(real(segments), 0, 88, 'classic')).toThrow('최대 30개');
    expect(hasTranscriptForClip(real(segments), 120, 135)).toBe(false);
    expect(() => captionsFromAnalysis(real(segments), 120, 135, 'classic')).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  parseAnalysisSrt, recommendClips, validateAnalyzeRequest, validateTranscriptSegments,
  type TranscriptSegment,
} from './recommendations';

const sample = (count = 36): TranscriptSegment[] => Array.from({ length: count }, (_, i) => ({
  start: i * 3,
  end: i * 3 + 2.8,
  text: i % 11 === 0 ? '왜 이런 일이 생겼을까요? 실제로 놀라운 일이 일어났습니다!' :
    i % 6 === 0 ? '그런데 이 장면이 정말 중요합니다! 마지막을 보세요.' :
      '우리는 과정을 확인하고 다음 상황을 설명하는 중입니다.',
}));

describe('AG2 clip analysis contract and ranking', () => {
  it('parses real timed SRT at absolute source offsets without a 30-cue limit', () => {
    const lines = Array.from({ length: 45 }, (_, i) => [
      String(i + 1),
      `00:00:${String(i).padStart(2, '0')},000 --> 00:00:${String(i).padStart(2, '0')},800`,
      '왜 이 결과가 중요할까요?',
    ].join('\n')).join('\n\n');
    const segments = parseAnalysisSrt(lines, 540, 60);
    expect(segments).toHaveLength(45);
    expect(segments[0]).toMatchObject({ start: 540, end: 540.8 });
    expect(segments[44].start).toBe(584);
  });

  it('generates ranked transcript-dependent, non-overlapping 9–60 second candidates', () => {
    const results = recommendClips(sample(), 120);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.length).toBeLessThanOrEqual(10);
    for (const result of results) {
      expect(result.start).toBeGreaterThanOrEqual(0);
      expect(result.end).toBeLessThanOrEqual(120);
      expect(result.end - result.start).toBeGreaterThan(7.5);
      expect(result.end - result.start).toBeLessThanOrEqual(61);
      expect(result.transcript).toContain('일');
      expect(result.reason).toMatch(/대사|질문|도입부|문장/);
      expect(result.title).not.toContain('알 수 없는');
    }
    expect(new Set(results.map(x => x.id)).size).toBe(results.length);
    expect(recommendClips(sample(), 120)).toEqual(results);
  });

  it('shorter recommendation mode makes shorter candidate windows', () => {
    const normal = recommendClips(sample(45), 150, 'balanced');
    const shorter = recommendClips(sample(45), 150, 'shorter');
    expect(shorter.length).toBeGreaterThan(0);
    expect(normal.length).toBeGreaterThan(0);
    const avg = (items: typeof normal) => items.reduce((s, x) => s + x.end - x.start, 0) / items.length;
    expect(avg(shorter)).toBeLessThan(avg(normal));
    expect(shorter[0].mode).toBe('shorter');
  });

  it('does not fabricate clips for silence and sparse/incoherent phrases', () => {
    expect(recommendClips([], 100)).toEqual([]);
    expect(recommendClips([{ start: 0, end: 1, text: 'ok' }], 100)).toEqual([]);
  });

  it('rejects invalid/risky URLs, impossible timecodes and overlong text', () => {
    const valid = { videoId: 'abcdefghijk', duration: 180, language: 'ko', mode: 'shorter', refresh: false };
    expect(validateAnalyzeRequest(valid)).toEqual(valid);
    for (const input of [
      { ...valid, videoId: 'https://youtube.com/x' },
      { ...valid, duration: NaN },
      { ...valid, duration: 604801 },
      { ...valid, language: 'unsafe' },
      { ...valid, mode: 'unknown' },
      { ...valid, refresh: 'false' },
    ]) expect(() => validateAnalyzeRequest(input)).toThrow();
    expect(() => validateTranscriptSegments([{ start: 2, end: 1, text: 'A' }], 100)).toThrow();
    expect(() => validateTranscriptSegments([{ start: 0, end: 1, text: 'A'.repeat(501) }], 100)).toThrow();
    expect(() => parseAnalysisSrt('bad timestamps', 0, 60)).toThrow();
  });

  it('trims segment end safely when Whisper reports a minor overshoot', () => {
    const result = parseAnalysisSrt('1\n00:00:09,000 --> 00:00:10,050\n후보 문장', 15, 10);
    expect(result).toEqual([{ start: 24, end: 25, text: '후보 문장' }]);
  });
});

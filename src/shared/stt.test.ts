import { describe, expect, it } from 'vitest';
import { parseWhisperSrt, validateSttRequest } from './stt';

describe('offline STT / SRT import', () => {
  const srt = '\uFEFF1\r\n00:00:00,250 --> 00:00:01,400\r\n안녕하세요\r\n\r\n' +
    '2\r\n00:00:01,400 --> 00:00:03,000\r\nWelcome to ShortFab!\r\n';
  it('imports Korean/English segments relative to clip IN', () => {
    const result = parseWhisperSrt(srt, 3, 'bold');
    expect(result.preset).toBe('bold');
    expect(result.cues.map(c => c.text)).toEqual(['안녕하세요', 'Welcome to ShortFab!']);
    expect(result.cues[0].start).toBe(0.25);
    expect(result.cues[1].end).toBe(3);
    expect(result.cues.every(c => c.id.length > 15)).toBe(true);
  });
  it('safely splits long text and drops segments outside the clip', () => {
    const text = '한국어'.repeat(36);
    const result = parseWhisperSrt('1\n00:00:00,000 --> 00:00:05,000\n' + text +
      '\n\n2\n00:00:08,000 --> 00:00:09,000\noutside', 5);
    expect(result.cues).toHaveLength(2);
    expect(result.cues.every(c => c.text.length <= 100)).toBe(true);
  });
  it('clamps tiny overlap rather than storing overlapping cues', () => {
    const result = parseWhisperSrt('1\n00:00:00,000 --> 00:00:02,000\nA\n\n' +
      '2\n00:00:01,900 --> 00:00:04,000\nB', 4);
    expect(result.cues[1].start).toBe(2);
    expect(result.cues[1].end).toBe(4);
  });
  it('rejects malformed SRT, empty transcripts, overlong clips and invalid requests', () => {
    expect(() => parseWhisperSrt('1\nNO TIME\nhello', 3)).toThrow('SRT');
    expect(() => parseWhisperSrt('', 3)).toThrow('인식되지');
    expect(() => parseWhisperSrt(srt, 601)).toThrow('10분');
    expect(() => validateSttRequest({ sourceId: 'youtube:abcdefghijk', language: 'ko' })).not.toThrow();
    expect(() => validateSttRequest({ sourceId: 'wrong', language: 'auto' })).toThrow();
    expect(() => validateSttRequest({ sourceId: 'youtube:abcdefghijk', language: 'xx' })).toThrow();
  });
});

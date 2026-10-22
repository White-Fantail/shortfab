import { describe, expect, it } from 'vitest';
import { repeatedSpeechWarnings, transcriptClock } from './transcript-refinement';

describe('transcript-assisted clip boundary UX', () => {
  it('shows precise timestamps including centiseconds across minute boundaries', () => {
    expect(transcriptClock(164.345)).toBe('02:44.35');
    expect(transcriptClock(163)).toBe('02:43.00');
    expect(transcriptClock(-2)).toBe('00:00.00');
  });

  it('warns on close repeated Whisper-like phrases without altering originals', () => {
    const samples = Array.from({ length: 5 }, (_, i) => ({
      start: 163 + i, end: 163.85 + i,
      text: i % 2 ? '뭐야 뭐지?' : '뭐야, 뭐지?',
    }));
    const snapshot = JSON.stringify(samples);
    expect(repeatedSpeechWarnings(samples)).toEqual([{
      start: 163, end: 167.85, count: 5, text: '뭐야, 뭐지?',
    }]);
    expect(JSON.stringify(samples)).toBe(snapshot);
  });

  it('does not conflate separate repetitions or different phrases', () => {
    const samples = [
      { start: 0, end: 0.8, text: 'Hello' },
      { start: 1, end: 1.8, text: 'hello!' },
      { start: 2, end: 2.8, text: 'That is different.' },
      { start: 10, end: 11, text: 'Hello' },
      { start: 11.5, end: 12.2, text: 'Hello' },
      { start: 13, end: 13.8, text: 'Hello' },
    ];
    expect(repeatedSpeechWarnings(samples)).toEqual([
      { start: 10, end: 13.8, count: 3, text: 'Hello' },
    ]);
  });
});

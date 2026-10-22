import type { TranscriptSegment } from './recommendations.js';

/** Source-relative timecodes must stay precise when adjusting 200ms clip boundaries. */
export function transcriptClock(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const minutes = Math.floor(cs / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return String(minutes).padStart(2, '0') + ':' +
    String(sec).padStart(2, '0') + '.' + String(cs % 100).padStart(2, '0');
}

export type RepeatedSpeechWarning = {
  start: number;
  end: number;
  count: number;
  text: string;
};

/**
 * This is a review hint only: repeated audio may be genuine and Whisper can
 * hallucinate. Never drop, merge, or mutate user-accepted transcript segments.
 */
export function repeatedSpeechWarnings(segments: readonly TranscriptSegment[]): RepeatedSpeechWarning[] {
  const normalized = (text: string) => text.normalize('NFKC').toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
  const warnings: RepeatedSpeechWarning[] = [];
  for (let index = 0; index < segments.length;) {
    const first = segments[index];
    const phrase = normalized(first.text);
    if (phrase.length < 2) { index++; continue; }
    let end = index + 1;
    while (end < segments.length && normalized(segments[end].text) === phrase &&
      segments[end].start - segments[end - 1].end <= 1.5 &&
      segments[end].end - first.start <= 16) end++;
    if (end - index >= 3) warnings.push({
      start: first.start, end: segments[end - 1].end,
      text: first.text, count: end - index,
    });
    index = end;
  }
  return warnings;
}

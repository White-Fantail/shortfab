import type { ClipAnalysis, TranscriptSegment } from './recommendations.js';
import {
  validateSubtitleTrack, type SubtitleCue, type SubtitleHook, type SubtitleTrack,
} from './subtitles.js';

export interface SubtitleSuggestion {
  hook: SubtitleHook;
  emphasizedCueIds: string[];
  reason: string;
}

const signal = /(?:왜|어떻게|진짜|비밀|놀라|결론|핵심|중요|반전|대박|그런데|하지만|what|why|how|secret|important|actually|surpris|never|but|however|really|wow|\?|!|？|！)/i;

/** Use only actual recognized text. Never claim generated words or a measured audience score. */
export function suggestSubtitleDecorations(track: SubtitleTrack, duration: number): SubtitleSuggestion | null {
  const checked = validateSubtitleTrack(track, duration);
  if (!checked?.cues.length) return null;
  const ranked = [...checked.cues].filter(x => x.text.trim()).sort((a, b) =>
    (Number(signal.test(b.text)) - Number(signal.test(a.text))) || a.start - b.start);
  const first = ranked[0];
  if (!first) return null;
  const text = [...first.text.replace(/\s+/g, ' ').trim()].slice(0, 64).join('');
  const highlighted = checked.cues.filter(cue => signal.test(cue.text)).slice(0, 5).map(cue => cue.id);
  return {
    hook: { text, duration: Number(Math.min(3, 5, duration).toFixed(2)), style: 'banner' },
    emphasizedCueIds: highlighted,
    reason: signal.test(first.text)
      ? '실제 인식 자막에서 질문·반전/강조 표현을 찾았습니다.'
      : '실제 자막 첫 문장을 Hook 후보로 사용했습니다.',
  };
}

/** Reuse AG2 timed YouTube transcript; changes are *only* created after explicit user action. */
export function captionsFromAnalysis(analysis: ClipAnalysis, start: number, end: number,
  preset: SubtitleTrack['preset']): SubtitleTrack {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end - start < 0.2 ||
      analysis.status === 'no_speech' || !Array.isArray(analysis.segments) ||
      end > analysis.analyzedSeconds + 0.02) {
    throw new Error('선택 구간의 실제 전사 데이터가 없습니다. 직접 Whisper 자막 인식을 사용해 주세요.');
  }
  const duration = end - start;
  const segments = analysis.segments.filter(x => x.end > start && x.start < end && x.text.trim())
    .map(segment => ({
      start: Math.max(0, segment.start - start),
      end: Math.min(duration, segment.end - start), text: segment.text.trim(),
    })).filter(x => x.end - x.start >= 0.1);
  if (!segments.length) throw new Error('선택 구간에 인식된 음성이 없습니다.');
  const cues: SubtitleCue[] = [];
  // Group adjacent speech boundaries only if each stays readable and below 100 characters.
  for (const segment of segments) {
    const chunks = splitText(segment.text, 84);
    const step = (segment.end - segment.start) / chunks.length;
    for (let i = 0; i < chunks.length; i++) {
      const from = segment.start + i * step;
      const to = segment.start + (i + 1) * step;
      if (to - from < 0.1) throw new Error('짧은 발화가 너무 촘촘합니다. 클립 구간을 조정해 주세요.');
      const text = chunks[i];
      const previous = cues[cues.length - 1];
      if (previous && from - previous.end <= 0.12 && previous.text.length + 1 + text.length <= 84 &&
          to - previous.start <= 4.8) {
        previous.end = Number(to.toFixed(3));
        previous.text += ' ' + text;
      } else {
        cues.push({ id: crypto.randomUUID(), start: Number(from.toFixed(3)),
          end: Number(to.toFixed(3)), text });
      }
    }
  }
  if (cues.length > 30) {
    throw new Error(`이 구간에서 자막 ${cues.length}개가 필요합니다. 현재 최대 30개이므로 클립 길이를 줄여 주세요. 일부를 임의로 생략하지 않습니다.`);
  }
  return validateSubtitleTrack({ preset, cues }, duration)!;
}

function splitText(value: string, max: number): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' ');
  const result: string[] = [];
  let current = '';
  for (const word of words) {
    if ([...word].length > max) {
      if (current) { result.push(current); current = ''; }
      const chars = [...word];
      while (chars.length) result.push(chars.splice(0, max).join(''));
      continue;
    }
    if (current && [...current, ...word].length + 1 > max) {
      result.push(current); current = word;
    } else current = current ? current + ' ' + word : word;
  }
  if (current) result.push(current);
  return result;
}

export function hasTranscriptForClip(analysis: ClipAnalysis | null, start: number, end: number): boolean {
  return !!analysis && analysis.analyzedSeconds >= end - 0.02 &&
    analysis.segments.some((segment: TranscriptSegment) => segment.end > start && segment.start < end && !!segment.text.trim());
}

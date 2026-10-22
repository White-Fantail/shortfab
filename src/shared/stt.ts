import { validateSubtitleTrack, type SubtitleCue, type SubtitleTrack } from './subtitles.js';

export type SttLanguage = 'auto' | 'ko' | 'en';
export type SttPhase = 'model' | 'download' | 'extract' | 'transcribe';

export interface SttProgress { phase: SttPhase; message: string }
export interface SttStatus { engineAvailable: boolean; modelAvailable: boolean; modelName: string | null }
export interface SttRequest { sourceId: string; language: SttLanguage }
export type SttResult = { status: 'completed'; track: SubtitleTrack } | { status: 'cancelled' };

export const MAX_STT_SECONDS = 600;

export function validateSttRequest(value: unknown): SttRequest {
  if (!value || typeof value !== 'object') throw new Error('자동 자막 요청이 올바르지 않습니다.');
  const input = value as Partial<SttRequest>;
  if (typeof input.sourceId !== 'string' ||
      !/^(?:youtube:[\w-]{11}|[0-9a-f-]{36})$/i.test(input.sourceId) ||
      !['auto', 'ko', 'en'].includes(input.language ?? '')) {
    throw new Error('자동 자막 원본 또는 언어 설정이 올바르지 않습니다.');
  }
  return { sourceId: input.sourceId, language: input.language! };
}

function subtitleTime(raw: string): number {
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})$/.exec(raw);
  if (!match) throw new Error('음성 인식 결과의 자막 시간이 올바르지 않습니다.');
  return (+match[1] * 3600 + +match[2] * 60 + +match[3]) + +match[4] / 1000;
}

function splitCaptionText(text: string, maxLength = 100): string[] {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  const output: string[] = [];
  while (chars.length > 0) {
    const slice = chars.splice(0, maxLength);
    // Split at the last word boundary when possible, keeping the rest.
    if (chars.length && slice.lastIndexOf(' ') >= 35) {
      const split = slice.lastIndexOf(' ');
      chars.unshift(...slice.splice(split + 1));
    }
    const line = slice.join('').trim();
    if (line) output.push(line);
  }
  return output;
}

/** Parse only timed SRT emitted by whisper-cli. Times are relative to the extracted clip. */
export function parseWhisperSrt(contents: string, duration: number, preset: SubtitleTrack['preset'] = 'classic'): SubtitleTrack {
  if (!Number.isFinite(duration) || duration < 0.2 || duration > MAX_STT_SECONDS) {
    throw new Error('자동 자막은 0.2초 이상, 10분 이하의 클립에서 사용할 수 있습니다.');
  }
  if (contents.length > 1024 * 1024) throw new Error('음성 인식 결과가 너무 큽니다.');
  const blocks = contents.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const cues: SubtitleCue[] = [];
  const timePattern = /^(\d{2,}:[0-5]\d:[0-5]\d[,.]\d{3})\s*-->\s*(\d{2,}:[0-5]\d:[0-5]\d[,.]\d{3})(?:\s+.*)?$/;
  for (const block of blocks) {
    const lines = block.split('\n').map(s => s.trim());
    if (!lines.some(Boolean)) continue;
    const timingIndex = /^\d+$/.test(lines[0]) ? 1 : 0;
    const timing = timePattern.exec(lines[timingIndex] ?? '');
    if (!timing) throw new Error('음성 인식 결과의 SRT 형식을 읽을 수 없습니다.');
    const text = Array.from(lines.slice(timingIndex + 1).join(' ')).map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : char;
    }).join('').trim();
    if (!text) continue;
    const rawStart = subtitleTime(timing[1]);
    const rawEnd = subtitleTime(timing[2]);
    if (rawEnd <= rawStart) continue;
    if (rawStart >= duration + 0.02) continue;
    const start = Math.max(0, rawStart);
    const end = Math.min(duration, rawEnd);
    const parts = splitCaptionText(text);
    if (parts.length === 0) continue;
    const step = (end - start) / parts.length;
    for (let i = 0; i < parts.length; i++) {
      const priorEnd = cues.at(-1)?.end ?? 0;
      const cueStart = Math.max(priorEnd, start + step * i);
      const cueEnd = Math.min(duration, start + step * (i + 1));
      if (cueEnd - cueStart < 0.1 - 1e-6) continue;
      cues.push({ id: crypto.randomUUID(), start: Number(cueStart.toFixed(3)), end: Number(cueEnd.toFixed(3)),
        text: parts[i] });
      if (cues.length > 30) throw new Error('자동 인식된 자막이 30개를 초과했습니다. 구간을 더 짧게 선택해 주세요.');
    }
  }
  if (!cues.length) throw new Error('음성이 인식되지 않았습니다. 언어 또는 원본 오디오를 확인해 주세요.');
  return validateSubtitleTrack({ preset, cues }, duration)!;
}

/** Timed, clip-relative captions. Only built-in declarative styles are allowed. */
export const SUBTITLE_PRESETS = ['classic', 'bold', 'minimal', 'boxed', 'neon', 'cinema', 'impact', 'topline'] as const;
export type SubtitlePreset = typeof SUBTITLE_PRESETS[number];

export interface SubtitleCue {
  id: string;
  start: number; // Seconds relative to selected clip IN, not original source time.
  end: number;
  text: string;
  emphasis?: boolean; // Whole-cue visual emphasis; never fabricated word-level timings.
}

export type HookStyle = 'banner' | 'simple';
export interface SubtitleHook { text: string; duration: number; style: HookStyle; }

export interface SubtitleTrack {
  preset: SubtitlePreset;
  cues: SubtitleCue[];
  hook?: SubtitleHook | null;

/** This same contract protects autosave, reopening old projects and FFmpeg composition. */
export function validateSubtitleTrack(input: unknown, duration: number, label = '자막'): SubtitleTrack | null {
  if (input === null || input === undefined) return null;
  if (!input || typeof input !== 'object') throw new Error(label + ': 자막 설정이 올바르지 않습니다.');
  const track = input as Partial<SubtitleTrack>;
  if (!SUBTITLE_PRESETS.includes(track.preset as SubtitlePreset)) {
    throw new Error(label + ': 지원하지 않는 자막 스타일입니다.');
  }
  if (!Array.isArray(track.cues) || track.cues.length > 30) {
    throw new Error(label + ': 자막 구간은 최대 30개까지 가능합니다.');
  }
  let hook: SubtitleHook | null | undefined;
  if (track.hook !== undefined) {
    if (track.hook === null) hook = null;
    else {
      const candidate = track.hook as Partial<SubtitleHook>;
      if (!candidate || typeof candidate.text !== 'string' || !candidate.text.trim() ||
          candidate.text.length > 64 ||
          [...candidate.text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
          typeof candidate.duration !== 'number' || !Number.isFinite(candidate.duration) ||
          candidate.duration < 0.5 || candidate.duration > 5 ||
          candidate.duration > duration + 0.02 ||
          !['banner', 'simple'].includes(candidate.style ?? '')) {
        throw new Error(label + ': Hook은 1~64자, 0.5~5초, 지원되는 스타일이어야 합니다.');
      }
      hook = { text: candidate.text, duration: candidate.duration, style: candidate.style! };
    }
  }
    const ids = new Set<string>();
  const cues = track.cues.map((item, index): SubtitleCue => {
    const name = label + ' 자막 ' + (index + 1);
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(item.id) || ids.has(item.id)) {
      throw new Error(name + ': 식별자가 중복되었거나 올바르지 않습니다.');
    }
    if (typeof item.start !== 'number' || typeof item.end !== 'number' ||
      !Number.isFinite(item.start) || !Number.isFinite(item.end) ||
      item.start < 0 || item.end - item.start < 0.1 - 1e-6 ||
      !Number.isFinite(duration) || item.end > duration + 0.02) {
      throw new Error(name + ': 시간은 클립 시작 기준이며, 구간을 확인해 주세요 (최소 0.1초).');
    }
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 100 ||
        [...item.text].some((char) => {
          const code = char.charCodeAt(0);
          return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
        })) {
      throw new Error(name + ': 내용을 1~100자로 입력해 주세요.');
    }
    if (item.emphasis !== undefined && typeof item.emphasis !== 'boolean') {
      throw new Error(name + ': 강조 여부가 올바르지 않습니다.');
    }
    ids.add(item.id);
    return { id: item.id, start: item.start, end: item.end, text: item.text.replace(/\r\n/g, '\n'),
      ...(item.emphasis === undefined ? {} : { emphasis: item.emphasis }) };
  });
  const ordered = [...cues].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start < ordered[i - 1].end - 1e-6) {
      throw new Error(label + ': 자막 구간이 겹칩니다. 시작/끝 시간을 조정해 주세요.');
    }
  }
  return { preset: track.preset as SubtitlePreset, cues, ...(track.hook === undefined ? {} : { hook }) };
}

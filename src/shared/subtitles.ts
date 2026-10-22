/** Timed, clip-relative captions. Only built-in declarative styles are allowed. */
export const SUBTITLE_PRESETS = ['classic', 'bold', 'minimal', 'boxed'] as const;
export type SubtitlePreset = typeof SUBTITLE_PRESETS[number];

export interface SubtitleCue {
  id: string;
  start: number; // Seconds relative to selected clip IN, not original source time.
  end: number;
  text: string;
}

export interface SubtitleTrack {
  preset: SubtitlePreset;
  cues: SubtitleCue[];
}

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
        /[\u0000-\u0008\u000b-\u001f\u007f]/.test(item.text)) {
      throw new Error(name + ': 내용을 1~100자로 입력해 주세요.');
    }
    ids.add(item.id);
    return { id: item.id, start: item.start, end: item.end, text: item.text.replace(/\r\n/g, '\n') };
  });
  const ordered = [...cues].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start < ordered[i - 1].end - 1e-6) {
      throw new Error(label + ': 자막 구간이 겹칩니다. 시작/끝 시간을 조정해 주세요.');
    }
  }
  return { preset: track.preset as SubtitlePreset, cues };
}

/** Narration is a voice script, not an unrelated caption layer. */
export type NarrationVoice = 'ko' | 'en';
export interface NarrationConfig {
  mode: 'off' | 'tts';
  text: string;
  voice: NarrationVoice;
}
export function splitNarration(text: string): string[] {
  const clean = text.trim().replace(/\r/g, '');
  if (!clean) return [];
  // Sentence boundaries are narration/caption units. Split overlong sentences safely.
  const sentences = clean.split(/(?<=[.!?。！？])\s+|\n+/u).map(s => s.trim()).filter(Boolean);
  const result: string[] = [];
  for (const sentence of sentences) {
    const chars = Array.from(sentence);
    for (let start = 0; start < chars.length; start += 100) {
      result.push(chars.slice(start, start + 100).join(''));
    }
  }
  return result;
}
export function validateNarration(input: unknown): NarrationConfig | null {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('나레이션 설정이 올바르지 않습니다.');
  const value = input as Partial<NarrationConfig>;
  if ((value.mode !== 'off' && value.mode !== 'tts') ||
      !['ko', 'en'].includes(value.voice ?? '') || typeof value.text !== 'string' ||
      value.text.length > 1200 ||
      [...value.text].some(char => {
        const n = char.charCodeAt(0);
        return (n < 32 && n !== 9 && n !== 10 && n !== 13) || n === 127;
      })) throw new Error('나레이션은 올바른 언어와 1,200자 이내 원고가 필요합니다.');
  const segments = splitNarration(value.text);
  if (value.mode === 'tts' && (segments.length === 0 || segments.length > 30)) {
    throw new Error('나레이션은 1~30개의 문장으로 나눌 수 있어야 합니다.');
  }
  return { mode: value.mode, voice: value.voice!, text: value.text };
}

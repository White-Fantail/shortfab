import type { SttLanguage } from './stt.js';

export const ANALYZER_VERSION = 'ag2-transcript-v1';
export const MAX_ANALYSIS_SECONDS = 3600;
export type RecommendationMode = 'balanced' | 'shorter' | 'energetic';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}
export interface ClipRecommendation {
  id: string;
  start: number;
  end: number;
  title: string;
  transcript: string;
  reason: string;
  mode: RecommendationMode;
}
export interface ClipAnalysis {
  videoId: string;
  duration: number;
  analyzedSeconds: number;
  language: SttLanguage;
  modelFingerprint: string;
  engineVersion: string;
  generatedAt: string;
  segments: TranscriptSegment[];
  candidates: ClipRecommendation[];
  mode: RecommendationMode;
  status: 'ready' | 'no_speech';
  note: string | null;
}
export interface AnalyzeRequest { videoId: string; duration: number; language: SttLanguage; mode: RecommendationMode; refresh: boolean }
export interface AnalyzeProgress {
  phase: 'source' | 'extract' | 'transcribe' | 'recommend' | 'cache';
  percent: number;
  message: string;
}
export type AnalyzeResult = { status: 'completed'; analysis: ClipAnalysis } | { status: 'cancelled' };

export function validateAnalyzeRequest(input: unknown): AnalyzeRequest {
  if (!input || typeof input !== 'object') throw new Error('원본 분석 요청이 올바르지 않습니다.');
  const value = input as Partial<AnalyzeRequest>;
  if (!/^[a-zA-Z0-9_-]{11}$/.test(value.videoId ?? '') ||
      typeof value.duration !== 'number' || !Number.isFinite(value.duration) ||
      value.duration < 1 || value.duration > 604800 ||
      !['auto', 'ko', 'en'].includes(value.language ?? '') ||
      !['balanced', 'shorter', 'energetic'].includes(value.mode ?? '') ||
      typeof value.refresh !== 'boolean') {
    throw new Error('원본 영상, 길이 또는 추천 모드를 확인하세요.');
  }
  return value as AnalyzeRequest;
}

export function validateTranscriptSegments(segments: TranscriptSegment[], analyzedSeconds: number): TranscriptSegment[] {
  if (!Array.isArray(segments) || segments.length > 30000) throw new Error('전사 데이터가 너무 큽니다.');
  let prior = 0;
  return segments.map((segment) => {
    if (!segment || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) ||
        segment.start < 0 || segment.end <= segment.start || segment.end > analyzedSeconds + 0.05 ||
        segment.start < prior - 0.05 || typeof segment.text !== 'string' || segment.text.length > 500) {
      throw new Error('음성 분석 타임코드가 올바르지 않습니다.');
    }
    prior = segment.start;
    return { start: segment.start, end: segment.end, text: segment.text.trim() };
  }).filter(segment => segment.text.length > 0);
}

const hook = /(?:왜|진짜|실제로|놀랍|비밀|처음|결국|어떻게|문제|정답|결론|하지만|그런데|중요|절대|반전|대박|이유|what|why|how|really|secret|actually|but|however|imagine|never|surprise|because|first|finally|result|important)/i;
const lively = /[!?！？]|(?:ㅋㅋ|ㅎㅎ|wow|amazing|unbelievable|crazy|웃|충격|세상에)/i;
function clipTitle(lines: TranscriptSegment[], index: number): string {
  const text = lines.slice(0, 3).map(line => line.text).join(' ').replace(/\s+/g, ' ').trim();
  return (text.length > 48 ? text.slice(0, 47).trimEnd() + '…' : text) || `추천 장면 ${index + 1}`;
}
const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
interface Ranked { start: number; end: number; lines: TranscriptSegment[]; rank: number; reason: string }
function scoreWindow(lines: TranscriptSegment[], target: number, mode: RecommendationMode): Ranked | null {
  if (!lines.length) return null;
  const start = Math.max(0, lines[0].start - 0.22);
  const end = lines[lines.length - 1].end + 0.24;
  const length = end - start;
  if (length < 7.5 || length > 61) return null;
  const text = lines.map(x => x.text).join(' ');
  const charCount = Array.from(text).length;
  if (charCount < 26) return null;
  const hookCount = lines.slice(0, 3).filter(x => hook.test(x.text)).length;
  const livelyCount = lines.filter(x => lively.test(x.text)).length;
  const pauses = lines.slice(1).filter((x, i) => x.start - lines[i].end > 1).length;
  const density = charCount / Math.max(1, length);
  const targetFit = Math.max(0, 1 - Math.abs(length - target) / target);
  const phraseEnd = /[.!?。！？]$/.test(lines[lines.length - 1].text.trim()) ? 1 : 0;
  const rank = hookCount * (mode === 'energetic' ? 5.5 : 3) +
    Math.min(livelyCount, 4) * (mode === 'energetic' ? 3.2 : 1.2) +
    Math.min(density, 9) * 0.42 + targetFit * 4 + phraseEnd * 1.4 -
    pauses * 0.9 - Math.max(0, 18 - length) * 0.18;
  const reason = hookCount && livelyCount ? '도입부의 관심 유도 표현과 대사 강조가 포함된 구간' :
    hookCount ? '도입부에 질문·반전·핵심 표현이 등장하는 구간' :
    livelyCount ? '감탄·질문 등 대사 변화가 포함된 구간' :
    phraseEnd ? '대사가 이어지고 문장 끝에서 마무리되는 구간' :
    '짧은 구간에 대사가 비교적 밀집한 장면';
  return { start, end, lines, rank, reason };
}

/** Deterministic, explainable transcript-based candidates. No invented audience metrics or LLM claims. */
export function recommendClips(segments: TranscriptSegment[], duration: number,
  mode: RecommendationMode = 'balanced', maximum = 8): ClipRecommendation[] {
  if (!Number.isFinite(duration) || duration <= 0 || maximum < 1) return [];
  const clean = validateTranscriptSegments(segments, duration);
  const target = mode === 'shorter' ? 18 : mode === 'energetic' ? 26 : 37;
  const windows: Ranked[] = [];
  // Sliding windows start on speech boundaries and end on nearby natural breaks.
  for (let i = 0; i < clean.length; i++) {
    const start = clean[i].start;
    const options: Ranked[] = [];
    for (let j = i; j < clean.length; j++) {
      const span = clean[j].end - start;
      if (span > Math.min(60, target * 1.65)) break;
      if (span < (mode === 'shorter' ? 9 : 13)) continue;
      const pause = j + 1 < clean.length ? clean[j + 1].start - clean[j].end : 2;
      if (pause >= 0.45 || j === clean.length - 1 || /[.!?。！？]$/.test(clean[j].text)) {
        const ranked = scoreWindow(clean.slice(i, j + 1), target, mode);
        if (ranked) options.push(ranked);
      }
    }
    if (options.length) windows.push(options.sort((a, b) => b.rank - a.rank)[0]);
  }
  windows.sort((a, b) => b.rank - a.rank || a.start - b.start);
  const chosen: Ranked[] = [];
  for (const item of windows) {
    if (chosen.some(saved => overlap(item, saved) / Math.min(item.end - item.start, saved.end - saved.start) > 0.32)) continue;
    chosen.push(item);
    if (chosen.length >= Math.min(10, maximum)) break;
  }
  return chosen.map((item, index) => ({
    id: `${mode}-${Math.round(item.start * 100)}-${Math.round(item.end * 100)}`,
    start: Number(Math.max(0, item.start).toFixed(2)),
    end: Number(Math.min(duration, item.end).toFixed(2)),
    title: clipTitle(item.lines, index),
    transcript: item.lines.map(x => x.text).join(' ').slice(0, 450),
    reason: item.reason, mode,
  })).filter(item => item.end - item.start >= 7.5);
}

/** Read only the timed SRT data; unlike subtitle editing this has no 30-cue limit. */
export function parseAnalysisSrt(contents: string, offset: number, segmentSeconds: number): TranscriptSegment[] {
  if (contents.length > 2 * 1024 * 1024 || !Number.isFinite(offset) ||
      !Number.isFinite(segmentSeconds) || offset < 0 || segmentSeconds <= 0 || segmentSeconds > 600) {
    throw new Error('전사 파일의 크기 또는 길이가 잘못되었습니다.');
  }
  const lines = contents.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  const result: TranscriptSegment[] = [];
  for (const block of lines) {
    if (!block.trim()) continue;
    const parts = block.split('\n').map(s => s.trim());
    const idx = /^\d+$/.test(parts[0]) ? 1 : 0;
    const match = /^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s*-->\s*(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})/.exec(parts[idx] ?? '');
    if (!match) throw new Error('Whisper 분석의 SRT 형식을 확인할 수 없습니다.');
    const from = +match[1] * 3600 + +match[2] * 60 + +match[3] + +match[4] / 1000;
    const to = +match[5] * 3600 + +match[6] * 60 + +match[7] + +match[8] / 1000;
    const text = parts.slice(idx + 1).join(' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || to <= from || from >= segmentSeconds + 0.02) continue;
    const start = offset + Math.max(0, from);
    const end = offset + Math.min(segmentSeconds, to);
    if (end <= start) continue;
    result.push({ start: Number(start.toFixed(3)), end: Number(end.toFixed(3)), text: text.slice(0, 500) });
  }
  return validateTranscriptSegments(result, offset + segmentSeconds);
}

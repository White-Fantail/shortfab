import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { probeMedia } from './media.js';
import { PersonalVideoTask } from './personal.js';
import { SttTask } from './stt.js';
import {
  ANALYZER_VERSION, MAX_ANALYSIS_SECONDS, parseAnalysisSrt, recommendClips,
  validateTranscriptSegments, type AnalyzeProgress, type AnalyzeRequest, type AnalyzeResult,
  type ClipAnalysis, type RecommendationMode,
} from '../src/shared/recommendations.js';

const cacheFolder = () => join(app.getPath('userData'), 'analysis');
const fingerprint = (modelPath: string, bytes: number, modified: number): string =>
  createHash('sha256').update(JSON.stringify({ modelPath, bytes, modified })).digest('hex').slice(0, 20);

function cacheFile(videoId: string, language: string, hash: string): string {
  return join(cacheFolder(), `${videoId}-${language}-${hash}.json`);
}
function safeCache(input: unknown, videoId: string, duration: number, language: string,
  hash: string): ClipAnalysis | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Partial<ClipAnalysis>;
  if (value.videoId !== videoId || value.language !== language ||
      value.modelFingerprint !== hash || value.engineVersion !== ANALYZER_VERSION ||
      typeof value.duration !== 'number' || Math.abs(value.duration - duration) > 2 ||
      value.analyzedSeconds !== Math.min(duration, MAX_ANALYSIS_SECONDS) ||
      !Array.isArray(value.segments) || !['ready', 'no_speech'].includes(value.status ?? '')) return null;
  try {
    const segments = validateTranscriptSegments(value.segments, value.analyzedSeconds);
    if (segments.length > 30000) return null;
    return { ...value, segments } as ClipAnalysis;
  } catch { return null; }
}

/** Standalone worker: a single source download, sliced local Whisper inference and atomic cache. */
export class AnalyzeVideoTask {
  private cancelled = false;
  private acquire: PersonalVideoTask | null = null;
  private stt: SttTask | null = null;

  cancel(): void {
    this.cancelled = true;
    this.acquire?.cancel();
    this.stt?.cancel();
  }
  private check(): void {
    if (this.cancelled) throw new Error('원본 분석이 취소되었습니다.');
  }
  private progress(callback: (event: AnalyzeProgress) => void,
    phase: AnalyzeProgress['phase'], percent: number, message: string): void {
    callback({ phase, percent: Math.min(100, Math.max(0, Math.round(percent))), message });
  }
  private async cacheRead(videoId: string, duration: number, language: string,
    hash: string): Promise<ClipAnalysis | null> {
    const file = cacheFile(videoId, language, hash);
    try {
      const s = await stat(file);
      if (s.size > 3 * 1024 * 1024 || s.size < 10) return null;
      return safeCache(JSON.parse(await readFile(file, 'utf8')), videoId, duration, language, hash);
    } catch { return null; }
  }
  private async cacheWrite(result: ClipAnalysis): Promise<void> {
    await mkdir(cacheFolder(), { recursive: true, mode: 0o700 });
    const file = cacheFile(result.videoId, result.language, result.modelFingerprint);
    const temp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
    try {
      await writeFile(temp, JSON.stringify(result), { mode: 0o600, flag: 'wx' });
      this.check();
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true }).catch(() => {});
    }
  }

  static async cached(videoId: string, duration: number, language: AnalyzeRequest['language'],
    modelPath: string): Promise<ClipAnalysis | null> {
    const info = await stat(modelPath).catch(() => null);
    if (!info?.isFile()) return null;
    const task = new AnalyzeVideoTask();
    return task.cacheRead(videoId, duration, language, fingerprint(modelPath, info.size, info.mtimeMs));
  }

  async run(request: AnalyzeRequest, modelPath: string,
    callback: (event: AnalyzeProgress) => void): Promise<AnalyzeResult> {
    const model = await stat(modelPath).catch(() => null);
    if (!model?.isFile() || model.size < 1_000_000) throw new Error('Whisper 모델(.bin)을 먼저 설치해 주세요.');
    const hash = fingerprint(modelPath, model.size, model.mtimeMs);
    const analyzedSeconds = Math.min(request.duration, MAX_ANALYSIS_SECONDS);
    this.progress(callback, 'cache', 2, '이전 분석 캐시를 확인하는 중…');
    const cached = request.refresh ? null :
      await this.cacheRead(request.videoId, request.duration, request.language, hash);
    this.check();
    if (cached) {
      const analysis = rerank(cached, request.mode);
      this.progress(callback, 'recommend', 100, '저장된 실제 전사에서 후보를 생성했습니다.');
      return { status: 'completed', analysis };
    }
    this.progress(callback, 'source', 4, 'YouTube 영상 원본을 준비하는 중…');
    this.acquire = new PersonalVideoTask();
    const acquired = await this.acquire.acquire(request.videoId, analyzedSeconds, ({ percent }) =>
      this.progress(callback, 'source', 5 + percent * 0.4, '공개 영상 다운로드/로컬 캐시 확인 중…'));
    this.check();
    if (acquired.duration + 1 < analyzedSeconds) throw new Error('가져온 영상 길이가 분석 범위보다 짧습니다.');
    const media = await probeMedia(acquired.path);
    this.check();
    if (!media.hasAudio) {
      const analysis = emptyAnalysis(request, hash, analyzedSeconds,
        '이 영상에는 오디오 트랙이 없습니다. 대사 기반 추천 대신 클립을 직접 선택해 주세요.');
      await this.cacheWrite(analysis);
      return { status: 'completed', analysis };
    }
    const allSegments: ClipAnalysis['segments'] = [];
    // Whisper's per-slice 10-minute limit; 9-minute slices avoid oversized subtitle-cue limits.
    const sliceSeconds = 540;
    const slices = Math.ceil(analyzedSeconds / sliceSeconds);
    for (let index = 0; index < slices; index++) {
      this.check();
      const start = index * sliceSeconds;
      const end = Math.min(analyzedSeconds, start + sliceSeconds);
      const slice = end - start;
      this.stt = new SttTask();
      const srt = await this.stt.transcribeSlice({
        sourcePath: acquired.path, modelPath, start, end, language: request.language,
      }, phase => this.progress(callback, phase, 27 + ((index + (phase === 'transcribe' ? 0.45 : 0)) / slices) * 66,
        `원본 음성 분석 중 · ${index + 1}/${slices} 구간 (${phase === 'extract' ? '오디오 분리' : '전사'})`));
      this.check();
      allSegments.push(...parseAnalysisSrt(srt, start, slice));
      this.progress(callback, 'transcribe', 27 + (index + 1) / slices * 66,
        `실제 대사 추출: ${index + 1}/${slices} 구간 완료`);
      this.stt = null;
    }
    const segments = validateTranscriptSegments(allSegments, analyzedSeconds);
    this.progress(callback, 'recommend', 95, '대사 연결과 문장 경계에서 추천 구간을 선별하는 중…');
    const candidates = recommendClips(segments, analyzedSeconds, request.mode);
    const note = request.duration > MAX_ANALYSIS_SECONDS
      ? `최초 ${Math.round(MAX_ANALYSIS_SECONDS / 60)}분만 분석했습니다. 나머지는 수동으로 탐색할 수 있습니다.`
      : !candidates.length ? '인식된 발화가 부족해 추천할 수 없습니다. 수동으로 클립을 선택해 주세요.' : null;
    const analysis: ClipAnalysis = {
      videoId: request.videoId, duration: request.duration, analyzedSeconds,
      language: request.language, modelFingerprint: hash, engineVersion: ANALYZER_VERSION,
      generatedAt: new Date().toISOString(), segments, candidates, mode: request.mode,
      status: candidates.length ? 'ready' : 'no_speech', note,
    };
    this.check();
    this.progress(callback, 'cache', 98, '분석 캐시를 저장하는 중…');
    await this.cacheWrite(analysis);
    this.progress(callback, 'recommend', 100, candidates.length
      ? `${candidates.length}개 실제 대사 기반 후보 생성 완료`
      : '대사 기반 후보 없음 · 수동 선택 가능');
    return { status: 'completed', analysis };
  }
}

function emptyAnalysis(request: AnalyzeRequest, hash: string, analyzedSeconds: number, note: string): ClipAnalysis {
  return {
    videoId: request.videoId, duration: request.duration, analyzedSeconds, language: request.language,
    modelFingerprint: hash, engineVersion: ANALYZER_VERSION, generatedAt: new Date().toISOString(),
    segments: [], candidates: [], mode: request.mode, status: 'no_speech', note,
  };
}
export function rerank(source: ClipAnalysis, mode: RecommendationMode): ClipAnalysis {
  const candidates = recommendClips(source.segments, source.analyzedSeconds, mode);
  return { ...source, mode, candidates, status: candidates.length ? 'ready' : 'no_speech',
    note: candidates.length ? (source.duration > MAX_ANALYSIS_SECONDS
      ? `최초 ${Math.round(MAX_ANALYSIS_SECONDS / 60)}분만 분석했습니다.` : null)
      : source.note ?? '후보를 만들 만큼 연속된 대사가 없습니다. 수동 선택을 이용해 주세요.' };
}

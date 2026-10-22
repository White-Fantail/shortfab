import { externalToolEnv } from './tool-env.js';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type RenderProgress, type RenderRequest } from '../src/shared/contracts.js';
import { layoutFilter, type LayoutStyle } from '../src/shared/layout-styles.js';
import { probeMedia } from './media.js';
import { buildAss } from './subtitles.js';
import { selectCaptionRenderer } from './ffmpeg-ass.js';
import { captionOverlayGraph, createCaptionOverlay } from './caption-overlay.js';
import type { SubtitleTrack } from '../src/shared/subtitles.js';
import { validateNarration, type NarrationConfig } from '../src/shared/narration.js';
import { narrationAudioFilter, synthesizeNarration } from './narration.js';

const ffmpegBin = () => process.env.SHORTFAB_FFMPEG_PATH || 'ffmpeg';

function secondsFromTimestamp(value: string): number {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

export class RenderTask {
  private child: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;
  private narrationAbort = new AbortController();

  cancel(): void {
    this.cancelled = true;
    this.narrationAbort.abort();
    this.child?.kill('SIGTERM');
  }

  async run(
    sourcePath: string,
    outputPath: string,
    request: RenderRequest,
    progress: (value: RenderProgress) => void,
    subtitles: SubtitleTrack | null = null,
    layout: LayoutStyle | null = null,
    narration: NarrationConfig | null = null,
  ): Promise<void> {
    if (this.cancelled) throw new Error('렌더가 취소되었습니다.');
    const temporaryPath = join(dirname(outputPath), `.shortfab-${randomUUID()}.mp4`);
    const clipSeconds = request.end - request.start;
    let subtitleDir: string | null = null;
    const filter = layoutFilter(request.width, layout);
    try {
      const voice = validateNarration(narration);
      // Generate audio and exact sentence timings before choosing the subtitle renderer.
      if (voice?.mode === 'tts') subtitleDir = await mkdtemp(join(tmpdir(), 'shortfab-caption-'));
      const spoken = voice?.mode === 'tts' && subtitleDir
        ? await synthesizeNarration(voice, clipSeconds, subtitleDir, this.narrationAbort.signal) : null;
      const finalSubtitles: SubtitleTrack | null = spoken ? {
        preset: subtitles?.preset ?? 'classic', cues: spoken.cues, hook: null,
      } : subtitles;
      const hasCaptions = Boolean(finalSubtitles?.cues.length || finalSubtitles?.hook);
      const selected = hasCaptions ? await selectCaptionRenderer(ffmpegBin()) :
        { binary: ffmpegBin(), mode: 'none' as const };
      if (hasCaptions && finalSubtitles) {
        subtitleDir ??= await mkdtemp(join(tmpdir(), 'shortfab-caption-'));
        subtitleDir = await mkdtemp(join(tmpdir(), 'shortfab-caption-'));
        if (selected.mode === 'ass') {
          // Private ASCII basename via cwd avoids platform-specific filter path escaping.
          await writeFile(join(subtitleDir, 'captions.ass'), buildAss(finalSubtitles, clipSeconds), { mode: 0o600 });
        } else {
          await createCaptionOverlay(finalSubtitles, clipSeconds, request.width, subtitleDir,
            () => this.cancelled);
        }
      }
      if (this.cancelled) throw new Error('렌더가 취소되었습니다.');
      const imageFilters = selected.mode === 'overlay'
        ? ['-filter_complex', captionOverlayGraph(filter.graph, filter.complex), '-map', '[outputv]']
        : filter.complex
          ? ['-filter_complex', filter.graph + (selected.mode === 'ass' ?
              ';[v]ass=filename=captions.ass[outputv]' : ''),
            '-map', selected.mode === 'ass' ? '[outputv]' : '[v]']
          : ['-map', '0:v:0', '-vf', filter.graph +
            (selected.mode === 'ass' ? ',ass=filename=captions.ass' : '')];
      const spokenIndex = selected.mode === 'overlay' ? 2 : 1;
      const voiceAudio = spoken ? narrationAudioFilter((await probeMedia(sourcePath)).hasAudio, spokenIndex) : null;
      const videoComplex = imageFilters[0] === '-filter_complex';
      const videoMap = videoComplex ? imageFilters.slice(2) : imageFilters;
      const combinedFilters = [
        ...(videoComplex ? [imageFilters[1]] : []),
        ...(voiceAudio?.graph ? [voiceAudio.graph] : []),
      ];
      const args = [
        '-hide_banner', '-nostdin', '-loglevel', 'error',
        '-ss', request.start.toFixed(3), '-i', sourcePath,
        ...(selected.mode === 'overlay' ? ['-f', 'concat', '-safe', '0', '-i', 'captions.ffconcat'] : []),
        ...(spoken ? ['-f', 'concat', '-safe', '0', '-i', 'narration.ffconcat'] : []),
        '-t', clipSeconds.toFixed(3),
        ...(videoComplex ? [] : videoMap),
        ...(combinedFilters.length ? ['-filter_complex', combinedFilters.join(';')] : []),
        ...(videoComplex ? videoMap : []),
        '-map', voiceAudio?.map ?? '0:a:0?',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart', '-progress', 'pipe:1',
        '-y', temporaryPath,
      ];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(selected.binary, args, {
          windowsHide: true, env: externalToolEnv(), cwd: subtitleDir ?? undefined });
        this.child = child;
        let stderr = '';
        let stdoutBuffer = '';
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else resolve();
        };
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          stdoutBuffer += chunk;
          const lines = stdoutBuffer.split(/\r?\n/);
          stdoutBuffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('out_time=')) {
              const seconds = secondsFromTimestamp(line.slice('out_time='.length));
              progress({ seconds, percent: Math.min(99, Math.max(0, Math.round(seconds / clipSeconds * 100))) });
            }
          }
        });
        child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-8000); });
        child.on('error', () => finish(new Error('ffmpeg를 실행할 수 없습니다. 설치 및 PATH를 확인하세요.')));
        child.on('close', (code) => {
          if (this.cancelled) finish(new Error('렌더가 취소되었습니다.'));
          else if (code !== 0) finish(new Error(stderr || `ffmpeg가 코드 ${code}로 종료되었습니다.`));
          else finish();
        });
        if (this.cancelled) child.kill('SIGTERM');
      });
      if (this.cancelled) throw new Error('렌더가 취소되었습니다.');
      const renderedStat = await stat(temporaryPath);
      if (!renderedStat.size) throw new Error('빈 출력 파일이 생성되었습니다.');
      const result = await probeMedia(temporaryPath);
      if (result.width !== request.width || result.height !== request.width * 16 / 9) {
        throw new Error('출력 영상 비율 검증에 실패했습니다.');
      }
      if (this.cancelled) throw new Error('렌더가 취소되었습니다.');
      await rename(temporaryPath, outputPath);
      progress({ seconds: clipSeconds, percent: 100 });
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      this.child = null;
      if (subtitleDir) await rm(subtitleDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

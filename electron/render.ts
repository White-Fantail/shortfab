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
import { captionFFmpegBinary } from './ffmpeg-ass.js';
import type { SubtitleTrack } from '../src/shared/subtitles.js';

const ffmpegBin = () => process.env.SHORTFAB_FFMPEG_PATH || 'ffmpeg';

function secondsFromTimestamp(value: string): number {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

export class RenderTask {
  private child: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
    this.child?.kill('SIGTERM');
  }

  async run(
    sourcePath: string,
    outputPath: string,
    request: RenderRequest,
    progress: (value: RenderProgress) => void,
    subtitles: SubtitleTrack | null = null,
    layout: LayoutStyle | null = null,
  ): Promise<void> {
    if (this.cancelled) throw new Error('렌더가 취소되었습니다.');
    const temporaryPath = join(dirname(outputPath), `.shortfab-${randomUUID()}.mp4`);
    const clipSeconds = request.end - request.start;
    let subtitleDir: string | null = null;
    const filter = layoutFilter(request.width, layout);
    const hasCaptions = Boolean(subtitles?.cues.length || subtitles?.hook);
    const imageFilters = filter.complex
      ? ['-filter_complex', filter.graph + (hasCaptions ? ';[v]ass=filename=captions.ass[outputv]' : ''),
        '-map', hasCaptions ? '[outputv]' : '[v]']
      : ['-map', '0:v:0', '-vf', filter.graph + (hasCaptions ? ',ass=filename=captions.ass' : '')];
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-ss', request.start.toFixed(3), '-i', sourcePath,
      '-t', clipSeconds.toFixed(3),
      ...imageFilters, '-map', '0:a:0?',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart', '-progress', 'pipe:1',
      '-y', temporaryPath,
    ];
    try {
      const renderBinary = hasCaptions ? await captionFFmpegBinary(ffmpegBin()) : ffmpegBin();
      if (hasCaptions && subtitles) {
        // Private ASCII basename via cwd avoids filter path quoting, including Windows drives.
        subtitleDir = await mkdtemp(join(tmpdir(), 'shortfab-caption-'));
        await writeFile(join(subtitleDir, 'captions.ass'), buildAss(subtitles, clipSeconds), { mode: 0o600 });
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn(renderBinary, args, { windowsHide: true, env: externalToolEnv(), cwd: subtitleDir ?? undefined });
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

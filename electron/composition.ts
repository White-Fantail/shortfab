import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { externalToolEnv } from './tool-env.js';
import { probeMedia } from './media.js';
import { RenderTask } from './render.js';
import type { RenderProgress, RenderRequest } from '../src/shared/contracts.js';
import type { LayoutStyle } from '../src/shared/layout-styles.js';
import type { SubtitleTrack } from '../src/shared/subtitles.js';
import type { NarrationConfig } from '../src/shared/narration.js';
import type { ShortStyleSelection } from '../src/shared/short-styles.js';

export interface CompositionPart {
  request: RenderRequest;
  layout: LayoutStyle | null;
  subtitles: SubtitleTrack | null;
  narration: NarrationConfig | null;
  style: ShortStyleSelection | null;
}

/** One MP4 from an ordered list of non-contiguous ranges of ONE source.
 * Encode each segment through the normal caption/narration/style pipeline,
 * then remux those segments into an atomic final output. */
export class CompositionTask {
  private segment: RenderTask | null = null;
  private concat: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
    this.segment?.cancel();
    this.concat?.kill('SIGTERM');
  }

  async run(sourcePath: string, outputPath: string, parts: CompositionPart[],
    progress: (value: RenderProgress) => void): Promise<void> {
    if (parts.length < 2 || parts.length > 100 ||
        parts.some((part) => part.request.sourceId !== parts[0].request.sourceId ||
          part.request.width !== parts[0].request.width)) {
      throw new Error('쇼츠 구성에 사용할 원본 또는 출력 해상도가 일치하지 않습니다.');
    }
    const totalSeconds = parts.reduce((sum, part) => sum + part.request.end - part.request.start, 0);
    const folder = await mkdtemp(join(dirname(outputPath), '.shortfab-composition-'));
    const finalTemp = join(folder, 'joined.mp4');
    try {
      let completedSeconds = 0;
      for (let i = 0; i < parts.length; i++) {
        if (this.cancelled) throw new Error('렌더가 취소되었습니다.');
        const part = parts[i];
        const duration = part.request.end - part.request.start;
        const filename = join(folder, `segment-${String(i).padStart(3, '0')}.mp4`);
        this.segment = new RenderTask();
        await this.segment.run(sourcePath, filename, part.request, (value) => {
          const seconds = completedSeconds + Math.min(duration, value.seconds);
          progress({ phase: 'render', seconds, percent: Math.min(92, Math.floor(seconds / totalSeconds * 92)) });
        }, part.subtitles, part.layout, part.narration, true, part.style);
        this.segment = null;
        completedSeconds += duration;
      }
      if (this.cancelled) throw new Error('렌더가 취소되었습니다.');
      const list = parts.map((_, i) => `file 'segment-${String(i).padStart(3, '0')}.mp4'`).join('\n') + '\n';
      await writeFile(join(folder, 'segments.ffconcat'), list, { mode: 0o600 });
      // All segments have 30fps H.264 + 44.1kHz stereo AAC, even for silent source media.
      const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'concat',
        '-safe', '0', '-i', 'segments.ffconcat', '-map', '0:v:0', '-map', '0:a:0',
        '-c', 'copy', '-movflags', '+faststart', '-y', finalTemp];
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.env.SHORTFAB_FFMPEG_PATH || 'ffmpeg', args,
          { cwd: folder, env: externalToolEnv(), windowsHide: true });
        this.concat = child;
        let stderr = '';
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          if (error) reject(error);
          else resolve();
        };
        child.stdout.resume();
        child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-8000); });
        child.on('error', () => finish(new Error('FFmpeg 병합을 실행할 수 없습니다.')));
        child.on('close', (code) => {
          if (this.cancelled) finish(new Error('렌더가 취소되었습니다.'));
          else if (code !== 0) finish(new Error(stderr || '클립 병합에 실패했습니다.'));
          else finish();
        });
        if (this.cancelled) child.kill('SIGTERM');
      });
      if (this.cancelled) throw new Error('렌더가 취소되었습니다.');
      const out = await stat(finalTemp);
      if (out.size === 0) throw new Error('병합된 MP4 파일이 비어 있습니다.');
      const media = await probeMedia(finalTemp);
      if (media.width !== parts[0].request.width ||
          media.height !== parts[0].request.width * 16 / 9 ||
          !media.hasAudio || Math.abs(media.duration - totalSeconds) > Math.max(1, parts.length * 0.15)) {
        throw new Error('병합된 MP4 길이·영상·소리 검증에 실패했습니다.');
      }
      await rename(finalTemp, outputPath);
      progress({ phase: 'render', seconds: totalSeconds, percent: 100 });
    } finally {
      this.segment?.cancel();
      this.segment = null;
      this.concat = null;
      await rm(folder, { recursive: true, force: true }).catch(() => {});
    }
  }
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { app } from 'electron';
import { probeMedia } from './media.js';

export const personalSourceId = (videoId: string) => 'youtube:' + videoId;

export function isPersonalVideoId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

const binary = () => process.env.SHORTFAB_YTDLP_PATH?.trim() || 'yt-dlp';
const personalDir = () => join(app.getPath('userData'), 'sources', 'personal');
const safePath = () => [process.env.PATH ?? '', '/opt/homebrew/bin', '/usr/local/bin',
  '/usr/bin', '/bin'].join(delimiter);

export interface PersonalDownloadProgress {
  percent: number;
  seconds: number;
  phase: 'download';
}

export class PersonalVideoTask {
  private child: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;

  cancel(): void {
    this.cancelled = true;
    this.child?.kill('SIGTERM');
  }

  async acquire(videoId: string, minDuration: number,
    progress: (value: PersonalDownloadProgress) => void,
  ): Promise<{ path: string; duration: number }> {
    if (!isPersonalVideoId(videoId) || !Number.isFinite(minDuration) || minDuration <= 0) {
      throw new Error('YouTube 영상 ID와 클립 길이가 올바르지 않습니다.');
    }
    const folder = personalDir();
    const savedPath = join(folder, videoId + '.mp4');
    try {
      const info = await probeMedia(savedPath);
      const check = await stat(savedPath);
      if (check.isFile() && check.size > 0 && info.duration + 1 >= minDuration) {
        progress({ phase: 'download', percent: 49, seconds: 0 });
        return { path: savedPath, duration: info.duration };
      }
    } catch { /* No valid cached file. Re-acquire in a staging directory. */ }
    if (this.cancelled) throw new Error('가져오기가 취소되었습니다.');
    progress({ phase: 'download', percent: 5, seconds: 0 });
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const staging = join(folder, '.shortfab-' + randomUUID());
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const outputTemplate = join(staging, 'source.%(ext)s');
    const safeUrl = 'https://www.youtube.com/watch?v=' + videoId;
    const args = [
      '--ignore-config', '--no-plugin-dirs', '--no-remote-components',
      '--no-playlist', '--newline', '--no-warnings', '--no-part',
      '--no-write-info-json', '--no-write-thumbnail',
      '--no-mtime', '--no-continue',
      '--socket-timeout', '20', '--retries', '3', '--fragment-retries', '3',
      '--max-filesize', '4G',
      '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b',
      '--merge-output-format', 'mp4', '--remux-video', 'mp4',
      '-o', outputTemplate, safeUrl,
    ];
    if (process.env.SHORTFAB_FFMPEG_PATH) {
      args.splice(args.length - 3, 0, '--ffmpeg-location', process.env.SHORTFAB_FFMPEG_PATH);
    }
    const timeout = setTimeout(() => this.cancel(), 15 * 60_000);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(binary(), args, {
          windowsHide: true, env: { ...process.env, PATH: safePath() },
        });
        this.child = child;
        let diagnostic = '';
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
          diagnostic = (diagnostic + chunk).slice(-4000);
          const percentages = [...chunk.matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g)];
          if (percentages.length) {
            const value = Number(percentages[percentages.length - 1][1]);
            if (Number.isFinite(value)) progress({ phase: 'download',
              percent: Math.min(48, 5 + Math.floor(value * 0.43)), seconds: 0 });
          }
        });
        child.stderr.on('data', (chunk: string) => {
          diagnostic = (diagnostic + chunk).slice(-4000);
        });
        child.on('error', () => finish(new Error(
          'yt-dlp 실행 파일을 찾지 못했습니다. macOS: brew install yt-dlp ffmpeg / Windows: winget install yt-dlp.yt-dlp')));
        child.on('close', (code) => {
          if (this.cancelled) finish(new Error('YouTube 가져오기가 취소되었습니다.'));
          else if (code !== 0) finish(new Error(
            '공개 영상을 가져올 수 없습니다. URL/지역/접근 제한과 yt-dlp 업데이트를 확인해 주세요. ' +
            (/(?:Sign in|private|unavailable|copyright|DRM)/i.test(diagnostic)
              ? '이 영상은 별도 접근 제한이 있을 수 있습니다.' : '')));
          else finish();
        });
        if (this.cancelled) child.kill('SIGTERM');
      });
      if (this.cancelled) throw new Error('YouTube 가져오기가 취소되었습니다.');
      const candidates = (await readdir(staging)).filter(name =>
        name.startsWith('source.') && /\.(mp4|mkv|webm|mov)$/i.test(name));
      if (candidates.length !== 1) throw new Error('다운로드된 영상 파일을 식별하지 못했습니다.');
      const acquired = join(staging, candidates[0]);
      const info = await probeMedia(acquired);
      const file = await stat(acquired);
      if (!file.isFile() || !file.size || file.size > 4 * 1024 ** 3 ||
          info.duration + 1 < minDuration) {
        throw new Error('가져온 영상이 선택한 OUT 시각까지 포함하지 않습니다.');
      }
      // The cache contains a full media file so another clip can export without re-downloading.
      await rename(acquired, savedPath);
      progress({ phase: 'download', percent: 49, seconds: 0 });
      return { path: savedPath, duration: info.duration };
    } finally {
      clearTimeout(timeout);
      this.child = null;
      await rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}

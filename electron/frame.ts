import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { externalToolEnv } from './tool-env.js';

/** A small still from an actual local source, never a remote iframe screenshot. */
export class FramePreviewTask {
  private child: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;
  cancel() {
    this.cancelled = true;
    this.child?.kill('SIGTERM');
  }
  async capture(path: string, time: number): Promise<string> {
    if (this.cancelled || !Number.isFinite(time) || time < 0) throw new Error('미리보기 시각이 올바르지 않습니다.');
    const args = [
      '-hide_banner', '-nostdin', '-loglevel', 'error',
      '-ss', time.toFixed(3), '-i', path,
      '-map', '0:v:0', '-frames:v', '1',
      '-vf', 'scale=640:-2', '-c:v', 'mjpeg', '-q:v', '6',
      '-f', 'image2pipe', 'pipe:1',
    ];
    const image = await new Promise<Buffer>((resolve, reject) => {
      let finished = false;
      let total = 0;
      const chunks: Buffer[] = [];
      const child = spawn(process.env.SHORTFAB_FFMPEG_PATH || 'ffmpeg', args, {
        windowsHide: true, env: externalToolEnv(),
      });
      this.child = child;
      const timer = setTimeout(() => child.kill('SIGTERM'), 25_000);
      const finish = (err?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.child = null;
        if (err) reject(err);
        else resolve(Buffer.concat(chunks));
      };
      child.stdout.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > 900_000) {
          child.kill('SIGTERM');
          finish(new Error('미리보기 이미지가 너무 큽니다.'));
        } else chunks.push(chunk);
      });
      child.stderr.on('data', () => {}); // Do not expose absolute source paths.
      child.on('error', () => finish(new Error('프레임 미리보기용 FFmpeg 실행에 실패했습니다.')));
      child.on('close', (code) => {
        if (this.cancelled) finish(new Error('프레임 미리보기가 취소되었습니다.'));
        else if (code !== 0) finish(new Error('선택 구간에서 프레임을 추출할 수 없습니다.'));
        else finish();
      });
      if (this.cancelled) child.kill('SIGTERM');
    });
    if (this.cancelled || image.length < 100 || image[0] !== 0xff || image[1] !== 0xd8) {
      throw new Error('미리보기 프레임을 가져오지 못했습니다.');
    }
    return 'data:image/jpeg;base64,' + image.toString('base64');
  }
}

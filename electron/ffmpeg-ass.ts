import { spawn } from 'node:child_process';
import { externalToolEnv } from './tool-env.js';

export type AssCapability = 'supported' | 'unsupported' | 'unavailable';

/** An FFmpeg binary can encode MP4 yet lack the libass video filter. */
export function listsAssFilter(output: string): boolean {
  return /^\s*[.TSC]{3}\s+ass\s+V->V(?:\s|$)/m.test(output);
}

export async function probeAssCapability(binary: string): Promise<AssCapability> {
  return new Promise(resolve => {
    const child = spawn(binary, ['-hide_banner', '-filters'], {
      windowsHide: true, env: externalToolEnv(),
    });
    let output = '';
    let settled = false;
    const finish = (result: AssCapability) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish('unavailable');
    }, 5000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < 128_000) output += chunk.toString('utf8');
    });
    child.stderr.resume();
    child.on('error', () => finish('unavailable'));
    child.on('close', code => {
      finish(code === 0 ? (listsAssFilter(output) ? 'supported' : 'unsupported') : 'unavailable');
    });
  });
}

/** Prefer the installed FFmpeg; use Homebrew's keg-only full build when needed. */
export async function captionFFmpegBinary(
  preferred: string,
  alternatives: readonly string[] = process.platform === 'darwin' &&
    !process.env.SHORTFAB_FFMPEG_PATH?.trim()
      ? ['/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', '/usr/local/opt/ffmpeg-full/bin/ffmpeg']
      : [],
  probe: (binary: string) => Promise<AssCapability> = probeAssCapability,
): Promise<string> {
  let unsupported = false;
  for (const binary of new Set([preferred, ...alternatives])) {
    const capability = await probe(binary);
    if (capability === 'supported') return binary;
    if (capability === 'unsupported') unsupported = true;
  }
  if (unsupported) {
    throw new Error(
      '현재 FFmpeg에는 ASS 자막 필터(libass)가 없어 자막을 합성할 수 없습니다. ' +
      'macOS: brew install ffmpeg-full 을 실행한 뒤 다시 출력하세요. ' +
      '다른 OS에서는 libass가 활성화된 FFmpeg를 설치하고, 필요하면 ' +
      'SHORTFAB_FFMPEG_PATH를 해당 ffmpeg 실행 파일로 지정하세요.',
    );
  }
  throw new Error(
    'FFmpeg를 실행할 수 없습니다. 설치 및 PATH를 확인하거나 ' +
    'SHORTFAB_FFMPEG_PATH를 올바른 ffmpeg 실행 파일로 지정하세요.',
  );
}

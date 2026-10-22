import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { app } from 'electron';
import { externalToolEnv } from './tool-env.js';
import type { SttStatus } from '../src/shared/stt.js';

const engineBinary = () => process.env.SHORTFAB_WHISPER_PATH?.trim() || 'whisper-cli';
const configPath = () => join(app.getPath('userData'), 'settings', 'stt.json');

export async function sttModelPath(): Promise<string | null> {
  if (process.env.SHORTFAB_WHISPER_MODEL_PATH?.trim()) return process.env.SHORTFAB_WHISPER_MODEL_PATH.trim();
  try {
    const data = JSON.parse(await readFile(configPath(), 'utf8')) as { modelPath?: string };
    return typeof data.modelPath === 'string' && isAbsolute(data.modelPath) ? data.modelPath : null;
  } catch {
    return null;
  }
}

export async function modelValid(path: string | null): Promise<boolean> {
  if (!path || !isAbsolute(path) || !path.toLowerCase().endsWith('.bin')) return false;
  const file = await stat(path).catch(() => null);
  return Boolean(file?.isFile() && file.size >= 1_000_000);
}

export async function setSttModelPath(path: string): Promise<void> {
  if (!await modelValid(path)) throw new Error('다운로드한 GGML Whisper 모델(.bin)을 선택해 주세요.');
  const filename = configPath();
  await mkdir(join(app.getPath('userData'), 'settings'), { recursive: true, mode: 0o700 });
  const temp = filename + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, JSON.stringify({ modelPath: path }), { mode: 0o600, flag: 'wx' });
    await rename(temp, filename);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

/** Installation probe: no model download, audio uploads or arbitrary CLI flags. */
export async function sttStatus(): Promise<SttStatus> {
  const path = await sttModelPath();
  const engineAvailable = await new Promise<boolean>((resolve) => {
    const child = spawn(engineBinary(), ['--help'], { windowsHide: true, env: externalToolEnv() });
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => { child.kill(); finish(false); }, 5000);
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
    child.stdout.on('data', () => {});
    child.stderr.on('data', () => {});
  });
  const modelAvailable = await modelValid(path);
  return { engineAvailable, modelAvailable,
    modelName: modelAvailable ? basename(path!) : null };
}

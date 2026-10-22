import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEFAULT_WHISPER_MODEL = {
  filename: 'ggml-base.bin',
  source: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  bytes: 147_951_465,
  sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
} as const;

const TRUSTED_HOSTS = new Set([
  'huggingface.co', 'cdn-lfs.hf.co', 'cas-bridge.xethub.hf.co', 'transfer.xethub.hf.co',
]);

function trustedModelUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !TRUSTED_HOSTS.has(url.hostname)) {
    throw new Error('Whisper 모델 다운로드 주소가 허용되지 않았습니다.');
  }
  return url.toString();
}

async function checksum(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export interface ModelDownloadOptions {
  destination: string;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  // Injected fixtures are only used by offline tests, never exposed over IPC.
  source?: string;
  expectedBytes?: number;
  expectedSha256?: string;
  fetcher?: typeof fetch;
}

export async function downloadPinnedModel(options: ModelDownloadOptions): Promise<void> {
  const expectedBytes = options.expectedBytes ?? DEFAULT_WHISPER_MODEL.bytes;
  const expectedHash = options.expectedSha256 ?? DEFAULT_WHISPER_MODEL.sha256;
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 ||
      !/^[a-f0-9]{64}$/i.test(expectedHash)) throw new Error('모델 검증 설정이 올바르지 않습니다.');
  const existing = await stat(options.destination).catch(() => null);
  if (existing?.isFile() && existing.size === expectedBytes &&
      await checksum(options.destination) === expectedHash) {
    options.onProgress?.(100);
    return;
  }

  const requested = trustedModelUrl(options.source ?? DEFAULT_WHISPER_MODEL.source);
  const fetcher = options.fetcher ?? fetch;
  await mkdir(dirname(options.destination), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(options.destination), '.shortfab-model-' + randomUUID() + '.tmp');
  try {
    let current = requested;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      if (options.signal?.aborted) throw new Error('모델 다운로드가 취소되었습니다.');
      response = await fetcher(current, {
        redirect: 'manual',
        signal: options.signal ?? AbortSignal.timeout(180_000),
        headers: { 'User-Agent': 'ShortFab/0.1 model installer' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location');
        if (!next) throw new Error('모델 다운로드 이동 주소를 확인할 수 없습니다.');
        current = trustedModelUrl(new URL(next, current).toString());
        await response.body?.cancel();
        response = null;
        continue;
      }
      break;
    }
    if (!response) throw new Error('모델 다운로드 주소가 너무 많이 이동했습니다.');
    if (!response.ok || !response.body) throw new Error('모델 파일을 내려받지 못했습니다 (HTTP ' + response.status + ').');
    const advertised = response.headers.get('content-length');
    if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > expectedBytes)) {
      throw new Error('다운로드 크기가 예상한 모델 파일보다 큽니다.');
    }

    let received = 0;
    let lastPercent = -1;
    const hash = createHash('sha256');
    const file = await open(temporary, 'wx', 0o600);
    try {
      const reader = response.body.getReader();
      try {
        while (true) {
          if (options.signal?.aborted) throw new Error('모델 다운로드가 취소되었습니다.');
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > expectedBytes) throw new Error('모델 파일이 예상 크기를 초과했습니다.');
          hash.update(value);
          await file.writeFile(value);
          const percent = Math.floor(received / expectedBytes * 100);
          if (percent !== lastPercent) {
            options.onProgress?.(percent);
            lastPercent = percent;
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } finally {
      await file.close();
    }
    if (options.signal?.aborted) throw new Error('모델 다운로드가 취소되었습니다.');
    if (received !== expectedBytes || hash.digest('hex') !== expectedHash) {
      throw new Error('다운로드한 모델의 크기 또는 SHA-256 검증에 실패했습니다.');
    }
    // Avoid replacing the user's selected model: only replace our app-owned cached basename.
    await rm(options.destination, { force: true });
    await rename(temporary, options.destination);
    options.onProgress?.(100);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

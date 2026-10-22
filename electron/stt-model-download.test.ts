import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadPinnedModel } from './stt-model-download';

const payload = Buffer.from('checked test model');
const sha = createHash('sha256').update(payload).digest('hex');

describe('pinned Whisper model installer', () => {
  it('downloads once, checks SHA-256 and reuses verified cache', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shortfab-model-test-'));
    try {
      const path = join(dir, 'model.bin');
      let calls = 0;
      const progress: number[] = [];
      const fetcher = (async () => {
        calls++;
        return new Response(payload, { headers: { 'content-length': String(payload.length) } });
      }) as typeof fetch;
      const args = { destination: path, source: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
        expectedBytes: payload.length, expectedSha256: sha, fetcher,
        onProgress: (value: number) => progress.push(value) };
      await downloadPinnedModel(args);
      await downloadPinnedModel(args);
      expect(calls).toBe(1);
      expect(await readFile(path)).toEqual(payload);
      expect(progress.at(-1)).toBe(100);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('rejects a malicious redirect and cleans up a damaged model download', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shortfab-model-reject-'));
    try {
      const common = { destination: join(dir, 'model.bin'), expectedBytes: payload.length,
        expectedSha256: sha };
      await expect(downloadPinnedModel({ ...common,
        fetcher: (async () => new Response(null, { status: 302,
          headers: { location: 'http://127.0.0.1/internal' } })) as typeof fetch,
      })).rejects.toThrow('허용되지');
      await expect(downloadPinnedModel({ ...common,
        fetcher: (async () => new Response(Buffer.from('malformed bytes'))) as typeof fetch,
      })).rejects.toThrow('검증에 실패');
      expect(await readdir(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('keeps an abort safe and never installs an unverified file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shortfab-model-cancel-'));
    try {
      const ctrl = new AbortController();
      ctrl.abort();
      await expect(downloadPinnedModel({ destination: join(dir, 'model.bin'), signal: ctrl.signal,
        expectedBytes: payload.length, expectedSha256: sha,
        fetcher: (async () => { throw Error('should not download'); }) as typeof fetch,
      })).rejects.toThrow('취소');
      expect(await readdir(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it('replaces corrupt app-owned cached model only after successful verification', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shortfab-model-repair-'));
    try {
      const destination = join(dir, 'model.bin');
      await writeFile(destination, Buffer.alloc(payload.length));
      await downloadPinnedModel({ destination, expectedBytes: payload.length, expectedSha256: sha,
        fetcher: (async () => new Response(payload)) as typeof fetch });
      expect(await readFile(destination)).toEqual(payload);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mappedClipRange, type MediaBinding } from '../src/shared/sources.js';
import { validateRenderRequest } from '../src/shared/contracts.js';
import { probeMedia } from './media.js';
import { RenderTask } from './render.js';

const binaryReady = ['ffmpeg', 'ffprobe'].every(cmd =>
  spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0);

describe('YouTube time mapping into three MP4 renders', () => {
  it.skipIf(!binaryReady)('creates three playable 9:16 clips from a synthetic, authorized fixture', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'shortfab-integration-'));
    const source = join(folder, 'rights-holder-test.mp4');
    try {
      const generated = spawnSync('ffmpeg', [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'color=c=blue:s=320x180:r=24', '-f', 'lavfi',
        '-i', 'sine=frequency=440:sample_rate=44100', '-t', '5',
        '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'aac', '-shortest', '-y', source,
      ], { timeout: 25_000, encoding: 'utf8' });
      expect(generated.status, generated.stderr || 'FFmpeg test fixture creation failed').toBe(0);
      const info = await probeMedia(source);
      const binding: MediaBinding = {
        referenceVideoId: 'abcdefghijk',
        sourceAssetId: '7c46c866-a122-4124-8d5c-26339e2686f0',
        provider: 'creator_file', fileName: 'rights-holder-test.mp4', durationSeconds: info.duration,
        sizeBytes: 1, sha256: 'a'.repeat(64), startOffsetSeconds: 0.3,
        rights: { rightsHolder: 'Test author', evidenceRef: 'integration test',
          allowClip: true, allowDerivativeEdit: true, allowRepost: false,
          allowedPlatforms: [], expiresAt: null, declaredAt: new Date().toISOString() },
      };
      const moments = [[0, 1], [1.3, 2.3], [2.6, 3.6]];
      for (let index = 0; index < moments.length; index++) {
        const [start, end] = moments[index];
        const mapped = mappedClipRange(start, end, binding);
        const request = validateRenderRequest({
          ...mapped, sourceId: binding.sourceAssetId, width: 720,
        }, info.duration);
        const output = join(folder, 'short-' + index + '.mp4');
        await new RenderTask().run(source, output, request, () => {},
          index === 0 ? { preset: 'boxed', cues: [
            { id: 'caption-1', start: 0.15, end: 0.85, text: '테스트 한글' },
          ] } : null);
        const created = await probeMedia(output);
        expect(created.width).toBe(720);
        expect(created.height).toBe(1280);
        expect(created.hasAudio).toBe(true);
        expect(created.duration).toBeGreaterThan(0.75);
        expect(created.duration).toBeLessThan(1.4);
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 60_000);
});

import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompositionTask } from './composition.js';
import { probeMedia } from './media.js';
import { validateRenderRequest } from '../src/shared/contracts.js';

const hasTools = ['ffmpeg', 'ffprobe'].every((cmd) =>
  spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0);

describe('ordered multi-part MP4 export', () => {
  it.skipIf(!hasTools)('joins two non-contiguous segments into ONE silent-source short with audio', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'shortfab-montage-test-'));
    try {
      const original = join(folder, 'original.mp4');
      const output = join(folder, 'one-short.mp4');
      const created = spawnSync('ffmpeg', [
        '-hide_banner', '-nostdin', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30',
        '-t', '4', '-c:v', 'mpeg4', '-q:v', '7', '-y', original,
      ], { encoding: 'utf8', timeout: 20000 });
      expect(created.status, created.stderr).toBe(0);
      const progress: number[] = [];
      const requests = [
        validateRenderRequest({ sourceId: 'synthetic', start: 2.1, end: 2.8, width: 720 }, 4),
        validateRenderRequest({ sourceId: 'synthetic', start: 0.3, end: 1.1, width: 720 }, 4),
      ];
      await new CompositionTask().run(original, output, requests.map((request) => ({
        request, layout: null, subtitles: null, narration: null,
      })), (value) => progress.push(value.percent));
      const movie = await probeMedia(output);
      expect(movie.width).toBe(720);
      expect(movie.height).toBe(1280);
      expect(movie.hasAudio).toBe(true); // Silence track for stable AAC composition.
      expect(movie.duration).toBeGreaterThan(1.2);
      expect(movie.duration).toBeLessThan(2.5);
      expect(progress.at(-1)).toBe(100);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }, 90_000);

  it('validates the composition source before writing anything', async () => {
    const one = validateRenderRequest({ sourceId: 'a', start: 0, end: 1, width: 720 }, 5);
    const other = { ...one, sourceId: 'b' };
    await expect(new CompositionTask().run('not-used', 'not-used',
      [one, other].map((request) => ({ request, layout: null, subtitles: null, narration: null })),
      () => {})).rejects.toThrow('원본');
  });
});

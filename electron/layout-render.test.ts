import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { layoutDefault } from '../src/shared/layout-styles';
import { validateRenderRequest } from '../src/shared/contracts';
import { probeMedia } from './media';
import { FramePreviewTask } from './frame';
import { RenderTask } from './render';

const available = ['ffmpeg', 'ffprobe'].every(binary =>
  spawnSync(binary, ['-version'], { stdio: 'ignore' }).status === 0);

describe('AG3 actual composed frame and style MP4', () => {
  it.skipIf(!available)('extracts a real frame and exports crop + blur layouts with subtitles', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'shortfab-style-test-'));
    try {
      const source = join(temp, 'source.mp4');
      const generated = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'testsrc2=size=320x180:rate=15', '-f', 'lavfi',
        '-i', 'sine=frequency=540:sample_rate=16000',
        '-t', '3', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', '-y', source,
      ], { timeout: 20_000, encoding: 'utf8' });
      expect(generated.status, generated.stderr).toBe(0);
      const frame = await new FramePreviewTask().capture(source, 1);
      expect(frame.startsWith('data:image/jpeg;base64,/9j/')).toBe(true);
      for (const style of ['center', 'focus-left', 'blur-fill'] as const) {
        const output = join(temp, style + '.mp4');
        const request = validateRenderRequest({
          sourceId: 'youtube:abcdefghijk', start: 0.2, end: 1.15, width: 720,
        }, 3);
        await new RenderTask().run(source, output, request, () => {},
          style === 'blur-fill' ? { preset: 'impact', cues: [
            { id: 'test-cue', start: 0.1, end: 0.6, text: 'Style test', emphasis: true },
          ], hook: { text: 'Look at this', duration: 0.7, style: 'banner' } } : null, layoutDefault(style));
        const media = await probeMedia(output);
        expect(media.width).toBe(720);
        expect(media.height).toBe(1280);
        expect(media.duration).toBeGreaterThan(0.75);
        expect(media.hasAudio).toBe(true);
      }
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }, 65_000);
});

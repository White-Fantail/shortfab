import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { CAPTION_CANVAS_SCRIPT_FOR_TEST, captionIntervals, captionOverlayGraph } from './caption-overlay';

describe('libass-free caption image timeline', () => {
  it('preserves cue gaps and independent hook overlap', () => {
    const slices = captionIntervals({
      preset: 'boxed', cues: [
        { id: 'a', start: 0.5, end: 1.5, text: '안녕' },
        { id: 'b', start: 2, end: 3, text: 'Hello', emphasis: true },
      ], hook: { text: '시작', duration: 1, style: 'banner' },
    }, 4);
    expect(slices.map(item => [item.start, item.end])).toEqual([
      [0, .5], [.5, 1], [1, 1.5], [1.5, 2], [2, 3], [3, 4],
    ]);
    expect(slices[0].cue).toBeNull();
    expect(slices[0].hook?.text).toBe('시작');
    expect(slices[2].hook).toBeNull();
    expect(slices[4].cue?.emphasis).toBe(true);
    expect(slices[5].cue).toBeNull();
  });
  it('supports hook-only tracks and rejects invalid timing', () => {
    expect(captionIntervals({ preset: 'classic', cues: [],
      hook: { text: 'Top', duration: .8, style: 'simple' } }, 2))
      .toHaveLength(2);
    expect(() => captionIntervals({ preset: 'classic', cues: [
      { id: 'bad', start: 1, end: 5, text: 'bad' },
    ] }, 2)).toThrow();
  });
  it('composes either regular or blur layout using only one transparent overlay stream', () => {
    expect(captionOverlayGraph('fps=30', false))
      .toContain('[0:v:0]fps=30[v];[v][1:v]overlay=');
    expect(captionOverlayGraph('[0:v:0]scale=720:1280[v]', true))
      .toContain('[v][1:v]overlay=');
  });
});

const ffmpegReady = ['ffmpeg', 'ffprobe'].every(binary =>
  spawnSync(binary, ['-version'], { stdio: 'ignore' }).status === 0);

describe('FFmpeg PNG overlay composition without libass', () => {
  it.skipIf(!ffmpegReady)('encodes a timed image overlay through the existing video encoder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shortfab-png-overlay-'));
    try {
      const frame = join(dir, 'caption-0.png');
      const source = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=red:s=128x128:r=15:d=1', '-frames:v', '1', '-y', frame,
      ], { timeout: 15_000, encoding: 'utf8' });
      expect(source.status, source.stderr).toBe(0);
      await writeFile(join(dir, 'captions.ffconcat'),
        ['ffconcat version 1.0', "file 'caption-0.png'", 'duration 1.0',
          "file 'caption-0.png'"].join("\n") + "\n");
      const output = join(dir, 'out.mp4');
      const render = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=blue:s=128x128:r=15:d=2', '-f', 'concat', '-safe', '0', '-i',
        join(dir, 'captions.ffconcat'), '-t', '2', '-filter_complex',
        captionOverlayGraph('scale=128:128,fps=15', false),
        '-map', '[outputv]', '-c:v', 'mpeg4', '-y', output,
      ], { timeout: 20_000, encoding: 'utf8' });
      expect(render.status, render.stderr).toBe(0);
      const inspect = spawnSync('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0', '-show_entries',
        'stream=width,height', '-of', 'csv=p=0', output,
      ], { encoding: 'utf8' });
      expect(inspect.status).toBe(0);
      expect(inspect.stdout.trim()).toBe('128,128');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 40_000);
});

describe('sandboxed caption canvas script', () => {
  it('parses and draws Korean captions and a separate hook using only local canvas', async () => {
    const drawn: string[] = [];
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({
        measureText: (value: string) => ({ width: value.length * 15 }),
        fillText: (value: string) => drawn.push(value),
        strokeText: () => {},
        fillRect: () => {},
      }),
      toDataURL: () => 'data:image/png;base64,AAAA',
    };
    const payload = { width: 720, preset: 'boxed',
      cue: { text: '안녕하세요', emphasis: false },
      hook: { text: 'Watch this!', style: 'banner' } };
    const run = new Script('(' + CAPTION_CANVAS_SCRIPT_FOR_TEST + ')(' +
      JSON.stringify(payload) + ')');
    const result = await run.runInNewContext({
      document: { createElement: () => canvas },
    });
    expect(result).toBe('data:image/png;base64,AAAA');
    expect(canvas.width).toBe(720);
    expect(canvas.height).toBe(1280);
    expect(drawn).toContain('안녕하세요');
    expect(drawn).toContain('Watch this!');
  });
  it('renders fixed top/bottom text independently of spoken cues', async () => {
    const text: string[] = [];
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({
        measureText: (v: string) => ({ width: v.length * 12 }),
        fillText: (v: string) => text.push(v),
        strokeText: () => {},
        fillRect: () => {},
      }),
      toDataURL: () => 'data:image/png;base64,AAAA',
    };
    const script = new Script('(' + CAPTION_CANVAS_SCRIPT_FOR_TEST + ')(' +
      JSON.stringify({ width: 720, preset: 'classic', cue: null, hook: null,
        fixed: { top: { kind: 'text', text: 'TOP', color: '#ffffff', size: 48, background: true },
          bottom: { kind: 'text', text: 'BOTTOM', color: '#ffe500', size: 38, background: false } },
      }) + ')');
    expect(await script.runInNewContext({ document: { createElement: () => canvas } }))
      .toBe('data:image/png;base64,AAAA');
    expect(text).toEqual(['TOP', 'BOTTOM']);
  });
});

import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SttTask } from './stt';

const ffmpegReady = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
describe('local offline STT pipeline', () => {
  it.skipIf(!ffmpegReady)('converts a selected range to WAV and imports a fake whisper-cli SRT', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shortfab-stt-test-'));
    try {
      const movie = join(dir, 'input.mp4');
      const model = join(dir, 'model.bin');
      const cli = join(dir, 'fake-cli.cjs');
      const ff = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=blue:s=320x180:r=24', '-f', 'lavfi',
        '-i', 'sine=frequency=440:sample_rate=16000',
        '-t', '4', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', '-y', movie,
      ], { timeout: 20000, encoding: 'utf8' });
      expect(ff.status, ff.stderr || 'Failed to create fixture').toBe(0);
      await writeFile(model, Buffer.alloc(1_000_001));
      await writeFile(cli, [
        '#!/usr/bin/env node',
        'const fs=require("node:fs");',
        'const args=process.argv;',
        'const wav=args[args.indexOf("-f")+1];',
        'if (!fs.statSync(wav).size) process.exit(12);',
        'const prefix=args[args.indexOf("-of")+1];',
        'fs.writeFileSync(prefix+".srt", "1\\n00:00:00,150 --> 00:00:01,200\\n테스트 자막\\n");',
      ].join('\n'), { mode: 0o700 });
      await chmod(cli, 0o700);
      const phases: string[] = [];
      const track = await new SttTask({ ffmpeg: 'ffmpeg', whisper: cli }).run({
        sourcePath: movie, modelPath: model, start: 1, end: 3,
        language: 'ko', preset: 'boxed',
      }, value => phases.push(value));
      expect(phases).toEqual(['extract', 'transcribe']);
      expect(track.cues).toHaveLength(1);
      expect(track.cues[0].start).toBe(0.15);
      expect(track.cues[0].text).toBe('테스트 자막');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }, 50000);
});

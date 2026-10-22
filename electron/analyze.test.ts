import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => process.env.SHORTFAB_ANALYZE_TEST_HOME ?? '' },
}));

import { AnalyzeVideoTask } from './analyze';

const ffmpeg = ['ffmpeg', 'ffprobe'].every(bin =>
  spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0);

describe('AG2 local source -> transcript -> suggestions -> cache', () => {
  it.skipIf(!ffmpeg)('selects spoken clips from a fake Whisper transcript and reuses cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shortfab-ag2-'));
    const prior = ['SHORTFAB_ANALYZE_TEST_HOME', 'SHORTFAB_TEST_VIDEO', 'SHORTFAB_YTDLP_PATH',
      'SHORTFAB_WHISPER_PATH'].map(key => [key, process.env[key]] as const);
    try {
      const fixture = join(root, 'source.mp4');
      const yt = join(root, 'fake-ytdlp');
      const whisper = join(root, 'fake-whisper');
      const model = join(root, 'model.bin');
      const generated = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=8',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000',
        '-t', '70', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', '-y', fixture,
      ], { timeout: 25_000, encoding: 'utf8' });
      expect(generated.status, generated.stderr).toBe(0);
      await writeFile(model, Buffer.alloc(1_000_001));
      await writeFile(yt, [
        '#!/usr/bin/env node',
        "const fs=require('node:fs');",
        'const args=process.argv.slice(2);',
        "const path=args[args.indexOf('-o')+1];",
        "fs.copyFileSync(process.env.SHORTFAB_TEST_VIDEO,path.replace('%(ext)s','mp4'));",
      ].join('\n'), { mode: 0o700 });
      const fakeLines = Array.from({ length: 20 }, (_, i) => [
        String(i + 1),
        `00:00:${String(i * 3).padStart(2, '0')},000 --> 00:00:${String(i * 3 + 2).padStart(2, '0')},500`,
        i % 3 === 0 ? '왜 이 영상이 특별할까요? 놀라운 결과입니다!' :
          '실제로 다음 장면에서 결과를 확인했습니다.',
      ].join('\\n')).join('\\n\\n');
      await writeFile(whisper, [
        '#!/usr/bin/env node',
        "const fs=require('node:fs');",
        'const args=process.argv.slice(2);',
        "fs.writeFileSync(args[args.indexOf('-of')+1]+'.srt', "+JSON.stringify(fakeLines)+");",
      ].join('\n'), { mode: 0o700 });
      await chmod(yt, 0o700);
      await chmod(whisper, 0o700);
      process.env.SHORTFAB_ANALYZE_TEST_HOME = root;
      process.env.SHORTFAB_TEST_VIDEO = fixture;
      process.env.SHORTFAB_YTDLP_PATH = yt;
      process.env.SHORTFAB_WHISPER_PATH = whisper;
      const request = { videoId: 'abcdefghijk', duration: 70, language: 'ko' as const,
        mode: 'balanced' as const, refresh: false };
      const phases: string[] = [];
      const first = await new AnalyzeVideoTask().run(request, model, event => phases.push(event.phase));
      expect(first.status).toBe('completed');
      if (first.status !== 'completed') throw new Error('Unexpected cancellation');
      expect(first.analysis.segments.length).toBe(20);
      expect(first.analysis.candidates.length).toBeGreaterThan(0);
      expect(first.analysis.candidates[0].transcript).toContain('영상');
      expect(first.analysis.status).toBe('ready');
      expect(phases).toContain('source');
      expect(phases).toContain('transcribe');
      process.env.SHORTFAB_YTDLP_PATH = '/missing/yt-dlp';
      process.env.SHORTFAB_WHISPER_PATH = '/missing/whisper';
      const cached = await new AnalyzeVideoTask().run({ ...request, mode: 'shorter' }, model, () => {});
      expect(cached.status).toBe('completed');
      if (cached.status === 'completed') {
        expect(cached.analysis.candidates.length).toBeGreaterThan(0);
        expect(cached.analysis.mode).toBe('shorter');
      }
    } finally {
      for (const [key, value] of prior) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});

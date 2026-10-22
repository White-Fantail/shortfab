import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => process.env.SHORTFAB_TEST_USERDATA ?? '' },
}));

import { PersonalVideoTask, personalSourceId, isPersonalVideoId } from './personal.js';

const supported = ['ffmpeg', 'ffprobe'].every(name =>
  spawnSync(name, ['-version'], { stdio: 'ignore' }).status === 0);

describe('direct public video clip acquisition', () => {
  it('only constructs canonical YouTube IDs (never arbitrary input URLs)', () => {
    expect(isPersonalVideoId('abcdefghijk')).toBe(true);
    expect(isPersonalVideoId('https://unsafe/')).toBe(false);
    expect(isPersonalVideoId('ABCDEFGHIJK;rm')).toBe(false);
    expect(personalSourceId('abcdefghijk')).toBe('youtube:abcdefghijk');
  });

  it.skipIf(!supported)('acquires to a private cache and reuses it without a second download', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shortfab-personal-'));
    const fixture = join(root, 'fixture.mp4');
    const fakeCli = join(root, 'fake-yt-dlp');
    const previous = { data: process.env.SHORTFAB_TEST_USERDATA,
      file: process.env.SHORTFAB_TEST_FIXTURE, bin: process.env.SHORTFAB_YTDLP_PATH };
    try {
      const generated = spawnSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
        'color=c=red:s=160x90:r=24', '-t', '4', '-c:v', 'mpeg4', '-y', fixture,
      ], { timeout: 20_000, encoding: 'utf8' });
      expect(generated.status, generated.stderr).toBe(0);
      const cliText = [
        '#!/usr/bin/env node',
        "const fs = require('node:fs');",
        'const a = process.argv.slice(2);',
        "const dest = a[a.indexOf('-o') + 1];",
        "if (!/watch\\?v=abcdefghijk$/.test(a.at(-1))) process.exit(2);",
        "fs.copyFileSync(process.env.SHORTFAB_TEST_FIXTURE, dest.replace('%(ext)s', 'mp4'));",
        'process.stdout.write("[download] 100% done\\n");',
      ].join('\n');
      await writeFile(fakeCli, cliText, { mode: 0o700 });
      await chmod(fakeCli, 0o700);
      process.env.SHORTFAB_TEST_USERDATA = root;
      process.env.SHORTFAB_TEST_FIXTURE = fixture;
      process.env.SHORTFAB_YTDLP_PATH = fakeCli;
      const progress: number[] = [];
      const task = new PersonalVideoTask();
      const result = await task.acquire('abcdefghijk', 2, event => progress.push(event.percent));
      expect(result.duration).toBeGreaterThan(2);
      expect(await readFile(result.path)).toEqual(await readFile(fixture));
      expect(progress).toContain(49);
      process.env.SHORTFAB_YTDLP_PATH = '/not-a-real-yt-dlp';
      const cached = await new PersonalVideoTask().acquire('abcdefghijk', 2, () => {});
      expect(cached.path).toBe(result.path);
    } finally {
      for (const [env, value] of [
        ['SHORTFAB_TEST_USERDATA', previous.data],
        ['SHORTFAB_TEST_FIXTURE', previous.file],
        ['SHORTFAB_YTDLP_PATH', previous.bin],
      ] as const) {
        if (value === undefined) delete process.env[env]; else process.env[env] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  }, 35_000);
});

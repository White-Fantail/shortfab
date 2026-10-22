import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { splitNarration, validateNarration, type NarrationConfig } from '../src/shared/narration.js';
import type { SubtitleCue } from '../src/shared/subtitles.js';

const exec = promisify(execFile);
export interface SpokenNarration {
  file: string;
  cues: SubtitleCue[];
  seconds: number;
}

/** ShortFab executes only allowlisted, non-shell local TTS commands. No cloud transfer. */
export async function synthesizeNarration(
  input: NarrationConfig, clipSeconds: number, directory: string, signal?: AbortSignal,
): Promise<SpokenNarration> {
  const narration = validateNarration(input);
  if (!narration || narration.mode !== 'tts') throw new Error('나레이션이 활성화되지 않았습니다.');
  if (process.platform !== 'darwin') {
    throw new Error('현재 나레이션 음성 출력은 macOS 시스템 음성(say)에서만 지원됩니다.');
  }
  const voice = narration.voice === 'ko' ? 'Yuna' : 'Samantha';
  const segments = splitNarration(narration.text);
  const manifest = ['ffconcat version 1.0'];
  const cues: SubtitleCue[] = [];
  let seconds = 0;
  for (const [index, text] of segments.entries()) {
    if (signal?.aborted) throw new Error('나레이션 합성이 취소되었습니다.');
    const basename = 'narration-' + index;
    const script = join(directory, basename + '.txt');
    const audio = join(directory, basename + '.aiff');
    await writeFile(script, text, { mode: 0o600 });
    try {
      await exec('/usr/bin/say', ['-v', voice, '-f', script, '-o', audio], {
        signal, timeout: 120000, maxBuffer: 20000,
      });
    } catch (error) {
      if (signal?.aborted) throw new Error('나레이션 합성이 취소되었습니다.');
      throw new Error(`macOS 음성 ${voice}를 사용할 수 없습니다. 시스템 설정에서 음성 설치를 확인하세요. ${String(error).slice(0, 180)}`);
    }
    const probeBin = process.env.SHORTFAB_FFPROBE_PATH || 'ffprobe';
    const { stdout } = await exec(probeBin, ['-v','error','-show_entries','format=duration',
      '-of','default=noprint_wrappers=1:nokey=1',audio], { signal, timeout: 15000 });
    const length = Number(stdout.trim());
    if (!Number.isFinite(length) || length < 0.1) throw new Error('생성된 나레이션 음성 길이를 확인할 수 없습니다.');
    const start = seconds;
    seconds += length;
    if (seconds > clipSeconds + 0.01) {
      throw new Error(`나레이션 길이(${seconds.toFixed(1)}초)가 영상(${clipSeconds.toFixed(1)}초)보다 깁니다. 원고를 줄이거나 클립 길이를 늘려 주세요.`);
    }
    cues.push({ id: basename, start: Number(start.toFixed(4)), end: Number(seconds.toFixed(4)), text });
    manifest.push(`file '${basename}.aiff'`);
  }
  const file = join(directory, 'narration.ffconcat');
  await writeFile(file, manifest.join('\n') + '\n', { mode: 0o600 });
  return { file, cues, seconds };
}

/** Optional input captions shift voice to stream 2; no source audio maps TTS alone. */
export function narrationAudioFilter(sourceHasAudio: boolean, audioIndex: number): {
  graph: string | null; map: string;
} {
  if (!Number.isSafeInteger(audioIndex) || audioIndex < 1 || audioIndex > 2) {
    throw new Error('나레이션 스트림 인덱스가 올바르지 않습니다.');
  }
  return sourceHasAudio ? {
    graph: `[0:a:0]volume=0.18[bed];[${audioIndex}:a:0]volume=1[spoken];[bed][spoken]amix=inputs=2:duration=first:dropout_transition=0[outa]`,
    map: '[outa]',
  } : { graph: null, map: audioIndex + ':a:0' };
}

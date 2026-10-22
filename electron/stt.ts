import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { externalToolEnv } from './tool-env.js';
import { MAX_STT_SECONDS, parseWhisperSrt, type SttLanguage, type SttPhase } from '../src/shared/stt.js';
import type { SubtitleTrack } from '../src/shared/subtitles.js';

const defaultFfmpeg = () => process.env.SHORTFAB_FFMPEG_PATH?.trim() || 'ffmpeg';
const defaultWhisper = () => process.env.SHORTFAB_WHISPER_PATH?.trim() || 'whisper-cli';

export interface TranscriptionInput {
  sourcePath: string;
  modelPath: string;
  start: number;
  end: number;
  language: SttLanguage;
  preset: SubtitleTrack['preset'];
}

/** Isolated subprocess worker. No audio or transcript leaves the computer. */
export class SttTask {
  private child: ChildProcessWithoutNullStreams | null = null;
  private cancelled = false;

  constructor(private readonly binaries: { ffmpeg: string; whisper: string } = {
    ffmpeg: defaultFfmpeg(), whisper: defaultWhisper(),
  }) {}

  cancel(): void {
    this.cancelled = true;
    this.child?.kill('SIGTERM');
  }
  get isCancelled(): boolean { return this.cancelled; }

  private async execute(binary: string, args: string[], phase: SttPhase): Promise<void> {
    if (this.cancelled) throw new Error('자동 자막 생성이 취소되었습니다.');
    await new Promise<void>((resolve, reject) => {
      let done = false;
      let stderr = '';
      const child = spawn(binary, args, { windowsHide: true, env: externalToolEnv() });
      this.child = child;
      const timeout = setTimeout(() => child.kill('SIGTERM'), 20 * 60_000);
      const finish = (reason?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        if (reason) reject(reason); else resolve();
      };
      child.stdout.on('data', () => {}); // Never relay transcript or media to logs.
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-1200);
      });
      child.once('error', () => finish(new Error(
        phase === 'extract'
          ? 'FFmpeg를 실행하지 못했습니다. ffmpeg 설치를 확인하세요.'
          : 'whisper-cli를 실행하지 못했습니다. whisper.cpp 설치를 확인하세요.')));
      child.once('close', (code) => {
        if (this.cancelled) finish(new Error('자동 자막 생성이 취소되었습니다.'));
        else if (code !== 0) finish(new Error(phase === 'extract'
          ? '클립 음성을 추출하지 못했습니다. 원본에 오디오가 있는지 확인해 주세요.'
          : '음성 인식에 실패했습니다. GGML 모델·언어 설정 또는 오디오를 확인해 주세요.'));
        else finish();
      });
      if (this.cancelled) child.kill('SIGTERM');
    });
    this.child = null;
  }

  /**
   * Transcribe one <= 9-minute source slice for AG2, retaining every speech
   * segment (the subtitle editor's 30-cue limit must not truncate analysis).
   */
  async transcribeSlice(input: Omit<TranscriptionInput, 'preset'>,
    onPhase: (phase: SttPhase) => void): Promise<string> {
    const seconds = input.end - input.start;
    if (!Number.isFinite(input.start) || !Number.isFinite(input.end) ||
        input.start < 0 || seconds < 0.2 || seconds > MAX_STT_SECONDS ||
        !['auto', 'ko', 'en'].includes(input.language)) {
      throw new Error('영상 분석 구간이 올바르지 않습니다.');
    }
    const model = await stat(input.modelPath).catch(() => null);
    if (!model?.isFile() || model.size < 1_000_000) throw new Error('Whisper 모델 파일을 찾을 수 없습니다.');
    const directory = await mkdtemp(join(tmpdir(), 'shortfab-analysis-'));
    const wav = join(directory, 'source.wav');
    const prefix = join(directory, 'speech');
    try {
      onPhase('extract');
      await this.execute(this.binaries.ffmpeg, [
        '-hide_banner', '-nostdin', '-loglevel', 'error',
        '-ss', input.start.toFixed(3), '-i', input.sourcePath,
        '-t', seconds.toFixed(3), '-map', '0:a:0', '-vn',
        '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav,
      ], 'extract');
      onPhase('transcribe');
      await this.execute(this.binaries.whisper, [
        '-m', input.modelPath, '-f', wav, '-l', input.language,
        '-osrt', '-of', prefix, '-np',
      ], 'transcribe');
      const file = await stat(prefix + '.srt').catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw error;
      });
      // whisper-cli may write no SRT file when the source contains silence.
      if (!file) return '';
      if (!file.isFile() || file.size > 2 * 1024 * 1024) throw new Error('영상 음성 분석 파일이 올바르지 않습니다.');
      return await readFile(prefix + '.srt', 'utf8');
    } finally {
      this.child = null;
      await rm(directory, { force: true, recursive: true }).catch(() => {});
    }
  }

  async run(input: TranscriptionInput, onPhase: (phase: SttPhase) => void): Promise<SubtitleTrack> {
    const clipSeconds = input.end - input.start;
    if (!Number.isFinite(input.start) || !Number.isFinite(input.end) || input.start < 0 ||
      clipSeconds < 0.2 || clipSeconds > MAX_STT_SECONDS ||
      !['auto', 'ko', 'en'].includes(input.language)) {
      throw new Error('자동 자막은 0.2초~10분의 유효한 클립에서만 생성할 수 있습니다.');
    }
    const model = await stat(input.modelPath).catch(() => null);
    if (!model?.isFile() || model.size < 1_000_000) {
      throw new Error('GGML Whisper 모델 파일을 찾을 수 없습니다. 모델(.bin)을 다시 선택해 주세요.');
    }
    const directory = await mkdtemp(join(tmpdir(), 'shortfab-stt-'));
    const wav = join(directory, 'audio.wav');
    const prefix = join(directory, 'transcript');
    try {
      onPhase('extract');
      await this.execute(this.binaries.ffmpeg, [
        '-hide_banner', '-nostdin', '-loglevel', 'error',
        '-ss', input.start.toFixed(3), '-i', input.sourcePath,
        '-t', clipSeconds.toFixed(3),
        '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000',
        '-c:a', 'pcm_s16le', '-y', wav,
      ], 'extract');
      if (this.cancelled) throw new Error('자동 자막 생성이 취소되었습니다.');
      onPhase('transcribe');
      await this.execute(this.binaries.whisper, [
        '-m', input.modelPath, '-f', wav, '-l', input.language,
        '-osrt', '-of', prefix, '-np',
      ], 'transcribe');
      if (this.cancelled) throw new Error('자동 자막 생성이 취소되었습니다.');
      const bytes = await stat(prefix + '.srt');
      if (!bytes.isFile() || bytes.size > 1024 * 1024) throw new Error('자동 자막 결과 파일이 올바르지 않습니다.');
      const srt = await readFile(prefix + '.srt', 'utf8');
      return parseWhisperSrt(srt, clipSeconds, input.preset);
    } finally {
      this.child = null;
      await rm(directory, { force: true, recursive: true }).catch(() => {});
    }
  }
}

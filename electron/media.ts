import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';

export interface MediaProbe {
  name: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

const acceptedExtensions = new Set(['.mp4', '.mov', '.mkv', '.webm', '.m4v']);
const ffprobeBin = () => process.env.SHORTFAB_FFPROBE_PATH || 'ffprobe';

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  if (!acceptedExtensions.has(extname(filePath).toLowerCase())) {
    throw new Error('MP4, MOV, MKV, WEBM, M4V 파일만 지원합니다.');
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size === 0) throw new Error('올바른 영상 파일이 아닙니다.');
  const raw = await new Promise<string>((resolve, reject) => {
    const child = spawn(ffprobeBin(), [
      '-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,width,height',
      '-of', 'json', filePath,
    ], { windowsHide: true });
    let output = '';
    let error = '';
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(output);
    };
    const timer = setTimeout(() => {
      child.kill();
      settle(new Error('미디어 분석 시간이 초과되었습니다.'));
    }, 20_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.on('data', (chunk: string) => { error = (error + chunk).slice(-4000); });
    child.on('error', () => settle(new Error('ffprobe를 찾을 수 없습니다. 설치 및 PATH를 확인하세요.')));
    child.on('close', (code) => {
      if (code !== 0) settle(new Error(error || '영상을 분석할 수 없습니다.'));
      else settle();
    });
  });
  let parsed: { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number }> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('미디어 분석 결과를 읽을 수 없습니다.');
  }
  const video = parsed.streams?.find((item) => item.codec_type === 'video');
  const duration = Number(parsed.format?.duration);
  if (!video?.width || !video.height || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('길이와 화면 크기를 확인할 수 없는 영상입니다.');
  }
  return {
    name: basename(filePath),
    duration,
    width: video.width,
    height: video.height,
    hasAudio: Boolean(parsed.streams?.some((item) => item.codec_type === 'audio')),
  };
}

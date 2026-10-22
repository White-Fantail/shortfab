import { describe, expect, it } from 'vitest';
import { captionFFmpegBinary, listsAssFilter, type AssCapability } from './ffmpeg-ass';

describe('FFmpeg ASS filter detection', () => {
  it('detects libass even with unrelated subtitle filters', () => {
    expect(listsAssFilter(' ... ass               V->V   Render ASS subtitles\n')).toBe(true);
    expect(listsAssFilter(' T.C ass               V->V   Render ASS subtitles\n')).toBe(true);
    expect(listsAssFilter(' ... subtitles         V->V\n')).toBe(false);
    expect(listsAssFilter(' ... asetnsamples       A->A\n')).toBe(false);
  });
  it('uses a compatible installed FFmpeg, including macOS ffmpeg-full fallback', async () => {
    const checked: string[] = [];
    const probe = async (bin: string): Promise<AssCapability> => {
      checked.push(bin);
      return bin === '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg'
        ? 'supported' : 'unsupported';
    };
    expect(await captionFFmpegBinary('ffmpeg', [
      '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg',
    ], probe)).toBe('/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg');
    expect(checked).toEqual(['ffmpeg', '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg']);
  });
  it('gives actionable guidance rather than an opaque filtergraph parser error', async () => {
    await expect(captionFFmpegBinary('ffmpeg', [], async () => 'unsupported'))
      .rejects.toThrow('brew install ffmpeg-full');
    await expect(captionFFmpegBinary('ffmpeg', [], async () => 'unavailable'))
      .rejects.toThrow('FFmpeg를 실행할 수 없습니다');
  });
});

describe('libass-free automatic caption fallback', () => {
  it('keeps the original FFmpeg when it can overlay but lacks libass', async () => {
    const { selectCaptionRenderer } = await import('./ffmpeg-ass');
    expect(await selectCaptionRenderer('ffmpeg', [], async () => 'unsupported')).toEqual({
      binary: 'ffmpeg', mode: 'overlay',
    });
  });
  it('selects ffmpeg-full with libass before the image fallback', async () => {
    const { selectCaptionRenderer } = await import('./ffmpeg-ass');
    const probe = async (bin: string): Promise<AssCapability> =>
      bin === '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg' ? 'supported' : 'unsupported';
    expect(await selectCaptionRenderer('ffmpeg',
      ['/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg'], probe)).toEqual({
      binary: '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg', mode: 'ass',
    });
  });
});

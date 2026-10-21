export type OutputWidth = 720 | 1080;

export interface MediaInfo {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  previewUrl: string;
}

export interface RenderRequest {
  sourceId: string;
  start: number;
  end: number;
  width: OutputWidth;
}

export interface RenderProgress {
  percent: number;
  seconds: number;
}

export type RenderResult =
  | { status: 'completed'; outputPath: string }
  | { status: 'cancelled' };

export function validateRenderRequest(value: unknown, duration: number): RenderRequest {
  if (!value || typeof value !== 'object') throw new Error('렌더 요청 형식이 올바르지 않습니다.');
  const request = value as Partial<RenderRequest>;
  const { start, end, sourceId, width } = request;
  if (typeof sourceId !== 'string' || !sourceId || sourceId.length > 128) {
    throw new Error('유효하지 않은 원본 식별자입니다.');
  }
  if (
    typeof start !== 'number' || !Number.isFinite(start) ||
    typeof end !== 'number' || !Number.isFinite(end) ||
    !Number.isFinite(duration) || duration <= 0 ||
    start < 0 || end <= start || end - start < 0.2 ||
    end > duration + 0.02
  ) {
    throw new Error('IN/OUT 구간을 다시 확인해 주세요.');
  }
  if (width !== 720 && width !== 1080) throw new Error('지원하지 않는 출력 해상도입니다.');
  return { sourceId, start, end, width };
}

export function cropFilter(width: OutputWidth): string {
  const height = Math.round(width * 16 / 9);
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=30`;
}

export function youtubeVideoId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase();
    let id: string | null = null;
    if (hostname === 'youtu.be') {
      id = url.pathname.split('/')[1] || null;
    } else if (hostname === 'youtube.com' || hostname === 'www.youtube.com' || hostname === 'm.youtube.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      id = parts[0] === 'watch' ? url.searchParams.get('v') :
        ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : null;
    }
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

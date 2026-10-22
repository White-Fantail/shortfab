export type OutputWidth = 720 | 1080;

// Shared marker/render threshold: 1.3 - 1.1 is slightly less than 0.2 in JS.
export const MIN_CLIP_SECONDS = 0.2;
export const CLIP_TIME_EPSILON = 1e-6;

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
  compositionClipIds?: string[]; // Wizard: exact persisted ordered clip IDs, not arbitrary media ranges.
}

export interface RenderProgress {
  phase?: 'download' | 'render';
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
    start < 0 || end <= start || end - start < MIN_CLIP_SECONDS - CLIP_TIME_EPSILON ||
    end > duration + 0.02
  ) {
    throw new Error('IN/OUT 구간을 다시 확인해 주세요.');
  }
  if (width !== 720 && width !== 1080) throw new Error('지원하지 않는 출력 해상도입니다.');
  const ids = request.compositionClipIds;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 ||
      ids.some((id) => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) ||
      new Set(ids).size !== ids.length)) {
    throw new Error('쇼츠 구성 클립 목록이 올바르지 않습니다.');
  }
  return { sourceId, start, end, width, ...(ids ? { compositionClipIds: ids } : {}) };
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

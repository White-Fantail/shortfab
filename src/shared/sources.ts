import { youtubeVideoId } from './contracts.js';

export type SourceState = 'preview_only' | 'source_link_required' | 'rights_review' |
  'ready_to_render' | 'source_lost' | 'blocked';

export interface YouTubeReference {
  videoId: string;
  url: string;
  durationSeconds: number | null;
}

export interface RightsGrant {
  rightsHolder: string;
  evidenceRef: string;
  allowClip: boolean;
  allowDerivativeEdit: boolean;
  allowRepost: boolean;
  allowedPlatforms: string[];
  expiresAt: string | null;
  declaredAt: string;
}

export type SourceProvider = 'creator_file' | 'partner_file';
export interface MediaBinding {
  referenceVideoId: string;
  sourceAssetId: string;
  provider: SourceProvider;
  fileName: string;
  durationSeconds: number;
  sizeBytes: number;
  sha256: string;
  startOffsetSeconds: number;
  rights: RightsGrant;
}

// Stored only in main-process project JSON / userData catalog. Never send this to the renderer.
export interface StoredMediaBinding extends MediaBinding {
  localPath: string;
}

export interface SourceResolution {
  state: SourceState;
  explanation: string;
  binding: MediaBinding | null;
  canRender: boolean;
  canPublishYouTube: boolean;
}

export interface BindSourceRequest {
  rightsHolder: string;
  evidenceRef: string;
  allowClip: boolean;
  allowDerivativeEdit: boolean;
  allowRepost: boolean;
  expiresAt: string | null;
  startOffsetSeconds: number;
  expectedSha256: string | null;
}

export interface SourceResolver {
  resolve(reference: YouTubeReference, binding: StoredMediaBinding | null, verified: boolean): SourceResolution;
}

export function validateBindSourceRequest(input: unknown): BindSourceRequest {
  if (!input || typeof input !== 'object') throw new Error('원본 이용 권한 정보를 입력해 주세요.');
  const v = input as Partial<BindSourceRequest>;
  if (typeof v.rightsHolder !== 'string' || !v.rightsHolder.trim() ||
      v.rightsHolder.length > 200 ||
      typeof v.evidenceRef !== 'string' || !v.evidenceRef.trim() || v.evidenceRef.length > 500 ||
      v.allowClip !== true || v.allowDerivativeEdit !== true ||
      typeof v.allowRepost !== 'boolean' ||
      typeof v.startOffsetSeconds !== 'number' || !Number.isFinite(v.startOffsetSeconds) ||
      v.startOffsetSeconds < 0 || v.startOffsetSeconds > 86400 ||
      (v.expiresAt !== null && v.expiresAt !== undefined &&
        (typeof v.expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.expiresAt) ||
          !Number.isFinite(Date.parse(v.expiresAt + 'T23:59:59Z')))) ||
      (v.expectedSha256 !== null && v.expectedSha256 !== undefined &&
        (typeof v.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(v.expectedSha256)))) {
    throw new Error('권리자, 증빙, 편집 허용 여부, 시간 오프셋과 체크섬을 확인해 주세요.');
  }
  return {
    rightsHolder: v.rightsHolder.trim(), evidenceRef: v.evidenceRef.trim(),
    allowClip: true, allowDerivativeEdit: true, allowRepost: v.allowRepost,
    expiresAt: v.expiresAt ?? null, startOffsetSeconds: v.startOffsetSeconds,
    expectedSha256: v.expectedSha256?.toLowerCase() ?? null,
  };
}

export function hasActiveRights(rights: RightsGrant, now = new Date()): boolean {
  if (!rights || rights.allowClip !== true || rights.allowDerivativeEdit !== true ||
      !rights.evidenceRef?.trim() || !rights.rightsHolder?.trim() ||
      !Array.isArray(rights.allowedPlatforms) || rights.allowedPlatforms.some(p => typeof p !== 'string')) return false;
  if (rights.expiresAt) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rights.expiresAt)) return false;
    const expires = Date.parse(rights.expiresAt + 'T23:59:59Z');
    if (!Number.isFinite(expires) || now.getTime() > expires) return false;
  }
  return true;
}

export function mappedClipRange(
  start: number, end: number, binding: MediaBinding,
): { start: number; end: number } {
  const mappedStart = start + binding.startOffsetSeconds;
  const mappedEnd = end + binding.startOffsetSeconds;
  if (![start, end, mappedStart, mappedEnd].every(Number.isFinite) ||
      start < 0 || end - start < 0.2 ||
      mappedStart < 0 || mappedEnd > binding.durationSeconds + 0.02) {
    throw new Error('YouTube 구간이 연결된 원본 영상 범위를 벗어납니다.');
  }
  return { start: mappedStart, end: mappedEnd };
}

export function resolveYouTubeSource(
  reference: YouTubeReference, stored: StoredMediaBinding | null, verified: boolean,
  now = new Date(),
): SourceResolution {
  const videoId = youtubeVideoId(reference.url);
  const none = (state: SourceState, explanation: string): SourceResolution =>
    ({ state, explanation, binding: null, canRender: false, canPublishYouTube: false });
  if (!videoId || videoId !== reference.videoId) return none('blocked', 'YouTube 링크가 올바르지 않습니다.');
  if (!stored) return none(reference.durationSeconds ? 'source_link_required' : 'preview_only',
    '공식 YouTube 미리보기만 가능합니다. 권리자 제공 원본을 연결해 주세요.');
  if (stored.referenceVideoId !== videoId) return none('blocked', '원본이 다른 YouTube 영상과 연결되어 있습니다.');
  if (!hasActiveRights(stored.rights, now)) return none('rights_review', '허가 내용이 없거나 편집 권한이 만료되었습니다.');
  if (!verified) return none('source_lost', '연결 파일이 삭제되었거나 SHA-256/영상 정보가 일치하지 않습니다.');
  const { localPath: _localPath, ...binding } = stored;
  void _localPath;
  return {
    state: 'ready_to_render',
    explanation: '사용자가 사용 권한을 선언한 파일의 해시/길이를 확인했습니다. 영상 내용과 법적 권리 자체는 별도 확인이 필요합니다.',
    binding, canRender: true,
    canPublishYouTube: stored.rights.allowRepost && stored.rights.allowedPlatforms.includes('youtube'),
  };
}

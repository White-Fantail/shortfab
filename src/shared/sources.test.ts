import { describe, expect, it } from 'vitest';
import { hasActiveRights, mappedClipRange, resolveYouTubeSource, validateBindSourceRequest, type StoredMediaBinding } from './sources';

const good: StoredMediaBinding = {
  referenceVideoId: 'abcdefghijk', sourceAssetId: 'afef3648-d6d4-4716-99ad-d4f8ad761254',
  provider: 'creator_file', fileName: 'raw.mp4', durationSeconds: 130,
  sizeBytes: 1000, sha256: 'a'.repeat(64), startOffsetSeconds: 10,
  localPath: '/private/video/raw.mp4',
  rights: {
    rightsHolder: 'Creator', evidenceRef: 'contract-001', allowClip: true, allowDerivativeEdit: true,
    allowRepost: false, allowedPlatforms: [], declaredAt: '2026-10-22T00:00:00Z', expiresAt: null,
  },
};
const reference = { videoId: 'abcdefghijk', url: 'https://youtu.be/abcdefghijk', durationSeconds: 120 };

describe('YF-1 source and rights contracts', () => {
  it('keeps missing input preview-only or source-link-required', () => {
    expect(resolveYouTubeSource({ ...reference, durationSeconds: null }, null, false).state).toBe('preview_only');
    expect(resolveYouTubeSource(reference, null, false).canRender).toBe(false);
  });
  it('hides file paths while a pinned file is verified', () => {
    const resolved = resolveYouTubeSource(reference, good, true);
    expect(resolved.state).toBe('ready_to_render');
    expect(resolved.canPublishYouTube).toBe(false);
    expect('localPath' in (resolved.binding ?? {})).toBe(false);
  });
  it('refuses wrong IDs, changed files and expired grants', () => {
    expect(resolveYouTubeSource({ ...reference, videoId: 'zzzzzzzzzzz' }, good, true).state).toBe('blocked');
    expect(resolveYouTubeSource(reference, good, false).state).toBe('source_lost');
    expect(resolveYouTubeSource(reference, { ...good, rights: { ...good.rights, expiresAt: '2020-01-01' } }, true).state).toBe('rights_review');
  });
  it('separates editing permission from repost permission', () => {
    const allowed = { ...good, rights: { ...good.rights, allowRepost: true, allowedPlatforms: ['youtube'] } };
    expect(resolveYouTubeSource(reference, allowed, true).canPublishYouTube).toBe(true);
    expect(resolveYouTubeSource(reference, { ...allowed, rights: { ...allowed.rights, allowedPlatforms: [] } }, true).canPublishYouTube).toBe(false);
  });
  it('maps time offset and enforces video limits', () => {
    expect(mappedClipRange(2, 30, good)).toEqual({ start: 12, end: 40 });
    expect(() => mappedClipRange(115, 125, good)).toThrow();
    expect(() => mappedClipRange(-1, 2, good)).toThrow();
  });
  it('rejects absent rights, unsafe metadata, and expired dates', () => {
    const candidate = { rightsHolder: 'Creator', evidenceRef: 'agreement #1', allowClip: true,
      allowDerivativeEdit: true, allowRepost: false, startOffsetSeconds: 0,
      expiresAt: null, expectedSha256: null };
    expect(validateBindSourceRequest(candidate).rightsHolder).toBe('Creator');
    for (const bad of [
      { ...candidate, allowClip: false }, { ...candidate, allowDerivativeEdit: false },
      { ...candidate, evidenceRef: ' ' }, { ...candidate, startOffsetSeconds: -1 },
      { ...candidate, expectedSha256: 'wrong' }, { ...candidate, expiresAt: 'soon' },
    ]) expect(() => validateBindSourceRequest(bad)).toThrow();
    expect(hasActiveRights({ ...good.rights, allowClip: false })).toBe(false);
  });
});

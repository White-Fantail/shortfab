import { describe, expect, it } from 'vitest';
import { interpretYouTubeState, nextUploadOffset, validatePublishDraft } from './publishing';

describe('YouTube publishing input and state', () => {
  const valid = { title: '  여행 클립  ', description: 'ShortFab에서 제작', privacyStatus: 'private', madeForKids: false };
  it('accepts a deliberate visibility and made-for-kids choice', () => {
    expect(validatePublishDraft(valid)).toEqual({ ...valid, title: '여행 클립' });
  });
  it('rejects missing audiences, invalid visibility and oversized metadata', () => {
    for (const invalid of [{ ...valid, madeForKids: undefined }, { ...valid, privacyStatus: 'auto' },
      { ...valid, title: ' ' }, { ...valid, description: 'a'.repeat(5001) }]) {
      expect(() => validatePublishDraft(invalid)).toThrow();
    }
  });
  it('resumes at the acknowledged byte and rejects invalid ranges', () => {
    expect(nextUploadOffset(308, null, 1000)).toBe(0);
    expect(nextUploadOffset(308, 'bytes=0-511', 1000)).toBe(512);
    expect(() => nextUploadOffset(308, 'bytes=1-511', 1000)).toThrow();
    expect(() => nextUploadOffset(308, 'bytes=0-1000', 1000)).toThrow();
    expect(() => nextUploadOffset(200, null, 1000)).toThrow();
  });
  it('keeps processing distinct from published and detects failure', () => {
    expect(interpretYouTubeState({ processingDetails: { processingStatus: 'processing' } })).toBe('processing');
    expect(interpretYouTubeState({ status: { uploadStatus: 'processed' }, processingDetails: { processingStatus: 'succeeded' } })).toBe('published');
    expect(interpretYouTubeState({ status: { uploadStatus: 'rejected' } })).toBe('action_required');
    expect(interpretYouTubeState({})).toBe('processing');
  });
});

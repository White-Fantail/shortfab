import { describe, expect, it } from 'vitest';
import { projectEditValidationError, validateProjectEdits } from './projects';

const projectId = 'ad313e51-6d15-4b1f-bd85-7ef3b5dd50d0';
const clipId = '9f60d241-05d2-42db-b332-973597172942';
const valid = {
  id: projectId, revision: 0, title: '  여행 하이라이트  ',
  youtubeUrl: 'https://youtu.be/abcdefghijk', youtubeDuration: null,
  clips: [{ id: clipId, title: '인트로', start: 2, end: 32, width: 720 }],
  selectedClipId: clipId,
};

describe('versioned project edit schema', () => {
  it('roundtrips valid clips without filesystem paths', () => {
    const result = validateProjectEdits(valid, 120);
    expect(result.title).toBe('여행 하이라이트');
    expect(result.clips[0].end).toBe(32);
    expect(result.clips[0].source).toBe('local'); // Legacy clips migrated.
    expect(result.shortClipIds).toEqual([clipId]); // Preserve legacy single-clip exports.
    expect('localPath' in result).toBe(false);
  });

  it('allows an empty project with no local source', () => {
    expect(validateProjectEdits({
      ...valid, youtubeUrl: '', clips: [], selectedClipId: null,
    }, null).clips).toEqual([]);
  });

  it('rejects stale/invalid clip lists and dangerous source URLs', () => {
    const badCases = [
      { ...valid, clips: [{ ...valid.clips[0], end: 123 }] },
      { ...valid, clips: [valid.clips[0], valid.clips[0]] },
      { ...valid, selectedClipId: projectId },
      { ...valid, clips: [{ ...valid.clips[0], start: 40, end: 2 }] },
      { ...valid, clips: [{ ...valid.clips[0], width: 999 }] },
      { ...valid, youtubeUrl: 'https://youtube.com.evil.test/watch?v=abcdefghijk' },
      { ...valid, revision: -1 },
    ];
    for (const item of badCases) {
      expect(() => validateProjectEdits(item, 120)).toThrow();
    }
    expect(() => validateProjectEdits(valid, null)).toThrow('원본');
  });

  it('accepts a 26:38 YouTube source with a 00:29–07:35 selection (regression)', () => {
    const value = validateProjectEdits({
      ...valid, youtubeUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
      youtubeDuration: 1598, clips: [{
        ...valid.clips[0], source: 'youtube', title: '클립 1',
        start: 29, end: 455, width: 720,
      }],
    }, null);
    expect(value.clips).toHaveLength(1);
    expect(value.clips[0].end - value.clips[0].start).toBe(426);
  });

  it('saves YouTube-only preview ranges without a local source', () => {
    const youtube = validateProjectEdits({
      ...valid, youtubeDuration: 185, clips: [
        { ...valid.clips[0], source: 'youtube', start: 10, end: 40 },
      ],
    }, null);
    expect(youtube.clips[0].source).toBe('youtube');
    expect(youtube.clips[0].start).toBe(10);
    expect(youtube.youtubeDuration).toBe(185);
  });

  it('roundtrips clip captions and remains compatible with legacy caption-free JSON', () => {
    const subtitle = { preset: 'classic', cues: [{
      id: 'subtitle-1', start: 0, end: 2, text: '안녕하세요',
    }] };
    const saved = validateProjectEdits({
      ...valid, clips: [{ ...valid.clips[0], subtitles: subtitle }],
    }, 120);
    expect(saved.clips[0].subtitles).toEqual(subtitle);
    expect(validateProjectEdits(valid, 120).clips[0].subtitles).toBeNull();
    expect(() => validateProjectEdits({
      ...valid, clips: [{ ...valid.clips[0], subtitles: {
        ...subtitle, cues: [{ ...subtitle.cues[0], end: 35 }],
      } }],
    }, 120)).toThrow('자막');
  });

  it('accepts exactly 0.2-second decimal clip ranges', () => {
    const result = validateProjectEdits({
      ...valid, clips: [{ ...valid.clips[0], start: 1.1, end: 1.3 }],
    }, 120);
    expect(result.clips[0].end - result.clips[0].start).toBeCloseTo(0.2);
    expect(projectEditValidationError(result, 120)).toBeNull();
  });

  it('returns specific draft feedback for temporary invalid marker, name, or duration', () => {
    expect(projectEditValidationError({
      ...valid, clips: [{ ...valid.clips[0], start: 40, end: 32 }],
    }, 120)).toContain('IN/OUT');
    expect(projectEditValidationError({
      ...valid, clips: [{ ...valid.clips[0], title: '' }],
    }, 120)).toContain('이름');
    expect(projectEditValidationError({
      ...valid, clips: [{ ...valid.clips[0], end: 121 }],
    }, 120)).toContain('영상 길이');
    expect(projectEditValidationError(valid, 120)).toBeNull();
  });

  it('rejects YouTube clips without metadata or beyond duration, local clips without file', () => {
    const clip = { ...valid.clips[0], source: 'youtube' };
    expect(() => validateProjectEdits({ ...valid, clips: [clip] }, null)).toThrow();
    expect(() => validateProjectEdits({ ...valid, youtubeDuration: 20, clips: [clip] }, null)).toThrow();
    expect(() => validateProjectEdits({ ...valid, youtubeUrl: '', youtubeDuration: 120, clips: [clip] }, null)).toThrow();
    expect(() => validateProjectEdits(valid, null)).toThrow();
  });
  it('stores an ordered short made from independent parts of the same YouTube source', () => {
    const second = { ...valid.clips[0], id: '32971c6b-e5d3-4747-b21a-7474b0fa1310',
      source: 'youtube' as const, title: 'Outro', start: 60, end: 78 };
    const first = { ...valid.clips[0], source: 'youtube' as const, start: 8, end: 22 };
    const input = { ...valid, youtubeDuration: 180, clips: [first, second],
      selectedClipId: clipId, shortClipIds: [second.id, first.id] };
    expect(validateProjectEdits(input, null).shortClipIds).toEqual([second.id, clipId]);
    expect(() => validateProjectEdits({ ...input, shortClipIds: [second.id, second.id] }, null)).toThrow('순서');
    expect(() => validateProjectEdits({ ...input, shortClipIds: [projectId] }, null)).toThrow('순서');
    expect(() => validateProjectEdits({ ...input, clips: [{ ...first, source: 'local' }, second] }, 180))
      .toThrow('동일한 원본');
  });
});

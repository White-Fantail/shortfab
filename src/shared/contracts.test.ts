import { describe, expect, it } from 'vitest';
import { cropFilter, validateRenderRequest, youtubeVideoId } from './contracts';

describe('render contract', () => {
  it('accepts a legal 30-second clip', () => {
    expect(validateRenderRequest({ sourceId: 'asset-1', start: 3, end: 33, width: 720 }, 60))
      .toMatchObject({ start: 3, end: 33 });
  });
  it.each([
    { sourceId: 'a', start: -1, end: 20, width: 720 },
    { sourceId: 'a', start: 25, end: 20, width: 720 },
    { sourceId: 'a', start: 3, end: 90, width: 720 },
    { sourceId: 'a', start: 0, end: 2, width: 999 },
    { sourceId: 'a', start: Number.NaN, end: 20, width: 720 },
    { sourceId: 'a', start: 1, end: 1.1, width: 720 },
  ])('rejects an invalid request %j', (request) => {
    expect(() => validateRenderRequest(request, 60)).toThrow();
  });
  it('renders decimal markers that are exactly 0.2 seconds apart', () => {
    expect(validateRenderRequest({ sourceId: 'asset-1', start: 1.1, end: 1.3, width: 720 }, 60))
      .toMatchObject({ start: 1.1, end: 1.3 });
  });
  it('produces an exact 9:16 crop for both sizes', () => {
    expect(cropFilter(720)).toContain('crop=720:1280');
    expect(cropFilter(1080)).toContain('crop=1080:1920');
  });
});

describe('YouTube official embed URL parser', () => {
  it('supports watch, short, and youtu.be links', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://youtu.be/abcdefghijk?t=10')).toBe('abcdefghijk');
  });
  it('blocks lookalike hosts and unsafe URL schemes', () => {
    expect(youtubeVideoId('https://youtube.com.evil.test/watch?v=abcdefghijk')).toBeNull();
    expect(youtubeVideoId('http://youtube.com/watch?v=abcdefghijk')).toBeNull();
    expect(youtubeVideoId('https://youtube.com/watch?v=invalid')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { allowedSourceHosts, approvedDownloadUrl, isPublicIPv4, validateApprovedCloudSource } from './cloud.js';

const allowed = ['assets.creator.example'];
const rights = {
  rightsHolder: 'Creator', evidenceRef: 'signed license 1', allowClip: true, allowDerivativeEdit: true,
  allowRepost: false, startOffsetSeconds: 0, expiresAt: null, expectedSha256: 'a'.repeat(64),
};

describe('approved cloud source boundaries', () => {
  it('permits only explicitly configured HTTPS hosts and direct media paths', () => {
    expect(approvedDownloadUrl('https://assets.creator.example/signed/source.mp4?token=abc', allowed).hostname)
      .toBe('assets.creator.example');
    for (const bad of [
      'http://assets.creator.example/file.mp4', 'https://assets.creator.example:444/file.mp4',
      'https://assets.creator.example.evil.com/file.mp4', 'https://127.0.0.1/file.mp4',
      'https://assets.creator.example/file.exe', 'https://user:pass@assets.creator.example/file.mp4',
      'https://assets.creator.example/file.mp4#fragment', 'file:///etc/passwd',
      'https://www.youtube.com/watch?v=abcdefghijk',
    ]) expect(() => approvedDownloadUrl(bad, allowed)).toThrow();
  });
  it('requires the provider expected hash and license declaration', () => {
    expect(validateApprovedCloudSource({
      directUrl: 'https://assets.creator.example/file.mp4?signature=secret', rights,
    }, allowed).rights.expectedSha256).toHaveLength(64);
    expect(() => validateApprovedCloudSource({
      directUrl: 'https://assets.creator.example/file.mp4', rights: { ...rights, expectedSha256: null },
    }, allowed)).toThrow();
  });
  it('ignores unconfigured, internal and YouTube domains', () => {
    expect(allowedSourceHosts('assets.creator.example,assets.creator.example, localhost, youtube.com, private.local'))
      .toEqual(['assets.creator.example', 'assets.creator.example']);
    expect(allowedSourceHosts('')).toEqual([]);
  });
  it('rejects non-public targets (DNS rebinding / SSRF)', () => {
    for (const ip of [
      '127.0.0.1', '10.4.2.3', '172.20.1.2', '192.168.1.2', '169.254.169.254',
      '100.64.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.9',
      '224.0.0.1', '::1', '::ffff:127.0.0.1',
    ]) expect(isPublicIPv4(ip)).toBe(false);
    expect(isPublicIPv4('8.8.8.8')).toBe(true);
    expect(isPublicIPv4('1.1.1.1')).toBe(true);
  });
});

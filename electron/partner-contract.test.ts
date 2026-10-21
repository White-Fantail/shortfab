import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { partnerCatalogEndpoint, verifyPartnerOffer, type PartnerOffer } from './partner-contract.js';

const keys = generateKeyPairSync('ed25519');
const publicDer = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const videoId = 'abcdefghijk';
const hosts = ['catalog.partner.example', 'media.partner.example'];
const fixedNow = new Date('2026-10-22T00:00:00.000Z');
const offer: PartnerOffer = {
  schemaVersion: 1, videoId, downloadUrl: 'https://media.partner.example/clip.mp4?token=partner-private',
  sha256: 'f'.repeat(64), rightsHolder: 'Licensed partner',
  evidenceRef: 'agreement video 381', allowClip: true, allowDerivativeEdit: true,
  allowRepost: true, expiresAt: '2026-12-31', startOffsetSeconds: 1,
  issuedAt: '2026-10-21T23:59:00.000Z', validUntil: '2026-10-22T00:20:00.000Z',
};
function signed(data: PartnerOffer = offer) {
  const payload = Buffer.from(JSON.stringify(data));
  return { signedPayload: payload.toString('base64url'),
    signature: sign(null, payload, keys.privateKey).toString('base64url') };
}
describe('signed partner source catalog', () => {
  it('verifies the signer and exact video ID with permission, hash and URL', () => {
    const checked = verifyPartnerOffer(signed(), videoId, publicDer, hosts, fixedNow);
    expect(checked.offer.videoId).toBe(videoId);
    expect(checked.rights.expectedSha256).toBe('f'.repeat(64));
    expect(checked.rights.allowRepost).toBe(true);
  });
  it('rejects tampering, untrusted keys, ID swapping and invalid rights', () => {
    const changed = signed();
    changed.signedPayload = Buffer.from(JSON.stringify({ ...offer, allowRepost: false })).toString('base64url');
    expect(() => verifyPartnerOffer(changed, videoId, publicDer, hosts, fixedNow)).toThrow();
    const stranger = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    expect(() => verifyPartnerOffer(signed(), videoId, stranger, hosts, fixedNow)).toThrow();
    expect(() => verifyPartnerOffer(signed(), 'zyxwvutsrqp', publicDer, hosts, fixedNow)).toThrow();
    expect(() => verifyPartnerOffer(signed({ ...offer, allowClip: false } as unknown as PartnerOffer), videoId, publicDer, hosts, fixedNow)).toThrow();
  });
  it('rejects forged media host and bad signed metadata', () => {
    for (const data of [
      { ...offer, downloadUrl: 'https://media.partner.example.evil.com/a.mp4' },
      { ...offer, downloadUrl: 'https://127.0.0.1/a.mp4' },
      { ...offer, sha256: 'fake' },
      { ...offer, validUntil: '2026-10-21T23:00:00.000Z' },
      { ...offer, issuedAt: '2026-10-23T00:00:00.000Z' },
      { ...offer, startOffsetSeconds: -8 },
      { ...offer, expiresAt: '2025-10-22' },
    ]) expect(() => verifyPartnerOffer(signed(data as PartnerOffer), videoId, publicDer, hosts, fixedNow)).toThrow();
  });
  it('rejects invalid catalog configuration', () => {
    expect(partnerCatalogEndpoint('https://catalog.partner.example/v1/sources', hosts)?.pathname).toBe('/v1/sources');
    for (const url of [
      'https://unknown.example/lookup', 'http://catalog.partner.example/lookup',
      'https://catalog.partner.example:8443/lookup',
      'https://catalog.partner.example/?secret=x', 'https://catalog.partner.example/',
      'https://user:pass@catalog.partner.example/lookup',
    ]) expect(partnerCatalogEndpoint(url, hosts)).toBeNull();
  });
});

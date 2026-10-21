import { createPublicKey, verify } from 'node:crypto';
import { approvedDownloadUrl } from '../src/shared/cloud.js';
import { validateBindSourceRequest, type BindSourceRequest } from '../src/shared/sources.js';

const videoPattern = /^[a-zA-Z0-9_-]{11}$/;
const base64url = /^[A-Za-z0-9_-]+$/;
const MAX_OFFER_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface PartnerOffer {
  schemaVersion: 1;
  videoId: string;
  downloadUrl: string;
  sha256: string;
  rightsHolder: string;
  evidenceRef: string;
  allowClip: true;
  allowDerivativeEdit: true;
  allowRepost: boolean;
  expiresAt: string | null;
  startOffsetSeconds: number;
  issuedAt: string;
  validUntil: string;
}

export interface SignedPartnerOffer {
  signedPayload: string; // base64url of UTF-8 JSON, authenticated byte-for-byte.
  signature: string; // base64url Ed25519 signature over the decoded payload bytes.
}

/** Verify before parsing untrusted JSON into trusted rights/source data.
 * Signing key lives with the partner; only the pinned public key is configured in ShortFab.
 */
export function verifyPartnerOffer(
  envelope: unknown, expectedVideoId: string, spkiBase64: string,
  sourceHosts: readonly string[], now = new Date(),
): { offer: PartnerOffer; rights: BindSourceRequest } {
  if (!videoPattern.test(expectedVideoId) || !envelope || typeof envelope !== 'object') {
    throw new Error('파트너 원본 응답이 올바르지 않습니다.');
  }
  const value = envelope as Partial<SignedPartnerOffer>;
  if (typeof value.signedPayload !== 'string' || value.signedPayload.length > 14000 ||
      !base64url.test(value.signedPayload) ||
      typeof value.signature !== 'string' || value.signature.length > 200 ||
      !base64url.test(value.signature)) {
    throw new Error('파트너 카탈로그 서명 형식이 올바르지 않습니다.');
  }
  const payloadBytes = Buffer.from(value.signedPayload, 'base64url');
  const signatureBytes = Buffer.from(value.signature, 'base64url');
  if (payloadBytes.length > 10000 || signatureBytes.length !== 64 ||
      !/^[a-zA-Z0-9+/]+={0,2}$/.test(spkiBase64)) {
    throw new Error('파트너 서명 키 또는 크기가 올바르지 않습니다.');
  }
  try {
    const key = createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519' || !verify(null, payloadBytes, key, signatureBytes)) {
      throw new Error('signature mismatch');
    }
  } catch {
    throw new Error('신뢰할 수 있는 파트너의 디지털 서명과 일치하지 않습니다.');
  }
  let raw: unknown;
  try { raw = JSON.parse(payloadBytes.toString('utf8')); }
  catch { throw new Error('서명된 원본 메타데이터가 올바르지 않습니다.'); }
  if (!raw || typeof raw !== 'object') throw new Error('서명된 원본 정보가 올바르지 않습니다.');
  const input = raw as Partial<PartnerOffer>;
  if (input.schemaVersion !== 1 || input.videoId !== expectedVideoId ||
      typeof input.downloadUrl !== 'string' || input.downloadUrl.length > 4096 ||
      typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(input.sha256) ||
      input.allowClip !== true || input.allowDerivativeEdit !== true ||
      typeof input.issuedAt !== 'string' || typeof input.validUntil !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.issuedAt) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(input.validUntil)) {
    throw new Error('서명된 영상 ID·권한·체크섬 형식이 올바르지 않습니다.');
  }
  const issued = Date.parse(input.issuedAt), until = Date.parse(input.validUntil);
  if (!Number.isFinite(issued) || !Number.isFinite(until) ||
      issued > now.getTime() + MAX_CLOCK_SKEW_MS || until < now.getTime() ||
      until <= issued || until - issued > MAX_OFFER_AGE_MS) {
    throw new Error('파트너 원본 안내가 만료되거나 유효기간이 올바르지 않습니다.');
  }
  const rights = validateBindSourceRequest({
    rightsHolder: input.rightsHolder, evidenceRef: input.evidenceRef,
    allowClip: true, allowDerivativeEdit: true, allowRepost: input.allowRepost,
    expiresAt: input.expiresAt, startOffsetSeconds: input.startOffsetSeconds,
    expectedSha256: input.sha256,
  });
  if (rights.expiresAt && Date.parse(rights.expiresAt + 'T23:59:59Z') < now.getTime()) {
    throw new Error('파트너가 허가한 영상 이용 기한이 만료되었습니다.');
  }
  approvedDownloadUrl(input.downloadUrl, sourceHosts);
  return { offer: input as PartnerOffer, rights };
}

export function partnerCatalogEndpoint(raw: string | undefined, hosts: readonly string[]): URL | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
        url.hash || url.search || !hosts.includes(url.hostname.toLowerCase()) ||
        url.pathname === '/' || url.pathname.length > 250) return null;
    return url;
  } catch { return null; }
}

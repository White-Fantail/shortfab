import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { allowedSourceHosts, isPublicIPv4 } from '../src/shared/cloud.js';
import { partnerCatalogEndpoint, verifyPartnerOffer } from './partner-contract.js';

const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_WAIT_MS = 15_000;

function partnerSettings(): { endpoint: URL; publicKey: string; hosts: string[] } | null {
  const hosts = allowedSourceHosts(process.env.SHORTFAB_APPROVED_SOURCE_HOSTS);
  const endpoint = partnerCatalogEndpoint(process.env.SHORTFAB_PARTNER_CATALOG_ENDPOINT, hosts);
  const publicKey = process.env.SHORTFAB_PARTNER_PUBLIC_KEY_B64?.trim();
  if (!endpoint || !publicKey || publicKey.length > 4096 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)) return null;
  return { endpoint, publicKey, hosts };
}

export function partnerCatalogConfigured(): boolean {
  return partnerSettings() !== null;
}

async function fetchSignedOffer(endpoint: URL): Promise<unknown | null> {
  const resolved = await lookup(endpoint.hostname, { all: true, family: 4 });
  if (!resolved.length || resolved.some(item => !isPublicIPv4(item.address))) {
    throw new Error('파트너 카탈로그가 허용된 공인 인터넷 주소에 있지 않습니다.');
  }
  const selected = resolved[0].address;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAX_WAIT_MS);
  try {
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = request(endpoint, {
        method: 'GET', signal: controller.signal,
        lookup: (_host, _options, callback) => callback(null, selected, 4),
        headers: { accept: 'application/json', 'accept-encoding': 'identity' },
      }, resolve);
      req.once('error', reject);
      req.end();
    });
    if (response.statusCode === 404) { response.destroy(); return null; }
    if (response.statusCode !== 200) {
      response.destroy();
      throw new Error('파트너 카탈로그가 원본 조회를 거절했습니다 (HTTP ' + response.statusCode + ').');
    }
    const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json' ||
        (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) {
      response.destroy();
      throw new Error('파트너 응답 형식이 올바르지 않습니다.');
    }
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of response) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      size += bytes.length;
      if (size > MAX_RESPONSE_BYTES) {
        response.destroy();
        throw new Error('파트너 카탈로그 응답이 허용된 크기를 초과했습니다.');
      }
      chunks.push(bytes);
    }
    if (!size) throw new Error('파트너 카탈로그의 원본 정보가 비어 있습니다.');
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
    catch { throw new Error('파트너 원본 응답 JSON이 올바르지 않습니다.'); }
  } catch (cause) {
    if (controller.signal.aborted) throw new Error('파트너 카탈로그 응답 시간이 초과되었습니다.');
    const message = cause instanceof Error ? cause.message : '';
    if (message.startsWith('파트너')) throw cause;
    // Hide network errors that might include signed URL or request details.
    throw new Error('파트너 카탈로그에 안전하게 연결할 수 없습니다.');
  } finally { clearTimeout(timeout); }
}

export async function findApprovedPartnerMedia(videoId: string) {
  const settings = partnerSettings();
  if (!settings) throw new Error('파트너 카탈로그 주소와 공개키가 구성되지 않았습니다.');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw new Error('YouTube 영상 ID가 잘못되었습니다.');
  const endpoint = new URL(settings.endpoint.toString());
  endpoint.searchParams.set('videoId', videoId);
  const signed = await fetchSignedOffer(endpoint);
  if (signed === null) return null;
  return verifyPartnerOffer(signed, videoId, settings.publicKey, settings.hosts);
}

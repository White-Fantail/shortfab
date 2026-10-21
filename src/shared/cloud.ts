import { isIP } from 'node:net';
import type { BindSourceRequest } from './sources.js';

export interface ApprovedCloudSourceRequest {
  directUrl: string;
  rights: BindSourceRequest;
}

export function allowedSourceHosts(config: string | undefined): string[] {
  return (config ?? '').split(',').map(s => s.trim().toLowerCase()).filter(host =>
    /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(host) &&
    !host.endsWith('.local') && !host.endsWith('.internal') &&
    !['youtube.com', 'www.youtube.com', 'youtu.be', 'googlevideo.com'].includes(host) &&
    !host.endsWith('.googlevideo.com') && !isIP(host));
}

export function approvedDownloadUrl(raw: string, hosts: readonly string[]): URL {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new Error('직접 다운로드할 HTTPS 파일 주소를 입력해 주세요.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !hosts.includes(url.hostname.toLowerCase()) || isIP(url.hostname) ||
      !/\.(mp4|mov|mkv|webm|m4v)$/i.test(url.pathname) || url.hash) {
    throw new Error('허용된 HTTPS 미디어 파일 호스트/확장자만 연결할 수 있습니다.');
  }
  return url;
}

export function validateApprovedCloudSource(input: unknown, hosts: readonly string[]): ApprovedCloudSourceRequest {
  if (!input || typeof input !== 'object') throw new Error('원격 원본 요청이 잘못되었습니다.');
  const request = input as Partial<ApprovedCloudSourceRequest>;
  if (!request.rights || typeof request.directUrl !== 'string' ||
      request.directUrl.length > 4096 || !request.rights.expectedSha256 ||
      !/^[a-f0-9]{64}$/i.test(request.rights.expectedSha256)) {
    throw new Error('원격 원본에는 권리 정보와 권리자 제공 SHA-256 체크섬이 필수입니다.');
  }
  // The privileged main process validates the rights form and exact host separately.
  approvedDownloadUrl(request.directUrl, hosts);
  return { directUrl: request.directUrl, rights: request.rights };
}

/** Fail closed on private, reserved, documentation, broadcast or non-IPv4 addresses.
 * The downloader pins DNS resolution to this address for TLS connection creation.
 */
export function isPublicIPv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const parts = value.split('.').map(Number);
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 0 && c === 0)) return false;
  return true;
}

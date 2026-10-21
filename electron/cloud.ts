import { createHash, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { request } from 'node:https';
import { extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { app } from 'electron';
import { allowedSourceHosts, approvedDownloadUrl, isPublicIPv4 } from '../src/shared/cloud.js';

const MAX_BYTES = 2 * 1024 ** 3;
const assetsDir = () => join(app.getPath('userData'), 'sources', 'assets');

export function configuredSourceHosts(): string[] {
  return allowedSourceHosts(process.env.SHORTFAB_APPROVED_SOURCE_HOSTS);
}

/**
 * Fetch a separately authorized, checksum-pinned creator file. This is not a
 * YouTube downloader. Host allowlist, pinned public IPv4 DNS, TLS validation,
 * exact URL, no redirects, deadline and byte cap are enforced in main.
 *
 * The credential-bearing URL is NEVER persisted/logged.
 */
export async function importApprovedFile(rawUrl: string, expectedHash: string): Promise<string> {
  const url = approvedDownloadUrl(rawUrl, configuredSourceHosts());
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) {
    throw new Error('권리자 제공 SHA-256 체크섬을 입력해야 합니다.');
  }
  const records = await lookup(url.hostname, { family: 4, all: true });
  if (!records.length || records.some(({ address }) => !isPublicIPv4(address))) {
    throw new Error('승인된 원본 호스트가 공개 네트워크 주소로 확인되지 않았습니다.');
  }
  const selected = records[0].address;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const id = randomUUID();
  const ext = extname(url.pathname).toLowerCase();
  const folder = assetsDir();
  const partial = join(folder, '.' + id + ext + '.partial');
  const output = join(folder, id + ext);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  let committed = false;

  try {
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const req = request(url, {
        method: 'GET',
        signal: controller.signal,
        lookup: (_host, _options, callback) => callback(null, selected, 4),
        headers: { accept: 'video/*,application/octet-stream', 'accept-encoding': 'identity' },
      }, resolve);
      req.once('error', reject);
      req.end();
    });

    // Deliberately no redirects, including temporary signed-URL redirects.
    if (response.statusCode !== 200) {
      response.destroy();
      throw new Error('허가 원본 다운로드가 거절되었습니다 (HTTP ' + response.statusCode + '). 직접 미디어 URL을 확인하세요.');
    }
    const type = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type && !type.startsWith('video/') && !['application/octet-stream', 'application/mp4'].includes(type)) {
      response.destroy();
      throw new Error('원본 서버가 미디어 파일 형식이 아닌 응답을 반환했습니다.');
    }
    if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
      response.destroy();
      throw new Error('압축 인코딩된 원본 다운로드 응답은 지원하지 않습니다.');
    }
    const declaredLength = Number(response.headers['content-length']);
    if (response.headers['content-length'] !== undefined &&
        (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength > MAX_BYTES)) {
      response.destroy();
      throw new Error('원본 미디어 크기가 허용 범위를 벗어났습니다.');
    }
    const digest = createHash('sha256');
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > MAX_BYTES) return callback(new Error('클라우드 영상이 2 GiB 다운로드 제한을 초과했습니다.'));
        digest.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(response, limit, createWriteStream(partial, { flags: 'wx', mode: 0o600 }),
      { signal: controller.signal });
    if (!size || (response.headers['content-length'] !== undefined && size !== declaredLength)) {
      throw new Error('원본 파일 다운로드 크기가 올바르지 않습니다.');
    }
    if (digest.digest('hex') !== expectedHash.toLowerCase()) {
      throw new Error('다운로드 파일이 제공된 SHA-256 체크섬과 일치하지 않습니다.');
    }
    await rename(partial, output);
    committed = true;
    return output;
  } catch (cause) {
    // Never leak signed URL, access tokens or sensitive response bodies into UI.
    if (controller.signal.aborted) throw new Error('원본 다운로드 시간이 초과되었습니다 (120초).');
    const message = cause instanceof Error ? cause.message : '';
    if (/^(허가|원본|다운로드|클라우드)/.test(message)) throw cause;
    throw new Error('승인된 원본 연결에 실패했습니다. URL 유효기간·호스트·네트워크를 확인하세요.');
  } finally {
    clearTimeout(timer);
    await rm(partial, { force: true }).catch(() => {});
    if (!committed) await rm(output, { force: true }).catch(() => {});
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { app } from 'electron';
import { probeMedia } from './media.js';
import { hasActiveRights, type BindSourceRequest, type SourceProvider, type StoredMediaBinding } from '../src/shared/sources.js';

const catalogDir = () => join(app.getPath('userData'), 'sources', 'approved');
const idPattern = /^[a-zA-Z0-9_-]{11}$/;

async function sha256(path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const stream = createReadStream(path);
    const digest = createHash('sha256');
    stream.on('data', (chunk: Buffer | string) => digest.update(chunk));
    stream.on('end', () => resolve(digest.digest('hex')));
    stream.on('error', reject);
  });
}

function isStoredBinding(raw: unknown, videoId: string): raw is StoredMediaBinding {
  if (!raw || typeof raw !== 'object') return false;
  const b = raw as Partial<StoredMediaBinding>;
  return b.referenceVideoId === videoId && idPattern.test(videoId) &&
    typeof b.localPath === 'string' && isAbsolute(b.localPath) &&
    typeof b.sourceAssetId === 'string' && /^[\da-f-]{36}$/i.test(b.sourceAssetId) &&
    typeof b.fileName === 'string' && typeof b.sha256 === 'string' && /^[a-f\d]{64}$/.test(b.sha256) &&
    (b.provider === 'creator_file' || b.provider === 'partner_file') &&
    typeof b.sizeBytes === 'number' && b.sizeBytes > 0 &&
    typeof b.durationSeconds === 'number' && b.durationSeconds > 0 &&
    typeof b.startOffsetSeconds === 'number' && Number.isFinite(b.startOffsetSeconds) &&
    b.startOffsetSeconds >= 0 && b.startOffsetSeconds <= 86400 &&
    !!b.rights && hasActiveRights(b.rights);
}

export class AuthorizedSources {
  async createBinding(videoId: string, localPath: string, request: BindSourceRequest,
    youtubeDuration: number, provider: SourceProvider = 'creator_file'): Promise<StoredMediaBinding> {
    if (!idPattern.test(videoId) || !isAbsolute(localPath)) throw new Error('영상 ID 또는 파일 경로가 올바르지 않습니다.');
    const checked = await stat(localPath);
    if (!checked.isFile() || !checked.size || checked.size > 8 * 1024 ** 3) {
      throw new Error('원본은 8 GiB 이하의 영상 파일이어야 합니다.');
    }
    const info = await probeMedia(localPath);
    if (info.duration + 0.5 < youtubeDuration + request.startOffsetSeconds) {
      throw new Error('원본 길이가 YouTube 탐색 구간과 오프셋을 포함하지 않습니다.');
    }
    const digest = await sha256(localPath);
    if (request.expectedSha256 && request.expectedSha256 !== digest) {
      throw new Error('권리자가 제공한 SHA-256 체크섬이 실제 원본과 다릅니다.');
    }
    const binding: StoredMediaBinding = {
      referenceVideoId: videoId, sourceAssetId: randomUUID(), provider,
      fileName: basename(localPath), localPath, durationSeconds: info.duration,
      sizeBytes: checked.size, sha256: digest, startOffsetSeconds: request.startOffsetSeconds,
      rights: {
        rightsHolder: request.rightsHolder, evidenceRef: request.evidenceRef,
        allowClip: true, allowDerivativeEdit: true, allowRepost: request.allowRepost,
        allowedPlatforms: request.allowRepost ? ['youtube'] : [],
        expiresAt: request.expiresAt, declaredAt: new Date().toISOString(),
      },
    };
    if (!hasActiveRights(binding.rights)) throw new Error('권한 선언이 만료되었습니다.');
    return binding;
  }

  async verify(binding: StoredMediaBinding, youtubeDuration: number | null): Promise<void> {
    if (!isStoredBinding(binding, binding.referenceVideoId)) throw new Error('원본 매핑 데이터 또는 편집 권한이 올바르지 않습니다.');
    if (youtubeDuration === null || binding.durationSeconds + 0.5 < youtubeDuration + binding.startOffsetSeconds) {
      throw new Error('YouTube/원본 길이 및 싱크 검증에 실패했습니다.');
    }
    const info = await stat(binding.localPath);
    if (!info.isFile() || info.size !== binding.sizeBytes) throw new Error('연결 파일 크기가 변경되거나 원본이 사라졌습니다.');
    const media = await probeMedia(binding.localPath);
    if (Math.abs(media.duration - binding.durationSeconds) > 0.25) throw new Error('원본 영상 길이가 변경되었습니다.');
    if (await sha256(binding.localPath) !== binding.sha256) throw new Error('원본 SHA-256 체크섬이 변경되었습니다.');
    if (!hasActiveRights(binding.rights)) throw new Error('원본 이용 권한 선언이 만료되었습니다.');
  }

  async isVerified(binding: StoredMediaBinding, youtubeDuration: number | null): Promise<boolean> {
    try { await this.verify(binding, youtubeDuration); return true; }
    catch { return false; }
  }

  async register(binding: StoredMediaBinding): Promise<void> {
    await mkdir(catalogDir(), { recursive: true });
    const target = join(catalogDir(), binding.referenceVideoId + '.json');
    const temp = join(catalogDir(), '.' + randomUUID() + '.tmp');
    try {
      await writeFile(temp, JSON.stringify(binding, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(temp, target);
    } finally { await rm(temp, { force: true }).catch(() => {}); }
  }

  async lookup(videoId: string): Promise<StoredMediaBinding | null> {
    if (!idPattern.test(videoId)) return null;
    try {
      const raw: unknown = JSON.parse(await readFile(join(catalogDir(), videoId + '.json'), 'utf8'));
      return isStoredBinding(raw, videoId) ? raw : null;
    } catch { return null; }
  }
}

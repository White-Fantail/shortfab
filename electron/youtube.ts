import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { basename, join } from 'node:path';
import { app, safeStorage, shell } from 'electron';
import {
  interpretYouTubeState, nextUploadOffset, validatePublishDraft,
  type PublishDraft, type PublishJobView, type PublishOverview, type PublishState,
} from '../src/shared/publishing.js';

const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
const CHUNK_SIZE = 8 * 1024 * 1024; // 256 KiB-aligned resumable upload chunks
const MAX_SIZE = 256 * 1024 ** 3;

interface SavedJob extends PublishJobView {
  filePath: string; // Main process only. Encrypted at rest; never returned through IPC.
  fileSize: number;
  fileHash: string;
  sessionUrl: string | null; // Upload session URL is a bearer-like secret.
}

interface VaultData {
  version: 1;
  refreshToken: string | null;
  jobs: SavedJob[];
}

interface Artifact {
  path: string;
  projectId: string;
  clipId: string;
}

interface UploadResponse {
  status: number;
  headers: Headers;
  body: string;
}

function secureStorageReady(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // Never fall back to Electron's insecure Linux 'basic_text' backend.
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function vaultPath(): string {
  return join(app.getPath('userData'), 'publishing', 'vault.dat');
}

function googleConfig(): { clientId: string; clientSecret?: string } | null {
  const clientId = process.env.SHORTFAB_GOOGLE_CLIENT_ID?.trim();
  if (!clientId || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) return null;
  return { clientId, clientSecret: process.env.SHORTFAB_GOOGLE_CLIENT_SECRET?.trim() || undefined };
}

function safeSessionUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !['www.googleapis.com', 'upload.googleapis.com'].includes(url.hostname) ||
      !url.pathname.startsWith('/upload/youtube/v3/videos') ||
      url.username || url.password || url.port) {
    throw new Error('YouTube 업로드 세션 주소가 올바르지 않습니다.');
  }
  return url.toString();
}

function apiError(status: number): Error {
  if (status === 401) return new Error('YouTube 인증이 만료되었습니다. 계정을 다시 연결해 주세요.');
  if (status === 403) return new Error('YouTube 업로드 권한, 계정 제한 또는 API 할당량을 확인해 주세요.');
  if (status === 404 || status === 410) return new Error('YouTube 업로드 세션이 만료되었습니다. YouTube Studio에서 중복 업로드 여부를 확인해 주세요.');
  if (status === 429 || status >= 500) return new Error('YouTube 서버가 일시적으로 응답하지 않습니다. 동일 작업에서 재시도하세요.');
  return new Error('YouTube API 요청에 실패했습니다 (HTTP ' + status + ').');
}

async function exchangeToken(params: URLSearchParams): Promise<{
  access_token?: string; refresh_token?: string; expires_in?: number;
}> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: params,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(30_000), redirect: 'error',
  });
  if (!response.ok) throw new Error('Google 인증 토큰 요청이 거절되었습니다 (HTTP ' + response.status + ').');
  return await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
}

async function oauthCode(clientId: string): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(24).toString('base64url');
  let receive: ((code: string) => void) | null = null;
  let rejectCode: ((error: Error) => void) | null = null;
  const codePromise = new Promise<string>((resolve, reject) => {
    receive = resolve;
    rejectCode = reject;
  });
  const server = createServer((req, res) => {
    // Only handle the intended loopback callback. Never echo the authorization code.
    const remote = req.socket.remoteAddress;
    if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1') {
      res.writeHead(403).end();
      return;
    }
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (parsed.pathname !== '/oauth/callback' || parsed.searchParams.get('state') !== state) {
      res.writeHead(404).end('Invalid OAuth callback.');
      return;
    }
    const code = parsed.searchParams.get('code');
    const denied = parsed.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(code ? 'ShortFab YouTube connection complete. You may close this tab.' :
      'Connection was cancelled. You may close this tab.');
    if (code) receive?.(code);
    else rejectCode?.(new Error(denied ? 'Google 계정 연결이 취소되었습니다.' : '인증 코드를 받지 못했습니다.'));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OAuth 로컬 포트를 열지 못했습니다.');
    const redirectUri = 'http://127.0.0.1:' + address.port + '/oauth/callback';
    const query = new URLSearchParams({
      client_id: clientId, response_type: 'code', redirect_uri: redirectUri,
      scope: SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256',
      access_type: 'offline', prompt: 'consent',
    });
    const timer = setTimeout(() => rejectCode?.(new Error('Google 로그인 제한 시간(2분)을 초과했습니다.')), 120_000);
    try {
      await shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?' + query);
      const code = await codePromise;
      return { code, verifier, redirectUri };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    server.close();
  }
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function jobView(job: SavedJob): PublishJobView {
  const { id, projectId, clipId, filename, state, progress, createdAt, updatedAt,
    metadata, remoteUrl, message } = job;
  return { id, projectId, clipId, filename, state, progress, createdAt, updatedAt,
    metadata, remoteUrl, message };
}

// Streaming 8 MiB instead of buffering an entire exported MP4 in memory.
function putChunk(uri: string, accessToken: string, file: string, first: number, last: number, total: number):
  Promise<UploadResponse> {
  const address = new URL(safeSessionUrl(uri));
  return new Promise((resolve, reject) => {
    const req = httpsRequest(address, {
      method: 'PUT', timeout: 120_000,
      headers: {
        Authorization: 'Bearer ' + accessToken, 'Content-Type': 'video/mp4',
        'Content-Length': last - first + 1,
        'Content-Range': 'bytes ' + first + '-' + last + '/' + total,
      },
    }, (response) => {
      const parts: Buffer[] = [];
      let length = 0;
      response.on('data', (piece: Buffer) => {
        length += piece.length;
        if (length > 1024 * 1024) { req.destroy(new Error('YouTube 응답 크기가 너무 큽니다.')); return; }
        parts.push(piece);
      });
      response.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === 'string') headers.set(key, value);
        }
        resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(parts).toString('utf8') });
      });
      response.on('error', reject);
    });
    req.once('timeout', () => req.destroy(new Error('YouTube 업로드 시간이 초과되었습니다.')));
    req.once('error', reject);
    const stream = createReadStream(file, { start: first, end: last });
    stream.once('error', (error) => req.destroy(error));
    stream.pipe(req);
  });
}

export class YouTubePublisher {
  private vault: VaultData | null = null;
  private artifact: Artifact | null = null;
  private access: { token: string; expires: number } | null = null;
  private busy = false;

  constructor(private readonly notify: (job: PublishJobView) => void) {}

  get isBusy(): boolean { return this.busy; }

  private async load(): Promise<VaultData> {
    if (this.vault) return this.vault;
    if (!secureStorageReady()) throw new Error('안전한 OS 암호화 저장소가 없어 YouTube 연결을 사용할 수 없습니다.');
    let encrypted: Buffer;
    try { encrypted = await readFile(vaultPath()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.vault = { version: 1, refreshToken: null, jobs: [] };
      return this.vault;
    }
    try {
      const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as VaultData;
      if (parsed.version !== 1 || !Array.isArray(parsed.jobs) ||
        (parsed.refreshToken !== null && typeof parsed.refreshToken !== 'string')) throw new Error();
      this.vault = parsed;
      // A crash during upload must not cause a second videos.insert.
      for (const job of parsed.jobs) {
        if (job.state === 'uploading') {
          job.state = job.sessionUrl ? 'failed' : 'action_required';
          job.message = '이전 작업이 중단되었습니다. 기존 업로드 상태를 확인해 주세요.';
        }
      }
      return parsed;
    } catch {
      throw new Error('암호화된 YouTube 게시 기록을 읽을 수 없습니다. 기존 기록을 초기화하지 않았습니다.');
    }
  }

  private async persist(): Promise<void> {
    if (!this.vault || !secureStorageReady()) throw new Error('보안 저장소를 사용할 수 없습니다.');
    const path = vaultPath();
    await mkdir(join(app.getPath('userData'), 'publishing'), { recursive: true });
    const tmp = path + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(tmp, safeStorage.encryptString(JSON.stringify(this.vault)), { flag: 'wx', mode: 0o600 });
      await rename(tmp, path);
    } finally { await rm(tmp, { force: true }).catch(() => {}); }
  }

  async overview(): Promise<PublishOverview> {
    const vault = await this.load();
    return {
      configured: googleConfig() !== null,
      connected: Boolean(vault.refreshToken),
      artifact: this.artifact ? {
        filename: basename(this.artifact.path), projectId: this.artifact.projectId, clipId: this.artifact.clipId,
      } : null,
      jobs: vault.jobs.slice(-20).reverse().map(jobView),
    };
  }

  async recordRender(path: string, projectId: string, clipId: string): Promise<void> {
    const info = await stat(path);
    if (!info.isFile() || info.size < 1) throw new Error('익스포트 파일이 올바르지 않습니다.');
    this.artifact = { path, projectId, clipId };
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('이미 YouTube 연결 또는 게시 작업을 진행하고 있습니다.');
    this.busy = true;
    try { return await work(); }
    finally { this.busy = false; }
  }

  async connect(): Promise<PublishOverview> {
    return this.exclusive(async () => {
      const config = googleConfig();
      if (!config) throw new Error('SHORTFAB_GOOGLE_CLIENT_ID를 먼저 설정해 주세요.');
      const vault = await this.load();
      const { code, verifier, redirectUri } = await oauthCode(config.clientId);
      const params = new URLSearchParams({
        client_id: config.clientId, code, code_verifier: verifier,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      });
      if (config.clientSecret) params.set('client_secret', config.clientSecret);
      const result = await exchangeToken(params);
      if (!result.access_token || (!result.refresh_token && !vault.refreshToken)) {
        throw new Error('오프라인 업로드 권한을 받지 못했습니다. Google 연결을 해제한 후 다시 시도해 주세요.');
      }
      vault.refreshToken = result.refresh_token || vault.refreshToken;
      this.access = { token: result.access_token, expires: Date.now() + (result.expires_in ?? 3600) * 1000 };
      await this.persist();
      return this.overview();
    });
  }

  async disconnect(): Promise<PublishOverview> {
    return this.exclusive(async () => {
      const vault = await this.load();
      const token = vault.refreshToken;
      vault.refreshToken = null;
      this.access = null;
      await this.persist();
      if (token) {
        // Best effort revocation; local tokens are destroyed even when offline.
        await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST', body: new URLSearchParams({ token }),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          signal: AbortSignal.timeout(5000), redirect: 'error',
        }).catch(() => {});
      }
      return this.overview();
    });
  }

  private async token(): Promise<string> {
    if (this.access && this.access.expires > Date.now() + 90_000) return this.access.token;
    const config = googleConfig();
    const vault = await this.load();
    if (!config || !vault.refreshToken) throw new Error('YouTube 계정을 연결해 주세요.');
    const params = new URLSearchParams({
      client_id: config.clientId, refresh_token: vault.refreshToken, grant_type: 'refresh_token',
    });
    if (config.clientSecret) params.set('client_secret', config.clientSecret);
    const result = await exchangeToken(params);
    if (!result.access_token) throw new Error('YouTube 권한이 만료되었습니다. 계정을 다시 연결해 주세요.');
    this.access = { token: result.access_token, expires: Date.now() + (result.expires_in ?? 3600) * 1000 };
    return result.access_token;
  }

  private async changed(job: SavedJob, state?: PublishState, message?: string): Promise<void> {
    if (state) job.state = state;
    if (message !== undefined) job.message = message;
    job.updatedAt = new Date().toISOString();
    await this.persist();
    this.notify(jobView(job));
  }

  private async authenticated(url: string, init: RequestInit): Promise<Response> {
    const token = await this.token();
    const response = await fetch(url, {
      ...init, headers: { ...init.headers, Authorization: 'Bearer ' + token },
      redirect: 'error', signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 401) this.access = null;
    return response;
  }

  async start(metadataInput: unknown, projectId: string): Promise<PublishJobView> {
    return this.exclusive(async () => {
      const metadata = validatePublishDraft(metadataInput);
      const file = this.artifact;
      if (!file || file.projectId !== projectId) throw new Error('현재 프로젝트에서 MP4를 다시 익스포트해 주세요.');
      const vault = await this.load();
      if (!vault.refreshToken || !googleConfig()) throw new Error('YouTube 계정을 연결해 주세요.');
      const info = await stat(file.path);
      if (!info.isFile() || info.size < 1 || info.size > MAX_SIZE) throw new Error('업로드할 MP4 파일 크기를 확인해 주세요.');
      const hash = await fileHash(file.path);
      const matching = vault.jobs.find(job => job.projectId === file.projectId &&
        job.clipId === file.clipId && job.fileHash === hash &&
        JSON.stringify(job.metadata) === JSON.stringify(metadata));
      if (matching) {
        throw new Error('동일 영상·게시 설정의 작업이 이미 있습니다 (' + matching.state +
          '). 게시함에서 기존 작업을 확인하거나 재시도하세요.');
      }
      const now = new Date().toISOString();
      const job: SavedJob = {
        id: randomUUID(), projectId: file.projectId, clipId: file.clipId,
        filename: basename(file.path), filePath: file.path, fileSize: info.size,
        fileHash: hash, sessionUrl: null, state: 'uploading', progress: 0,
        metadata, remoteUrl: null, createdAt: now, updatedAt: now, message: '업로드 세션 준비 중',
      };
      vault.jobs.push(job);
      await this.changed(job);
      await this.perform(job);
      return jobView(job);
    });
  }

  async retry(id: string, projectId: string): Promise<PublishJobView> {
    return this.exclusive(async () => {
      const vault = await this.load();
      const job = vault.jobs.find(item => item.id === id && item.projectId === projectId);
      if (!job || job.state !== 'failed' || !job.sessionUrl) {
        throw new Error('재개할 수 없는 작업입니다. YouTube Studio에서 상태를 확인해 주세요.');
      }
      const info = await stat(job.filePath);
      if (!info.isFile() || info.size !== job.fileSize || await fileHash(job.filePath) !== job.fileHash) {
        throw new Error('업로드 원본이 변경되었습니다. 재시도할 수 없습니다.');
      }
      await this.changed(job, 'uploading', '기존 업로드 세션을 확인하는 중');
      await this.perform(job);
      return jobView(job);
    });
  }

  private async perform(job: SavedJob): Promise<void> {
    try {
      if (!job.sessionUrl) {
        // Persist the ambiguous-start marker before calling videos.insert.
        await this.changed(job, 'uploading', 'YouTube 세션 생성 요청 중');
        const response = await this.authenticated(
          'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus',
          { method: 'POST', headers: {
            'content-type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': 'video/mp4',
            'X-Upload-Content-Length': String(job.fileSize),
          }, body: JSON.stringify({
            snippet: { title: job.metadata.title, description: job.metadata.description, categoryId: '22' },
            status: { privacyStatus: job.metadata.privacyStatus, selfDeclaredMadeForKids: job.metadata.madeForKids },
          }) });
        if (!response.ok) throw apiError(response.status);
        const session = response.headers.get('location');
        if (!session) throw new Error('YouTube가 업로드 세션을 반환하지 않았습니다.');
        job.sessionUrl = safeSessionUrl(session);
        await this.changed(job, 'uploading', '업로드 중');
      }
      if (!job.sessionUrl) throw new Error('YouTube 세션을 찾을 수 없습니다.');
      const session = safeSessionUrl(job.sessionUrl);
      const probe = await this.authenticated(session, {
        method: 'PUT', headers: { 'Content-Range': 'bytes */' + job.fileSize, 'Content-Length': '0' },
      });
      let offset = 0;
      if (probe.status === 200 || probe.status === 201) {
        await this.acceptVideo(job, await probe.text());
        return;
      }
      if (probe.status !== 308) throw apiError(probe.status);
      offset = nextUploadOffset(probe.status, probe.headers.get('range'), job.fileSize);
      while (offset < job.fileSize) {
        const last = Math.min(job.fileSize - 1, offset + CHUNK_SIZE - 1);
        const sent = await putChunk(session, await this.token(), job.filePath, offset, last, job.fileSize);
        if (sent.status === 200 || sent.status === 201) {
          await this.acceptVideo(job, sent.body);
          return;
        }
        if (sent.status !== 308) {
          if (sent.status === 401) this.access = null;
          throw apiError(sent.status);
        }
        const next = nextUploadOffset(sent.status, sent.headers.get('range'), job.fileSize);
        if (next <= offset) throw new Error('YouTube 업로드가 진행되지 않습니다. 세션 상태를 다시 확인해 주세요.');
        offset = next;
        job.progress = Math.floor(offset / job.fileSize * 100);
        await this.changed(job, 'uploading', '업로드 중 (' + job.progress + '%)');
      }
      throw new Error('업로드 완료 응답을 받지 못했습니다. 세션 확인 후 재시도하세요.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'YouTube 업로드에 실패했습니다.';
      await this.changed(job, job.sessionUrl ? 'failed' : 'action_required', message);
      throw new Error(message);
    }
  }

  private async acceptVideo(job: SavedJob, payload: string): Promise<void> {
    let id: unknown;
    try { id = (JSON.parse(payload) as { id?: unknown }).id; } catch { /* ignore malformed body */ }
    if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) {
      throw new Error('YouTube가 완료된 영상 ID를 반환하지 않았습니다. 중복 업로드 전에 Studio를 확인하세요.');
    }
    job.remoteUrl = 'https://www.youtube.com/watch?v=' + id;
    job.progress = 100;
    job.sessionUrl = null;
    await this.changed(job, 'processing', '파일 전송 완료 · YouTube 처리 상태 확인 필요');
  }

  async refresh(id: string, projectId: string): Promise<PublishJobView> {
    return this.exclusive(async () => {
      const vault = await this.load();
      const job = vault.jobs.find(item => item.id === id && item.projectId === projectId);
      if (!job || !job.remoteUrl) throw new Error('업로드된 영상 ID가 없는 작업입니다.');
      const videoId = new URL(job.remoteUrl).searchParams.get('v');
      if (!videoId) throw new Error('영상 ID가 올바르지 않습니다.');
      const response = await this.authenticated(
        'https://www.googleapis.com/youtube/v3/videos?part=status%2CprocessingDetails&id=' + encodeURIComponent(videoId),
        { method: 'GET' });
      if (!response.ok) throw apiError(response.status);
      const data = await response.json() as { items?: unknown[] };
      if (!data.items?.length) {
        await this.changed(job, 'action_required', '영상이 조회되지 않습니다. YouTube Studio에서 확인해 주세요.');
      } else {
        const state = interpretYouTubeState(data.items[0]);
        const visibility = job.metadata.privacyStatus === 'public' ? '공개' :
          job.metadata.privacyStatus === 'unlisted' ? '일부 공개' : '비공개';
        await this.changed(job, state, state === 'published' ?
          '처리 완료 · 요청한 공개 범위: ' + visibility + ' (실제 공개 범위는 YouTube Studio에서 확인)' :
          state === 'processing' ? 'YouTube에서 영상 처리 중' : 'YouTube 처리 실패 또는 확인 필요');
      }
      return jobView(job);
    });
  }
}

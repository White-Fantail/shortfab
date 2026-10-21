import { randomUUID } from 'node:crypto';
import { AuthorizedSources } from './sources.js';
import { youtubeVideoId } from '../src/shared/contracts.js';
import { mappedClipRange, resolveYouTubeSource, validateBindSourceRequest,
  type BindSourceRequest, type StoredMediaBinding } from '../src/shared/sources.js';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { app } from 'electron';
import { probeMedia } from './media.js';
import type { MediaInfo } from '../src/shared/contracts.js';
import {
  isProjectId, validateProjectEdits,
  type ProjectClip, type ProjectRecord,
  type ProjectSummary, type ProjectView, type StoredAsset,
} from '../src/shared/projects.js';

const projectDir = () => join(app.getPath('userData'), 'projects');
const projectFile = (id: string) => join(projectDir(), id + '.json');

function assertRecord(input: unknown, id: string): ProjectRecord {
  if (!input || typeof input !== 'object') throw new Error('프로젝트 파일이 손상되었습니다.');
  const candidate = input as Partial<ProjectRecord>;
  if (candidate.schemaVersion !== 1 || candidate.id !== id ||
    typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string' ||
    (candidate.asset !== null && (
      !candidate.asset || !isProjectId(candidate.asset.id) ||
      typeof candidate.asset.localPath !== 'string' || !isAbsolute(candidate.asset.localPath) ||
      typeof candidate.asset.name !== 'string' ||
      !Number.isFinite(candidate.asset.sizeBytes) || candidate.asset.sizeBytes <= 0 ||
      !Number.isFinite(candidate.asset.duration) || candidate.asset.duration <= 0 ||
      !Number.isFinite(candidate.asset.width) || !Number.isFinite(candidate.asset.height) ||
      typeof candidate.asset.hasAudio !== 'boolean'
    ))) {
    throw new Error('프로젝트 스키마 또는 원본 메타데이터가 올바르지 않습니다.');
  }
  const edits = validateProjectEdits({ ...candidate,
    youtubeDuration: candidate.youtubeDuration ?? null,
    clips: candidate.clips?.map((clip) => ({ ...clip, source: clip.source ?? 'local' })),
  }, candidate.asset?.duration ?? null);
  return { ...candidate, ...edits, youtubeBinding: candidate.youtubeBinding ?? null,
    schemaVersion: 1 } as ProjectRecord;
}

export class ProjectStore {
  private active: ProjectRecord | null = null;
  private connectedPath: string | null = null;
  private mediaGeneration = 0;
  private sources = new AuthorizedSources();
  private youtubeVerified = false;

  get activeProjectId(): string | null { return this.active?.id ?? null; }

  get activeClip(): ProjectClip | null {
    return this.active?.clips.find((clip) => clip.id === this.active?.selectedClipId) ?? null;
  }

  get activeSource(): { id: string; path: string; info: MediaInfo } | null {
    const asset = this.active?.asset;
    if (!asset || !this.connectedPath) return null;
    return {
      id: asset.id, path: this.connectedPath,
      info: this.mediaInfo(asset),
    };
  }

  private mediaInfo(asset: StoredAsset): MediaInfo {
    return {
      id: asset.id,
      name: asset.name,
      duration: asset.duration,
      width: asset.width,
      height: asset.height,
      hasAudio: asset.hasAudio,
      previewUrl: `shortfab-media://asset/current?v=${this.mediaGeneration}`,
    };
  }

  get selectedClipSource(): 'local' | 'youtube' | null { return this.activeClip?.source ?? null; }

  get youtubeBinding(): StoredMediaBinding | null { return this.active?.youtubeBinding ?? null; }

  async renderableYouTubeSource(): Promise<{ id: string; path: string; duration: number; offset: number }> {
    const clip = this.activeClip;
    const binding = this.active?.youtubeBinding;
    if (!clip || clip.source !== 'youtube' || !binding ||
      !youtubeVideoId(this.active!.youtubeUrl) || binding.referenceVideoId !== youtubeVideoId(this.active!.youtubeUrl)) {
      throw new Error('선택한 YouTube 클립에 연결된 원본이 없습니다.');
    }
    await this.sources.verify(binding, this.active!.youtubeDuration);
    mappedClipRange(clip.start, clip.end, binding);
    this.youtubeVerified = true;
    return { id: binding.sourceAssetId, path: binding.localPath,
      duration: binding.durationSeconds, offset: binding.startOffsetSeconds };
  }

  async assertYouTubePublishAllowed(): Promise<void> {
    if (this.activeClip?.source !== 'youtube') return;
    await this.renderableYouTubeSource();
    const b = this.active?.youtubeBinding;
    if (!b?.rights.allowRepost || !b.rights.allowedPlatforms.includes('youtube')) {
      throw new Error('현재 권한 선언에는 YouTube 재게시 허가가 포함되지 않았습니다.');
    }
  }

  private view(): ProjectView {
    if (!this.active) throw new Error('먼저 프로젝트를 열어 주세요.');
    const { asset, youtubeBinding, ...publicRecord } = this.active;
    const videoId = youtubeVideoId(this.active.youtubeUrl);
    const youtubeSource = videoId ? resolveYouTubeSource({
      videoId, url: this.active.youtubeUrl, durationSeconds: this.active.youtubeDuration,
    }, youtubeBinding, this.youtubeVerified) : {
      state: 'preview_only' as const, explanation: 'YouTube 링크를 입력해 주세요.',
      binding: null, canRender: false, canPublishYouTube: false,
    };
    return {
      ...publicRecord, youtubeSource,
      media: asset ? { ...this.mediaInfo(asset), previewUrl: this.connectedPath ? this.mediaInfo(asset).previewUrl : '' } : null,
      sourceStatus: !asset ? 'none' : this.connectedPath ? 'connected' : 'missing',
      sourceName: asset?.name ?? null,
    };
  }

  private async read(id: string): Promise<ProjectRecord> {
    if (!isProjectId(id)) throw new Error('프로젝트 ID가 올바르지 않습니다.');
    let raw: string;
    try {
      raw = await readFile(projectFile(id), 'utf8');
    } catch {
      throw new Error('프로젝트 파일을 찾거나 읽을 수 없습니다.');
    }
    try {
      return assertRecord(JSON.parse(raw), id);
    } catch (cause) {
      throw new Error(cause instanceof Error ? cause.message : '프로젝트 파일이 손상되었습니다.');
    }
  }

  private async write(record: ProjectRecord): Promise<void> {
    await mkdir(projectDir(), { recursive: true });
    const tmp = join(projectDir(), `.${record.id}.${randomUUID()}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(record, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(tmp, projectFile(record.id));
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  }

  async list(): Promise<ProjectSummary[]> {
    await mkdir(projectDir(), { recursive: true });
    const files = await readdir(projectDir());
    const results = await Promise.all(files.filter((name) => name.endsWith('.json') &&
      isProjectId(name.slice(0, -5))).map(async (name): Promise<ProjectSummary | null> => {
      try {
        const value = await this.read(name.slice(0, -5));
        return { id: value.id, title: value.title, updatedAt: value.updatedAt,
          clipCount: value.clips.length, sourceName: value.asset?.name ?? null };
      } catch {
        return null; // An invalid file must not prevent opening healthy projects.
      }
    }));
    return results.filter((item): item is ProjectSummary => item !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(): Promise<ProjectView> {
    const now = new Date().toISOString();
    const record: ProjectRecord = {
      schemaVersion: 1, id: randomUUID(), title: '새 프로젝트',
      createdAt: now, updatedAt: now, revision: 0,
      asset: null, youtubeUrl: '', youtubeDuration: null, youtubeBinding: null,
      clips: [], selectedClipId: null,
    };
    await this.write(record);
    this.active = record;
    this.connectedPath = null;
    this.youtubeVerified = false;
    return this.view();
  }

  async open(id: string): Promise<ProjectView> {
    const record = await this.read(id);
    let connectedPath: string | null = null;
    if (record.asset) {
      try {
        const checked = await stat(record.asset.localPath);
        if (checked.isFile() && checked.size === record.asset.sizeBytes) {
          const probe = await probeMedia(record.asset.localPath);
          if (probe.width === record.asset.width && probe.height === record.asset.height &&
            Math.abs(probe.duration - record.asset.duration) < 0.25) {
            connectedPath = record.asset.localPath;
          }
        }
      } catch {
        // Missing, moved, or unreadable asset: project remains editable and reconnectable.
      }
    }
    const videoId = youtubeVideoId(record.youtubeUrl);
    const matched = videoId && !record.youtubeBinding ? await this.sources.lookup(videoId) : null;
    const current: ProjectRecord = { ...record, youtubeBinding: record.youtubeBinding ?? matched };
    this.youtubeVerified = current.youtubeBinding ?
      await this.sources.isVerified(current.youtubeBinding, current.youtubeDuration) : false;
    this.active = current;
    this.connectedPath = connectedPath;
    this.mediaGeneration += 1;
    return this.view();
  }

  async save(input: unknown): Promise<ProjectView> {
    if (!this.active) throw new Error('먼저 프로젝트를 열어 주세요.');
    const edits = validateProjectEdits(input, this.active.asset?.duration ?? null);
    if (edits.id !== this.active.id) throw new Error('다른 프로젝트를 저장하려고 했습니다.');
    if (edits.revision !== this.active.revision) {
      throw new Error('프로젝트가 변경되었습니다. 다시 열어 최신 버전을 확인해 주세요.');
    }
    const before = youtubeVideoId(this.active.youtubeUrl);
    const after = youtubeVideoId(edits.youtubeUrl);
    const sameVideo = before !== null && before === after;
    const binding = sameVideo ? this.active.youtubeBinding :
      after ? await this.sources.lookup(after) : null;
    this.youtubeVerified = binding ? await this.sources.isVerified(binding, edits.youtubeDuration) : false;
    const updated: ProjectRecord = {
      ...this.active, ...edits, youtubeBinding: binding, revision: this.active.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.write(updated);
    this.active = updated;
    return this.view();
  }

  async bindYouTubeMedia(filePath: string, request: unknown): Promise<ProjectView> {
    if (!this.active) throw new Error('먼저 프로젝트를 열어 주세요.');
    const videoId = youtubeVideoId(this.active.youtubeUrl);
    if (!videoId || !this.active.youtubeDuration) throw new Error('YouTube URL과 영상 길이를 먼저 확인해 주세요.');
    const input: BindSourceRequest = validateBindSourceRequest(request);
    const binding = await this.sources.createBinding(videoId, filePath, input, this.active.youtubeDuration);
    const updated: ProjectRecord = { ...this.active, youtubeBinding: binding,
      revision: this.active.revision + 1, updatedAt: new Date().toISOString() };
    await this.write(updated);
    this.active = updated;
    this.youtubeVerified = true;
    await this.sources.register(binding); // Registry enables subsequent URL-based automatic matching.
    return this.view();
  }

  async attachMedia(filePath: string, reconnect: boolean): Promise<ProjectView> {
    if (!this.active) throw new Error('먼저 프로젝트를 열어 주세요.');
    const probed = await probeMedia(filePath);
    const checked = await stat(filePath);
    const previous = this.active.asset;
    if (reconnect && !previous) throw new Error('재연결할 원본이 없습니다.');
    if (reconnect && previous &&
      (checked.size !== previous.sizeBytes || probed.width !== previous.width ||
        probed.height !== previous.height || Math.abs(probed.duration - previous.duration) > 0.25)) {
      throw new Error('기존 원본과 파일 크기/영상 정보가 다릅니다. 올바른 원본을 선택해 주세요.');
    }
    const asset: StoredAsset = {
      id: reconnect && previous ? previous.id : randomUUID(),
      localPath: filePath, ...probed, sizeBytes: checked.size,
    };
    const initialClip: ProjectClip = {
      source: 'local', id: randomUUID(), title: '클립 1', start: 0,
      end: Math.min(30, probed.duration), width: 720,
    };
    const updated: ProjectRecord = {
      ...this.active, asset,
      clips: reconnect ? this.active.clips : [
        ...this.active.clips.filter((clip) => clip.source === 'youtube'),
        ...(probed.duration >= 0.2 ? [initialClip] : []),
      ],
      selectedClipId: reconnect ? this.active.selectedClipId :
        probed.duration >= 0.2 ? initialClip.id : this.active.clips.find((clip) => clip.source === 'youtube')?.id ?? null,
      updatedAt: new Date().toISOString(), revision: this.active.revision + 1,
    };
    await this.write(updated);
    this.active = updated;
    this.connectedPath = filePath;
    this.mediaGeneration += 1;
    return this.view();
  }
}

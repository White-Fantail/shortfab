import { youtubeVideoId, type MediaInfo, type OutputWidth } from './contracts.js';

export interface ProjectClip {
  id: string;
  title: string;
  start: number;
  end: number;
  width: OutputWidth;
}

export interface StoredAsset {
  id: string;
  localPath: string; // Main process only. Never send to renderer.
  name: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sizeBytes: number;
}

export interface ProjectRecord {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  asset: StoredAsset | null;
  youtubeUrl: string;
  clips: ProjectClip[];
  selectedClipId: string | null;
}

export type SourceStatus = 'none' | 'connected' | 'missing';

export interface ProjectView extends Omit<ProjectRecord, 'asset'> {
  media: MediaInfo | null;
  sourceStatus: SourceStatus;
  sourceName: string | null;
}

export interface ProjectSummary {
  id: string;
  title: string;
  updatedAt: string;
  clipCount: number;
  sourceName: string | null;
}

export type ProjectEdits = Pick<ProjectRecord,
  'id' | 'revision' | 'title' | 'youtubeUrl' | 'clips' | 'selectedClipId'>;

export const isProjectId = (id: unknown): id is string =>
  typeof id === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function validateProjectEdits(input: unknown, sourceDuration: number | null): ProjectEdits {
  if (!input || typeof input !== 'object') throw new Error('프로젝트 편집 데이터가 올바르지 않습니다.');
  const value = input as Partial<ProjectEdits>;
  if (!isProjectId(value.id) || !Number.isSafeInteger(value.revision) || value.revision! < 0) {
    throw new Error('프로젝트 식별자 또는 버전이 올바르지 않습니다.');
  }
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 100) {
    throw new Error('프로젝트 이름은 1~100자로 입력하세요.');
  }
  if (typeof value.youtubeUrl !== 'string' || value.youtubeUrl.length > 2048 ||
    (value.youtubeUrl.trim() && !youtubeVideoId(value.youtubeUrl.trim()))) {
    throw new Error('YouTube 주소가 올바르지 않습니다.');
  }
  if (!Array.isArray(value.clips) || value.clips.length > 100) {
    throw new Error('클립은 최대 100개까지 저장할 수 있습니다.');
  }
  const ids = new Set<string>();
  const clips: ProjectClip[] = value.clips.map((clip) => {
    if (!clip || !isProjectId(clip.id) || ids.has(clip.id) ||
      typeof clip.title !== 'string' || !clip.title.trim() || clip.title.length > 100 ||
      !Number.isFinite(clip.start) || !Number.isFinite(clip.end) ||
      clip.start < 0 || clip.end - clip.start < 0.2 ||
      (sourceDuration !== null && clip.end > sourceDuration + 0.02) ||
      (clip.width !== 720 && clip.width !== 1080)) {
      throw new Error('클립 이름, 구간 또는 해상도를 확인해 주세요.');
    }
    ids.add(clip.id);
    return {
      id: clip.id, title: clip.title.trim(),
      start: clip.start, end: clip.end, width: clip.width,
    };
  });
  if (value.selectedClipId !== null &&
    (typeof value.selectedClipId !== 'string' || !ids.has(value.selectedClipId))) {
    throw new Error('선택된 클립이 프로젝트에 없습니다.');
  }
  if (value.selectedClipId === undefined || (clips.length && value.selectedClipId === null)) {
    throw new Error('저장할 클립을 선택해 주세요.');
  }
  if (sourceDuration === null && clips.length) {
    throw new Error('영상 원본을 먼저 연결해 주세요.');
  }
  return {
    id: value.id, revision: value.revision!, title: value.title.trim(),
    youtubeUrl: value.youtubeUrl.trim(), clips,
    selectedClipId: value.selectedClipId,
  };
}

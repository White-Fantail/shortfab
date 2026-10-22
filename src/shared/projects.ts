import { CLIP_TIME_EPSILON, MIN_CLIP_SECONDS, youtubeVideoId, type MediaInfo, type OutputWidth } from './contracts.js';
import type { SourceResolution, StoredMediaBinding } from './sources.js';
import { validateSubtitleTrack, type SubtitleTrack } from './subtitles.js';
import { normalizeWizard, type WizardRecord } from './wizard.js';
import { validateLayout, type LayoutStyle } from './layout-styles.js';

export type ClipSource = 'local' | 'youtube';

export interface ProjectClip {
  source: ClipSource;
  id: string;
  title: string;
  start: number;
  end: number;
  width: OutputWidth;
  layout?: LayoutStyle; // Legacy saved clips default to center, without visual changes.
  subtitles?: SubtitleTrack | null; // Legacy project JSON has no captions.
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
  youtubeDuration: number | null; // IFrame API metadata, not a renderable asset.
  youtubeBinding: StoredMediaBinding | null; // Main process only.
  clips: ProjectClip[];
  selectedClipId: string | null;
  wizard?: WizardRecord; // Optional for legacy schemaVersion 1 projects.
}

export type SourceStatus = 'none' | 'connected' | 'missing';

export interface ProjectView extends Omit<ProjectRecord, 'asset' | 'youtubeBinding'> {
  youtubeSource: SourceResolution;
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
  'id' | 'revision' | 'title' | 'youtubeUrl' | 'youtubeDuration' | 'clips' | 'selectedClipId' | 'wizard'>;

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
  const youtubeDuration = value.youtubeDuration ?? null;
  if (youtubeDuration !== null && (!Number.isFinite(youtubeDuration) || youtubeDuration <= 0 || youtubeDuration > 604800 || !youtubeVideoId(value.youtubeUrl?.trim() ?? ''))) {
    throw new Error('YouTube 영상 길이가 올바르지 않습니다.');
  }
  if (!Array.isArray(value.clips) || value.clips.length > 100) {
    throw new Error('클립은 최대 100개까지 저장할 수 있습니다.');
  }
  const ids = new Set<string>();
  const clips: ProjectClip[] = value.clips.map((clip, index) => {
    const source = clip?.source ?? 'local'; // Older projects have local clips with no discriminator.
    const label = `클립 ${index + 1}`;
    const limit = source === 'youtube' ? youtubeDuration : sourceDuration;
    if (source === 'local' && sourceDuration === null) {
      throw new Error('영상 원본을 먼저 연결해 주세요.');
    }
    if (!clip || (source !== 'youtube' && source !== 'local')) {
      throw new Error(`${label}: 원본 종류가 올바르지 않습니다.`);
    }
    if (source === 'youtube' && (!youtubeVideoId(value.youtubeUrl!) || youtubeDuration === null)) {
      throw new Error(`${label}: YouTube 영상 길이를 불러온 뒤 저장해 주세요.`);
    }
    if (!isProjectId(clip.id) || ids.has(clip.id)) {
      throw new Error(`${label}: 클립 식별자가 올바르지 않거나 중복되었습니다.`);
    }
    if (typeof clip.title !== 'string' || !clip.title.trim() || clip.title.length > 100) {
      throw new Error(`${label}: 이름을 1~100자로 입력해 주세요.`);
    }
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) ||
        clip.start < 0 || clip.end - clip.start < MIN_CLIP_SECONDS - CLIP_TIME_EPSILON) {
      throw new Error(`${label}: IN/OUT 구간을 확인해 주세요 (최소 0.2초).`);
    }
    if (limit !== null && clip.end > limit + 0.02) {
      throw new Error(`${label}: OUT 지점이 영상 길이(${limit.toFixed(1)}초)를 초과합니다.`);
    }
    if (clip.width !== 720 && clip.width !== 1080) {
      throw new Error(`${label}: 해상도는 720p 또는 1080p여야 합니다.`);
    }
    ids.add(clip.id);
    return {
      source, id: clip.id, title: clip.title.trim(),
      start: clip.start, end: clip.end, width: clip.width,
      layout: validateLayout(clip.layout), subtitles: validateSubtitleTrack(clip.subtitles ?? null, clip.end - clip.start, label),
    };
  });
  if (value.selectedClipId !== null &&
    (typeof value.selectedClipId !== 'string' || !ids.has(value.selectedClipId))) {
    throw new Error('선택된 클립이 프로젝트에 없습니다.');
  }
  if (value.selectedClipId === undefined || (clips.length && value.selectedClipId === null)) {
    throw new Error('저장할 클립을 선택해 주세요.');
  }
  return {
    id: value.id, revision: value.revision!, title: value.title.trim(),
    youtubeUrl: value.youtubeUrl.trim(), youtubeDuration, clips,
    selectedClipId: value.selectedClipId,
    wizard: normalizeWizard(value.wizard, clips),
  };
}

/** Invalid intermediate edits stay local until corrected. */
export function projectEditValidationError(input: unknown, sourceDuration: number | null): string | null {
  try {
    validateProjectEdits(input, sourceDuration);
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : '편집 내용을 확인해 주세요.';
  }
}

export type YouTubePrivacy = 'private' | 'unlisted' | 'public';
export type PublishState = 'uploading' | 'processing' | 'published' | 'failed' | 'action_required';

export interface PublishDraft {
  title: string;
  description: string;
  privacyStatus: YouTubePrivacy;
  madeForKids: boolean;
}

export interface PublishJobView {
  id: string;
  projectId: string;
  clipId: string;
  filename: string;
  state: PublishState;
  progress: number;
  createdAt: string;
  updatedAt: string;
  metadata: PublishDraft;
  remoteUrl: string | null;
  message: string;
}

export interface PublishOverview {
  configured: boolean;
  connected: boolean;
  artifact: { filename: string; projectId: string; clipId: string; start: number; end: number; width: number } | null;
  jobs: PublishJobView[];
}

export interface PublishProgress {
  job: PublishJobView;
}

export function validatePublishDraft(input: unknown): PublishDraft {
  if (!input || typeof input !== 'object') throw new Error('게시 정보가 올바르지 않습니다.');
  const data = input as Partial<PublishDraft>;
  if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 100) {
    throw new Error('YouTube 제목은 1~100자로 입력하세요.');
  }
  if (typeof data.description !== 'string' || data.description.length > 5000) {
    throw new Error('설명은 최대 5,000자까지 입력할 수 있습니다.');
  }
  if (!['private', 'unlisted', 'public'].includes(data.privacyStatus ?? '')) {
    throw new Error('공개 범위를 선택해 주세요.');
  }
  if (typeof data.madeForKids !== 'boolean') {
    throw new Error('아동용 영상 여부를 선택해 주세요.');
  }
  return { title: data.title.trim(), description: data.description,
    privacyStatus: data.privacyStatus!, madeForKids: data.madeForKids };
}

export function nextUploadOffset(status: number, range: string | null, total: number): number {
  if (status !== 308) throw new Error('업로드 진행 상태가 올바르지 않습니다.');
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('잘못된 영상 크기입니다.');
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  if (!match) throw new Error('YouTube가 잘못된 업로드 범위를 반환했습니다.');
  const end = Number(match[1]);
  if (!Number.isSafeInteger(end) || end < 0 || end >= total) {
    throw new Error('YouTube 업로드 범위가 영상 크기를 초과했습니다.');
  }
  return end + 1;
}

export function interpretYouTubeState(input: unknown): PublishState {
  if (!input || typeof input !== 'object') return 'action_required';
  const video = input as { status?: { uploadStatus?: string }; processingDetails?: { processingStatus?: string } };
  const upload = video.status?.uploadStatus;
  const processing = video.processingDetails?.processingStatus;
  if (processing === 'failed' || ['failed', 'rejected', 'deleted', 'uploadFailed', 'transcodeFailed', 'streamingFailed'].includes(upload ?? '')) return 'action_required';
  if (processing === 'succeeded' && (!upload || upload === 'processed' || upload === 'uploaded')) return 'published';
  return 'processing';
}

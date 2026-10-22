import type { RenderProgress, RenderRequest, RenderResult } from './shared/contracts';
import type { ProjectEdits, ProjectSummary, ProjectView } from './shared/projects';
import type { BindSourceRequest } from './shared/sources';
import type { ApprovedCloudSourceRequest } from './shared/cloud';
import type { PublishDraft, PublishJobView, PublishOverview, PublishProgress } from './shared/publishing';
import type { SttProgress, SttRequest, SttResult, SttStatus } from './shared/stt';
import type { AnalyzeProgress, AnalyzeRequest, AnalyzeResult, ClipAnalysis } from './shared/recommendations';

declare global {
  interface Window {
    shortfab?: {
      listProjects(): Promise<ProjectSummary[]>;
      createProject(): Promise<ProjectView>;
      openProject(id: string): Promise<ProjectView>;
      saveProject(edits: ProjectEdits): Promise<ProjectView>;
      pickMedia(): Promise<ProjectView | null>;
      reconnectMedia(): Promise<ProjectView | null>;
      bindYouTubeMedia(request: BindSourceRequest): Promise<ProjectView | null>;
      bindCloudSource(request: ApprovedCloudSourceRequest): Promise<ProjectView>;
      partnerCatalogStatus(): Promise<{ configured: boolean }>;
      bindPartnerSource(): Promise<ProjectView>;
      previewClipFrame(request: { clipId: string; time: number }): Promise<{ status: 'completed'; image: string } | { status: 'cancelled' }>;
      cancelFramePreview(): Promise<void>;
      startRender(request: RenderRequest): Promise<RenderResult>;
      cancelRender(): Promise<void>;
      personalToolAvailable(): Promise<boolean>;
      startAnalysis(request: AnalyzeRequest): Promise<AnalyzeResult>;
      cancelAnalysis(): Promise<void>;
      cachedAnalysis(videoId: string, duration: number, language: AnalyzeRequest['language']): Promise<ClipAnalysis | null>;
      onAnalysisProgress(callback: (progress: AnalyzeProgress) => void): () => void;
      sttStatus(): Promise<SttStatus>;
      chooseSttModel(): Promise<SttStatus>;
      installSttModel(): Promise<SttStatus>;
      cancelSttModel(): Promise<void>;
      transcribeClip(request: SttRequest): Promise<SttResult>;
      cancelTranscription(): Promise<void>;
      onSttProgress(callback: (progress: SttProgress) => void): () => void;
      onProgress(callback: (progress: RenderProgress) => void): () => void;
      publishOverview(): Promise<PublishOverview>;
      connectYouTube(): Promise<PublishOverview>;
      disconnectYouTube(): Promise<PublishOverview>;
      startPublish(draft: PublishDraft): Promise<PublishJobView | null>;
      retryPublish(id: string): Promise<PublishJobView | null>;
      refreshPublish(id: string): Promise<PublishJobView>;
      onPublishProgress(callback: (progress: PublishProgress) => void): () => void;
    };
  }
}

export {};

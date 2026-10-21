import type { RenderProgress, RenderRequest, RenderResult } from './shared/contracts';
import type { ProjectEdits, ProjectSummary, ProjectView } from './shared/projects';
import type { BindSourceRequest } from './shared/sources';
import type { PublishDraft, PublishJobView, PublishOverview, PublishProgress } from './shared/publishing';

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
      startRender(request: RenderRequest): Promise<RenderResult>;
      cancelRender(): Promise<void>;
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

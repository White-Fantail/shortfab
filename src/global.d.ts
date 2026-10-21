import type { RenderProgress, RenderRequest, RenderResult } from './shared/contracts';
import type { ProjectEdits, ProjectSummary, ProjectView } from './shared/projects';

declare global {
  interface Window {
    shortfab?: {
      listProjects(): Promise<ProjectSummary[]>;
      createProject(): Promise<ProjectView>;
      openProject(id: string): Promise<ProjectView>;
      saveProject(edits: ProjectEdits): Promise<ProjectView>;
      pickMedia(): Promise<ProjectView | null>;
      reconnectMedia(): Promise<ProjectView | null>;
      startRender(request: RenderRequest): Promise<RenderResult>;
      cancelRender(): Promise<void>;
      onProgress(callback: (progress: RenderProgress) => void): () => void;
    };
  }
}

export {};

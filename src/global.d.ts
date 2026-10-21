import type { MediaInfo, RenderProgress, RenderRequest, RenderResult } from './shared/contracts';

declare global {
  interface Window {
    shortfab?: {
      pickMedia(): Promise<MediaInfo | null>;
      startRender(request: RenderRequest): Promise<RenderResult>;
      cancelRender(): Promise<void>;
      onProgress(callback: (progress: RenderProgress) => void): () => void;
    };
  }
}

export {};

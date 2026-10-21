import { contextBridge, ipcRenderer } from 'electron';
import type { RenderProgress, RenderRequest, RenderResult } from '../src/shared/contracts.js';
import type { ProjectEdits, ProjectSummary, ProjectView } from '../src/shared/projects.js';
import type { BindSourceRequest } from '../src/shared/sources.js';
import type { PublishDraft, PublishJobView, PublishOverview, PublishProgress } from '../src/shared/publishing.js';

contextBridge.exposeInMainWorld('shortfab', {
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  createProject: (): Promise<ProjectView> => ipcRenderer.invoke('project:create'),
  openProject: (id: string): Promise<ProjectView> => ipcRenderer.invoke('project:open', id),
  saveProject: (edits: ProjectEdits): Promise<ProjectView> => ipcRenderer.invoke('project:save', edits),
  pickMedia: (): Promise<ProjectView | null> => ipcRenderer.invoke('project:pickMedia'),
  reconnectMedia: (): Promise<ProjectView | null> => ipcRenderer.invoke('project:reconnectMedia'),
  bindYouTubeMedia: (request: BindSourceRequest): Promise<ProjectView | null> => ipcRenderer.invoke('project:bindYouTube', request),
  startRender: (request: RenderRequest): Promise<RenderResult> => ipcRenderer.invoke('render:start', request),
  cancelRender: (): Promise<void> => ipcRenderer.invoke('render:cancel'),
  publishOverview: (): Promise<PublishOverview> => ipcRenderer.invoke('publish:overview'),
  connectYouTube: (): Promise<PublishOverview> => ipcRenderer.invoke('publish:connect'),
  disconnectYouTube: (): Promise<PublishOverview> => ipcRenderer.invoke('publish:disconnect'),
  startPublish: (draft: PublishDraft): Promise<PublishJobView | null> => ipcRenderer.invoke('publish:start', draft),
  retryPublish: (id: string): Promise<PublishJobView | null> => ipcRenderer.invoke('publish:retry', id),
  refreshPublish: (id: string): Promise<PublishJobView> => ipcRenderer.invoke('publish:refresh', id),
  onPublishProgress: (callback: (progress: PublishProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: PublishProgress) => callback(progress);
    ipcRenderer.on('publish:progress', listener);
    return () => ipcRenderer.removeListener('publish:progress', listener);
  },
  onProgress: (callback: (progress: RenderProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: RenderProgress) => callback(progress);
    ipcRenderer.on('render:progress', listener);
    return () => { ipcRenderer.removeListener('render:progress', listener); };
  },
});

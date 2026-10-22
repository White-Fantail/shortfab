import { contextBridge, ipcRenderer } from 'electron';
import type { RenderProgress, RenderRequest, RenderResult } from '../src/shared/contracts.js';
import type { ProjectEdits, ProjectSummary, ProjectView } from '../src/shared/projects.js';
import type { BindSourceRequest } from '../src/shared/sources.js';
import type { ApprovedCloudSourceRequest } from '../src/shared/cloud.js';
import type { PublishDraft, PublishJobView, PublishOverview, PublishProgress } from '../src/shared/publishing.js';
import type { SttProgress, SttRequest, SttResult, SttStatus } from '../src/shared/stt.js';

contextBridge.exposeInMainWorld('shortfab', {
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  createProject: (): Promise<ProjectView> => ipcRenderer.invoke('project:create'),
  openProject: (id: string): Promise<ProjectView> => ipcRenderer.invoke('project:open', id),
  saveProject: (edits: ProjectEdits): Promise<ProjectView> => ipcRenderer.invoke('project:save', edits),
  pickMedia: (): Promise<ProjectView | null> => ipcRenderer.invoke('project:pickMedia'),
  reconnectMedia: (): Promise<ProjectView | null> => ipcRenderer.invoke('project:reconnectMedia'),
  bindYouTubeMedia: (request: BindSourceRequest): Promise<ProjectView | null> => ipcRenderer.invoke('project:bindYouTube', request),
  bindCloudSource: (request: ApprovedCloudSourceRequest): Promise<ProjectView> => ipcRenderer.invoke('project:bindCloud', request),
  partnerCatalogStatus: (): Promise<{ configured: boolean }> => ipcRenderer.invoke('partner:status'),
  bindPartnerSource: (): Promise<ProjectView> => ipcRenderer.invoke('project:bindPartner'),
  startRender: (request: RenderRequest): Promise<RenderResult> => ipcRenderer.invoke('render:start', request),
  cancelRender: (): Promise<void> => ipcRenderer.invoke('render:cancel'),
  personalToolAvailable: (): Promise<boolean> => ipcRenderer.invoke('personal:status'),
  sttStatus: (): Promise<SttStatus> => ipcRenderer.invoke('stt:status'),
  chooseSttModel: (): Promise<SttStatus> => ipcRenderer.invoke('stt:chooseModel'),
  transcribeClip: (request: SttRequest): Promise<SttResult> => ipcRenderer.invoke('stt:start', request),
  cancelTranscription: (): Promise<void> => ipcRenderer.invoke('stt:cancel'),
  onSttProgress: (callback: (progress: SttProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SttProgress) => callback(progress);
    ipcRenderer.on('stt:progress', listener);
    return () => ipcRenderer.removeListener('stt:progress', listener);
  },
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

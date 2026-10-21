import { contextBridge, ipcRenderer } from 'electron';
import type { RenderProgress, RenderRequest, RenderResult } from '../src/shared/contracts.js';
import type { ProjectEdits, ProjectSummary, ProjectView } from '../src/shared/projects.js';

contextBridge.exposeInMainWorld('shortfab', {
  listProjects: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  createProject: (): Promise<ProjectView> => ipcRenderer.invoke('project:create'),
  openProject: (id: string): Promise<ProjectView> => ipcRenderer.invoke('project:open', id),
  saveProject: (edits: ProjectEdits): Promise<ProjectView> => ipcRenderer.invoke('project:save', edits),
  pickMedia: (): Promise<ProjectView | null> => ipcRenderer.invoke('project:pickMedia'),
  reconnectMedia: (): Promise<ProjectView | null> => ipcRenderer.invoke('project:reconnectMedia'),
  startRender: (request: RenderRequest): Promise<RenderResult> => ipcRenderer.invoke('render:start', request),
  cancelRender: (): Promise<void> => ipcRenderer.invoke('render:cancel'),
  onProgress: (callback: (progress: RenderProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: RenderProgress) => callback(progress);
    ipcRenderer.on('render:progress', listener);
    return () => { ipcRenderer.removeListener('render:progress', listener); };
  },
});

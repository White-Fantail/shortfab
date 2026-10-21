import { contextBridge, ipcRenderer } from 'electron';
import type { MediaInfo, RenderProgress, RenderRequest, RenderResult } from '../src/shared/contracts.js';

contextBridge.exposeInMainWorld('shortfab', {
  pickMedia: (): Promise<MediaInfo | null> => ipcRenderer.invoke('media:pick'),
  startRender: (request: RenderRequest): Promise<RenderResult> => ipcRenderer.invoke('render:start', request),
  cancelRender: (): Promise<void> => ipcRenderer.invoke('render:cancel'),
  onProgress: (callback: (progress: RenderProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: RenderProgress) => callback(progress);
    ipcRenderer.on('render:progress', listener);
    return () => { ipcRenderer.removeListener('render:progress', listener); };
  },
});

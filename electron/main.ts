import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { randomUUID } from 'node:crypto';
import { join, parse } from 'node:path';
import { pathToFileURL } from 'node:url';
import { probeMedia } from './media.js';
import { RenderTask } from './render.js';
import { validateRenderRequest, type MediaInfo, type RenderResult } from '../src/shared/contracts.js';

protocol.registerSchemesAsPrivileged([
  { scheme: 'shortfab-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
let activeSource: { id: string; path: string; info: MediaInfo } | null = null;
let currentTask: RenderTask | null = null;
let renderBusy = false;

function openWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 850,
    minHeight: 620,
    title: 'ShortFab · 숏컷공장',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void mainWindow.loadURL(developmentUrl);
  else void mainWindow.loadFile(join(__dirname, '../../dist/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  protocol.handle('shortfab-media', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'asset' || url.pathname !== '/current' || !activeSource) {
      return new Response('Media not selected', { status: 404 });
    }
    // The renderer never supplies a filesystem path. Only a user-selected file can be served.
    return net.fetch(pathToFileURL(activeSource.path).toString());
  });

  ipcMain.handle('media:pick', async (): Promise<MediaInfo | null> => {
    if (renderBusy) throw new Error('렌더가 끝나면 원본을 교체할 수 있습니다.');
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v'] }],
    };
    const selected = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (selected.canceled || !selected.filePaths[0]) return null;
    const path = selected.filePaths[0];
    const probed = await probeMedia(path);
    const info: MediaInfo = {
      id: randomUUID(),
      ...probed,
      previewUrl: 'shortfab-media://asset/current',
    };
    activeSource = { id: info.id, path, info };
    return info;
  });

  ipcMain.handle('render:start', async (_event, input: unknown): Promise<RenderResult> => {
    if (renderBusy) throw new Error('이미 렌더링 중입니다.');
    if (!activeSource) throw new Error('로컬 원본 영상을 먼저 선택하세요.');
    const request = validateRenderRequest(input, activeSource.info.duration);
    if (request.sourceId !== activeSource.id) throw new Error('원본이 변경되었습니다. 다시 선택하세요.');
    renderBusy = true;
    try {
      const base = parse(activeSource.info.name).name.replace(/[^a-zA-Z0-9가-힣_-]/g, '-');
      const options: SaveDialogOptions = {
        title: 'MP4 내보내기',
        defaultPath: `${base || 'shortfab'}-${Math.floor(request.start)}-${Math.floor(request.end)}.mp4`,
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
        properties: ['showOverwriteConfirmation'],
      };
      const chosen = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);
      if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' };
      currentTask = new RenderTask();
      const path = chosen.filePath.toLowerCase().endsWith('.mp4') ? chosen.filePath : `${chosen.filePath}.mp4`;
      await currentTask.run(activeSource.path, path, request, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('render:progress', progress);
        }
      });
      return { status: 'completed', outputPath: path };
    } finally {
      currentTask = null;
      renderBusy = false;
    }
  });

  ipcMain.handle('render:cancel', () => {
    currentTask?.cancel();
  });

  openWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { currentTask?.cancel(); });

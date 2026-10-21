import { app, BrowserWindow, dialog, ipcMain, net, protocol } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { join, parse } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectStore } from './projects.js';
import { RenderTask } from './render.js';
import { validateRenderRequest, type RenderResult } from '../src/shared/contracts.js';

protocol.registerSchemesAsPrivileged([
  { scheme: 'shortfab-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
const projects = new ProjectStore();
let currentTask: RenderTask | null = null;
let renderBusy = false;

function requireIdle(): void {
  if (renderBusy) throw new Error('렌더링이 끝나면 프로젝트나 원본을 변경할 수 있습니다.');
}

function openWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280, height: 860, minWidth: 850, minHeight: 620,
    title: 'ShortFab · 숏컷공장',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true,
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
    const active = projects.activeSource;
    if (url.hostname !== 'asset' || url.pathname !== '/current' || !active) {
      return new Response('Media not selected', { status: 404 });
    }
    // Filesystem paths only exist inside the main process and the project store.
    return net.fetch(pathToFileURL(active.path).toString());
  });

  ipcMain.handle('project:list', () => projects.list());
  ipcMain.handle('project:create', () => { requireIdle(); return projects.create(); });
  ipcMain.handle('project:open', (_event, id: string) => {
    requireIdle(); return projects.open(id);
  });
  ipcMain.handle('project:save', (_event, edits: unknown) => {
    requireIdle(); return projects.save(edits);
  });

  async function pickFile(): Promise<string | null> {
    const options: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4v'] }],
    };
    const selected = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return selected.canceled ? null : selected.filePaths[0] ?? null;
  }

  ipcMain.handle('project:pickMedia', async () => {
    requireIdle();
    const file = await pickFile();
    if (!file) return null;
    requireIdle();
    return projects.attachMedia(file, false);
  });
  ipcMain.handle('project:reconnectMedia', async () => {
    requireIdle();
    const file = await pickFile();
    if (!file) return null;
    requireIdle();
    return projects.attachMedia(file, true);
  });

  ipcMain.handle('render:start', async (_event, input: unknown): Promise<RenderResult> => {
    if (renderBusy) throw new Error('이미 렌더링 중입니다.');
    const source = projects.activeSource;
    if (!source) throw new Error('로컬 원본 영상을 먼저 연결하거나 재연결하세요.');
    const request = validateRenderRequest(input, source.info.duration);
    if (request.sourceId !== source.id) throw new Error('원본이 변경되었습니다. 다시 선택하세요.');
    renderBusy = true;
    try {
      const base = parse(source.info.name).name.replace(/[^a-zA-Z0-9가-힣_-]/g, '-');
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
      await currentTask.run(source.path, path, request, (progress) => {
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

  ipcMain.handle('render:cancel', () => { currentTask?.cancel(); });

  openWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { currentTask?.cancel(); });

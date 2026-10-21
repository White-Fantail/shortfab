import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import { join, parse } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectStore } from './projects.js';
import { RenderTask } from './render.js';
import { YouTubePublisher } from './youtube.js';
import { validateRenderRequest, type RenderResult } from '../src/shared/contracts.js';
import { validatePublishDraft } from '../src/shared/publishing.js';

protocol.registerSchemesAsPrivileged([
  { scheme: 'shortfab-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

let mainWindow: BrowserWindow | null = null;
const projects = new ProjectStore();
let currentTask: RenderTask | null = null;
let renderBusy = false;
const publisher = new YouTubePublisher((job) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('publish:progress', { job });
});

function requireIdle(): void {
  if (renderBusy || publisher.isBusy) throw new Error('진행 중인 렌더 또는 게시 작업이 끝나면 프로젝트를 변경할 수 있습니다.');
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
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' && target.hostname === 'www.youtube.com' &&
        target.pathname === '/watch' && /^[\w-]{11}$/.test(target.searchParams.get('v') ?? '')) {
        void shell.openExternal(target.origin + target.pathname + '?v=' + target.searchParams.get('v'));
      }
    } catch { /* Invalid or unexpected URL is blocked. */ }
    return { action: 'deny' };
  });
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
  ipcMain.handle('project:bindYouTube', async (_event, grant: unknown) => {
    requireIdle();
    const file = await pickFile();
    if (!file) return null;
    requireIdle();
    return projects.bindYouTubeMedia(file, grant);
  });
  ipcMain.handle('project:reconnectMedia', async () => {
    requireIdle();
    const file = await pickFile();
    if (!file) return null;
    requireIdle();
    return projects.attachMedia(file, true);
  });

  ipcMain.handle('publish:overview', () => publisher.overview());
  ipcMain.handle('publish:connect', () => { requireIdle(); return publisher.connect(); });
  ipcMain.handle('publish:disconnect', async () => {
    requireIdle();
    const choice = await dialog.showMessageBox({
      type: 'warning', title: 'YouTube 연결 해제',
      message: 'ShortFab에서 YouTube 권한을 해제하시겠습니까?',
      detail: '업로드 기록은 남습니다. Google 계정의 앱 액세스도 확인해 주세요.',
      buttons: ['취소', '연결 해제'], defaultId: 0, cancelId: 0, noLink: true,
    });
    return choice.response === 1 ? publisher.disconnect() : publisher.overview();
  });
  ipcMain.handle('publish:start', async (_event, metadata: unknown) => {
    requireIdle();
    const projectId = projects.activeProjectId;
    if (!projectId) throw new Error('프로젝트를 먼저 여세요.');
    const proposed = validatePublishDraft(metadata);
    await projects.assertYouTubePublishAllowed();
    const overview = await publisher.overview();
    const artifact = overview.artifact;
    if (!artifact || artifact.projectId !== projectId) {
      throw new Error('게시할 수 있는 MP4를 먼저 익스포트해 주세요.');
    }
    const visibility = { private: '비공개', unlisted: '일부 공개', public: '전체 공개' }[proposed.privacyStatus];
    // Approval is in the privileged main process, not an implicit side effect of export.
    const choice = await dialog.showMessageBox({
      type: 'question', title: 'YouTube 업로드 최종 승인',
      message: '현재 MP4를 연결된 YouTube 계정으로 업로드할까요?',
      detail: '파일: ' + artifact.filename + '\n제목: ' + proposed.title +
        '\n공개 범위: ' + visibility +
        '\n아동용: ' + (proposed.madeForKids ? '예' : '아니오') +
        '\n승인하면 Google 서버에 영상 파일이 전송됩니다.',
      buttons: ['취소', '업로드 승인'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (choice.response !== 1) return null;
    return publisher.start(proposed, projectId, projects.activeClip,
      projects.selectedClipSource === 'youtube' ? projects.youtubeBinding?.sourceAssetId ?? null : null);
  });
  ipcMain.handle('publish:retry', async (_event, id: string) => {
    requireIdle();
    const projectId = projects.activeProjectId;
    if (!projectId) throw new Error('프로젝트를 먼저 여세요.');
    const choice = await dialog.showMessageBox({
      type: 'warning', title: '기존 업로드 이어서 진행',
      message: '기존 YouTube 업로드 세션을 확인하고 이어서 전송할까요?',
      detail: '새 영상을 중복 생성하지 않고, 이전 업로드 세션을 재사용합니다.',
      buttons: ['취소', '재시도 승인'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (choice.response !== 1) return null;
    return publisher.retry(id, projectId);
  });
  ipcMain.handle('publish:refresh', (_event, id: string) => {
    const projectId = projects.activeProjectId;
    if (!projectId) throw new Error('프로젝트를 먼저 여세요.');
    return publisher.refresh(id, projectId);
  });

  ipcMain.handle('render:start', async (_event, input: unknown): Promise<RenderResult> => {
    if (renderBusy || publisher.isBusy) throw new Error('이미 렌더링 또는 게시 작업 중입니다.');
    renderBusy = true; // Lock before checksum verification, which awaits filesystem I/O.
    try {
    const activeClip = projects.activeClip;
    const projectId = projects.activeProjectId;
    if (!activeClip || !projectId) throw new Error('익스포트할 클립을 선택해 주세요.');
    const youtube = activeClip.source === 'youtube'
      ? await projects.renderableYouTubeSource() : null;
    const local = activeClip.source === 'local' ? projects.activeSource : null;
    if (!youtube && !local) throw new Error('렌더에 사용할 원본 파일이 없습니다.');
    const source = youtube ? {
      id: youtube.id, path: youtube.path, name: projects.youtubeBinding?.fileName ?? 'youtube-source.mp4',
      duration: youtube.duration,
    } : { id: local!.id, path: local!.path, name: local!.info.name, duration: local!.info.duration };
    const request = validateRenderRequest(input, source.duration);
    const offset = youtube?.offset ?? 0;
    if (request.sourceId !== source.id ||
      Math.abs(request.start - (activeClip.start + offset)) > 0.0001 ||
      Math.abs(request.end - (activeClip.end + offset)) > 0.0001 ||
      activeClip.width !== request.width) {
      throw new Error('저장된 선택 클립과 렌더 요청이 일치하지 않습니다.');
    }
      const base = parse(source.name).name.replace(/[^a-zA-Z0-9가-힣_-]/g, '-');
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
      if (youtube) await projects.renderableYouTubeSource(); // Recheck after save dialog.
      currentTask = new RenderTask();
      const path = chosen.filePath.toLowerCase().endsWith('.mp4') ? chosen.filePath : `${chosen.filePath}.mp4`;
      await currentTask.run(source.path, path, request, (progress) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('render:progress', progress);
        }
      });
      await publisher.recordRender(path, projectId, activeClip.id, activeClip.start, activeClip.end,
        activeClip.width, youtube?.id ?? null);
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

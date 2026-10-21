import { useEffect, useRef, useState } from 'react';
import { youtubeVideoId, type RenderProgress } from './shared/contracts';
import type { ProjectClip, ProjectEdits, ProjectSummary, ProjectView } from './shared/projects';

type SourceTab = 'local' | 'youtube';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00';
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function editorData(view: ProjectView): ProjectEdits {
  return {
    id: view.id, revision: view.revision, title: view.title,
    youtubeUrl: view.youtubeUrl, clips: view.clips,
    selectedClipId: view.selectedClipId,
  };
}

function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<ProjectView | null>(null);
  const [draft, setDraft] = useState<ProjectEdits | null>(null);
  const [sourceTab, setSourceTab] = useState<SourceTab>('local');
  const [playhead, setPlayhead] = useState(0);
  const [progress, setProgress] = useState<RenderProgress>({ percent: 0, seconds: 0 });
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('프로젝트를 불러오는 중입니다.');
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const projectRef = useRef<ProjectView | null>(null);
  const draftRef = useRef<ProjectEdits | null>(null);
  const dirtyRef = useRef(false);
  const editVersion = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const clip = draft?.clips.find((item) => item.id === draft.selectedClipId);
  const media = project?.media ?? null;
  const youtubeId = youtubeVideoId(draft?.youtubeUrl ?? '');
  const sourceConnected = project?.sourceStatus === 'connected';
  const validClip = Boolean(media && clip &&
    Number.isFinite(clip.start) && Number.isFinite(clip.end) &&
    clip.start >= 0 && clip.end > clip.start + 0.199 && clip.end <= media.duration + 0.02);
  const canRender = validClip && sourceConnected && sourceTab === 'local' && !rendering && !busy;

  function applyView(view: ProjectView) {
    const edits = editorData(view);
    projectRef.current = view;
    draftRef.current = edits;
    dirtyRef.current = false;
    editVersion.current += 1;
    setProject(view);
    setDraft(edits);
    setDirty(false);
    setPlayhead(view.clips.find((c) => c.id === view.selectedClipId)?.start ?? 0);
    setProgress({ percent: 0, seconds: 0 });
    setStatus(`프로젝트: ${view.title} · ${view.clips.length}개 클립`);
    setError('');
  }

  async function refreshProjects() {
    if (window.shortfab) setProjects(await window.shortfab.listProjects());
  }

  useEffect(() => {
    let live = true;
    const unsubscribe = window.shortfab?.onProgress((value) => {
      if (live) setProgress(value);
    });
    if (!window.shortfab) {
      setError('프로젝트 저장과 렌더는 Electron 데스크톱 앱에서만 실행됩니다. npm run dev를 사용하세요.');
    } else {
      void (async () => {
        try {
          const list = await window.shortfab!.listProjects();
          const view = list.length
            ? await window.shortfab!.openProject(list[0].id)
            : await window.shortfab!.createProject();
          if (!live) return;
          applyView(view);
          await refreshProjects();
        } catch (cause) {
          if (live) setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    }
    return () => { live = false; unsubscribe?.(); };
  }, []);

  function changeDraft(update: (current: ProjectEdits) => ProjectEdits) {
    const old = draftRef.current;
    if (!old) return;
    const next = update(old);
    draftRef.current = next;
    dirtyRef.current = true;
    editVersion.current += 1;
    setDraft(next);
    setDirty(true);
  }

  function queueSave(snapshot: ProjectEdits, version: number): Promise<void> {
    if (!window.shortfab) return Promise.resolve();
    const task = saveQueue.current.then(async () => {
      const active = projectRef.current;
      if (!active || active.id !== snapshot.id) return;
      const updated = await window.shortfab!.saveProject({ ...snapshot, revision: active.revision });
      if (projectRef.current?.id !== updated.id) return;
      projectRef.current = updated;
      setProject(updated);
      setProjects((items) => items.map((item) => item.id === updated.id ? {
        ...item, title: updated.title, updatedAt: updated.updatedAt,
        clipCount: updated.clips.length, sourceName: updated.sourceName,
      } : item));
      if (editVersion.current === version) {
        dirtyRef.current = false;
        setDirty(false);
      }
    });
    saveQueue.current = task.catch(() => {});
    return task;
  }

  useEffect(() => {
    if (!dirty || !draft || busy || rendering) return;
    const timer = setTimeout(() => {
      void queueSave(draft, editVersion.current).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    }, 650);
    return () => clearTimeout(timer);
  }, [draft, dirty, busy, rendering]);

  async function flushEdits() {
    if (dirtyRef.current && draftRef.current) {
      await queueSave(draftRef.current, editVersion.current);
    } else {
      await saveQueue.current;
    }
  }

  async function openProject(id: string) {
    if (!window.shortfab || busy || rendering || projectRef.current?.id === id) return;
    setBusy(true);
    try {
      await flushEdits();
      const opened = await window.shortfab.openProject(id);
      applyView(opened);
      setSourceTab('local');
      await refreshProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function newProject() {
    if (!window.shortfab || busy || rendering) return;
    setBusy(true);
    try {
      await flushEdits();
      const created = await window.shortfab.createProject();
      applyView(created);
      setSourceTab('local');
      await refreshProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function chooseMedia(reconnect: boolean) {
    if (!window.shortfab || busy || rendering) return;
    setBusy(true);
    setError('');
    try {
      await flushEdits();
      const updated = reconnect
        ? await window.shortfab.reconnectMedia()
        : await window.shortfab.pickMedia();
      if (!updated) return;
      applyView(updated);
      setSourceTab('local');
      await refreshProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function updateClip(patch: Partial<ProjectClip>) {
    changeDraft((current) => ({
      ...current,
      clips: current.clips.map((candidate) =>
        candidate.id === current.selectedClipId ? { ...candidate, ...patch } : candidate),
    }));
  }

  function addClip() {
    if (!media || !draft || busy || rendering) return;
    const from = clip && clip.end + 0.2 <= media.duration ? clip.end : clip?.start ?? 0;
    const to = Math.min(media.duration, from + 30);
    if (to - from < 0.2 || draft.clips.length >= 100) return;
    const newClip: ProjectClip = {
      id: crypto.randomUUID(), title: `클립 ${draft.clips.length + 1}`,
      start: from, end: to, width: clip?.width ?? 720,
    };
    changeDraft((current) => ({
      ...current, clips: [...current.clips, newClip], selectedClipId: newClip.id,
    }));
    setPlayhead(from);
  }

  function removeClip() {
    if (!clip || busy || rendering) return;
    changeDraft((current) => {
      const remaining = current.clips.filter((item) => item.id !== current.selectedClipId);
      return {
        ...current, clips: remaining,
        selectedClipId: remaining[0]?.id ?? null,
      };
    });
  }

  function moveTo(time: number) {
    if (!media) return;
    const clamped = Math.min(media.duration, Math.max(0, time));
    setPlayhead(clamped);
    if (videoRef.current) videoRef.current.currentTime = clamped;
  }

  async function playClip() {
    const video = videoRef.current;
    if (!video || !clip) return;
    video.currentTime = clip.start;
    try { await video.play(); }
    catch { setError('미리보기를 재생할 수 없습니다. 원본 코덱을 확인하세요.'); }
  }

  async function renderClip() {
    if (!canRender || !media || !clip || !window.shortfab) return;
    setError('');
    setRendering(true);
    setProgress({ percent: 0, seconds: 0 });
    setStatus('MP4 출력 위치를 선택해 주세요.');
    try {
      await flushEdits();
      const result = await window.shortfab.startRender({
        sourceId: media.id, start: clip.start, end: clip.end, width: clip.width,
      });
      setStatus(result.status === 'completed' ? `완료: ${result.outputPath}` : '내보내기가 취소되었습니다.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes('취소')) setStatus('렌더가 취소되었습니다.');
      else { setError(message); setStatus('렌더에 실패했습니다.'); }
    } finally {
      setRendering(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S/</span><div><strong>ShortFab</strong><small>숏컷공장 · Phase 1</small></div></div>
        <span className="stage-label">LOCAL FIRST · PROJECT LIBRARY</span>
      </header>

      <div className="project-bar">
        <label htmlFor="project-selector">프로젝트</label>
        <select id="project-selector" value={project?.id ?? ''} disabled={busy || rendering || !project}
          onChange={(event) => void openProject(event.target.value)}>
          {!project && <option value="">불러오는 중…</option>}
          {projects.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.clipCount} clips</option>)}
        </select>
        <button disabled={busy || rendering || !project} onClick={() => void newProject()}>+ 새 프로젝트</button>
        <span className="save-indicator" aria-live="polite">{dirty ? '변경 중 · 자동 저장' : '저장됨'}</span>
      </div>

      <div className="workspace">
        <aside className="sidebar">
          <p className="eyebrow">01 — PROJECT / SOURCE</p>
          <h2>영상 가져오기</h2>
          <label htmlFor="project-title">프로젝트 이름</label>
          <input id="project-title" value={draft?.title ?? ''} disabled={!draft || busy || rendering}
            onChange={(event) => changeDraft((current) => ({ ...current, title: event.target.value }))} />
          <div className="tab-group source-tabs">
            <button className={sourceTab === 'local' ? 'active' : ''} onClick={() => setSourceTab('local')}>로컬 원본</button>
            <button className={sourceTab === 'youtube' ? 'active' : ''} onClick={() => setSourceTab('youtube')}>YouTube 탐색</button>
          </div>
          {sourceTab === 'local' ? (
            <section className="pane">
              <button className="primary full" disabled={busy || rendering || !project} onClick={() => void chooseMedia(false)}>
                {media ? '다른 원본으로 교체 (클립 초기화)' : '영상 파일 선택'}
              </button>
              <p className="hint">MP4 · MOV · MKV · WEBM · M4V</p>
              {media && <div className="source-details">
                <strong>{media.name}</strong>
                <span>{media.width} × {media.height} · {formatTime(media.duration)}</span>
                <span>{media.hasAudio ? '오디오 포함' : '오디오 없음'}</span>
                <span>{sourceConnected ? '● 연결됨' : '● 원본을 찾을 수 없음'}</span>
              </div>}
              {project?.sourceStatus === 'missing' &&
                <button className="full secondary" disabled={busy || rendering} onClick={() => void chooseMedia(true)}>원본 파일 재연결</button>}
            </section>
          ) : (
            <section className="pane">
              <label htmlFor="youtube-url">YouTube URL (탐색 전용)</label>
              <input id="youtube-url" value={draft?.youtubeUrl ?? ''} disabled={!draft || busy || rendering}
                onChange={(event) => changeDraft((current) => ({ ...current, youtubeUrl: event.target.value }))}
                placeholder="https://youtu.be/…" />
              <p className="hint">공식 임베드만 사용합니다. URL만으로 렌더할 수 없으며, 실제 영상 파일은 별도로 연결해야 합니다.</p>
              {draft?.youtubeUrl && !youtubeId && <p className="warning">올바른 YouTube 링크를 입력해 주세요.</p>}
            </section>
          )}

          <div className="section-rule" />
          <p className="eyebrow">02 — CLIP LIBRARY</p>
          <h2>클립 후보</h2>
          <div className="clip-choices">
            {draft?.clips.map((item) => <button key={item.id}
              className={draft.selectedClipId === item.id ? 'clip-choice selected' : 'clip-choice'}
              disabled={busy || rendering}
              onClick={() => { changeDraft((current) => ({ ...current, selectedClipId: item.id })); moveTo(item.start); }}>
              <strong>{item.title}</strong><small>{formatTime(item.start)}–{formatTime(item.end)}</small>
            </button>)}
            {!draft?.clips.length && <p className="hint">원본을 연결하면 첫 클립이 생성됩니다.</p>}
          </div>
          <div className="clip-actions">
            <button disabled={!sourceConnected || busy || rendering || !media || (draft?.clips.length ?? 0) >= 100} onClick={addClip}>+ 후보 추가</button>
            <button disabled={!clip || busy || rendering} onClick={removeClip}>선택 삭제</button>
          </div>

          {clip && <>
            <label htmlFor="clip-title">클립 이름</label>
            <input id="clip-title" value={clip.title} disabled={busy || rendering}
              onChange={(event) => updateClip({ title: event.target.value })} />
            <div className="marker-grid clip-markers">
              <label>IN (초)<input type="number" min="0" step="0.1" value={clip.start} disabled={busy || rendering}
                onChange={(event) => updateClip({ start: Number(event.target.value) })} /></label>
              <label>OUT (초)<input type="number" min="0" step="0.1" value={clip.end} disabled={busy || rendering}
                onChange={(event) => updateClip({ end: Number(event.target.value) })} /></label>
            </div>
            <div className="marker-actions">
              <button disabled={!sourceConnected || busy || rendering} onClick={() => updateClip({ start: Math.min(playhead, clip.end) })}>현재 시각 → IN</button>
              <button disabled={!sourceConnected || busy || rendering} onClick={() => updateClip({ end: Math.max(playhead, clip.start) })}>현재 시각 → OUT</button>
            </div>
            <div className="duration"><span>선택 구간</span><strong>{formatTime(clip.end - clip.start)}</strong></div>
            <button className="secondary full" disabled={!validClip || !sourceConnected || busy || rendering || sourceTab !== 'local'}
              onClick={() => void playClip()}>▶ 선택 구간 재생</button>
            {!validClip && <p className="warning">유효한 IN/OUT 구간을 지정해 주세요.</p>}
          </>}
          <div className="section-rule" />
          <p className="eyebrow">03 — OUTPUT</p>
          <h2>세로 화면</h2>
          <div className="resolution">
            {([720, 1080] as const).map((width) =>
              <button key={width} className={clip?.width === width ? 'selected' : ''}
                disabled={!clip || busy || rendering} onClick={() => updateClip({ width })}>
                {width}p <small>{width === 720 ? '빠른 테스트' : 'Full HD'}</small>
              </button>)}
          </div>
          <p className="hint">클립마다 해상도를 저장합니다. 중앙 크롭 · 9:16 · 30 fps</p>
        </aside>

        <main className="preview-area">
          <div className="preview-heading"><div><p className="eyebrow">CANVAS PREVIEW</p><h2>출력 프레임 미리보기</h2></div><span>9:16</span></div>
          <div className="preview-stage">
            <div className="portrait">
              {sourceTab === 'youtube' && youtubeId ? (
                <iframe title="YouTube official player" src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
                  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              ) : media && sourceTab === 'local' && sourceConnected ? (
                <video key={`${project?.id}-${media.id}-${media.previewUrl}`} ref={videoRef}
                  src={media.previewUrl} controls playsInline preload="metadata"
                  onTimeUpdate={(event) => {
                    const current = event.currentTarget;
                    setPlayhead(current.currentTime);
                    if (!current.paused && clip && current.currentTime >= clip.end) current.pause();
                  }} />
              ) : (
                <div className="empty-preview"><span className="film-symbol">▣</span>
                  <strong>YOUR SHORT STARTS HERE</strong>
                  <small>{project?.sourceStatus === 'missing' ? '원본을 재연결해 주세요' : '로컬 영상을 선택하세요'}</small>
                </div>
              )}
            </div>
          </div>
          <div className="timeline">
            <div className="timeline-top"><span>원본 타임라인</span><span>{media ? formatTime(media.duration) : '00:00'}</span></div>
            <input aria-label="영상 위치" type="range" min="0" max={media?.duration ?? 30} step="0.1"
              disabled={!sourceConnected || sourceTab !== 'local'} value={playhead}
              onChange={(event) => moveTo(Number(event.target.value))} />
            <div className="timeline-markers">
              <span>IN {formatTime(clip?.start ?? 0)}</span><span>OUT {formatTime(clip?.end ?? 0)}</span>
            </div>
          </div>
        </main>

        <aside className="export-panel">
          <p className="eyebrow">04 — EXPORT</p>
          <h2>MP4 내보내기</h2>
          <div className="export-spec"><span>형식</span><strong>MP4</strong></div>
          <div className="export-spec"><span>선택 클립</span><strong>{clip?.title ?? '없음'}</strong></div>
          <div className="export-spec"><span>해상도</span><strong>{clip ? `${clip.width} × ${clip.width * 16 / 9}` : '—'}</strong></div>
          <div className="export-spec"><span>프레임</span><strong>30 FPS</strong></div>
          <div className="export-spec"><span>클립 길이</span><strong>{formatTime(clip ? clip.end - clip.start : 0)}</strong></div>
          <button className="primary full export-button" disabled={!canRender} onClick={() => void renderClip()}>
            {rendering ? '렌더링 중…' : '선택 클립 MP4 익스포트'}
          </button>
          {rendering && <button className="cancel full" onClick={() => void window.shortfab?.cancelRender()}>렌더 취소</button>}
          <div className="progress-area"><div className="progress-head"><span>진행 상태</span><strong>{progress.percent}%</strong></div>
            <div className="progress-track"><div style={{ width: `${progress.percent}%` }} /></div></div>
          <p className="status" aria-live="polite">{status}</p>
          {error && <p role="alert" className="error">{error}</p>}
          <div className="coming-next"><strong>Phase 1 계속 진행</strong>
            <p>클립 후보와 프로젝트 저장/복원을 먼저 구현했습니다. 다음은 선언형 스타일, 자막 편집, 나레이션, CTA를 렌더 파이프라인에 연결합니다.</p></div>
        </aside>
      </div>
    </div>
  );
}

export default App;

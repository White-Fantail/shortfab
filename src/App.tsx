import { useEffect, useRef, useState } from 'react';
import { youtubeVideoId, type MediaInfo, type OutputWidth, type RenderProgress } from './shared/contracts';

type SourceTab = 'local' | 'youtube';

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00';
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function App() {
  const [sourceTab, setSourceTab] = useState<SourceTab>('local');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const youtubeId = youtubeVideoId(youtubeUrl.trim());
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(30);
  const [width, setWidth] = useState<OutputWidth>(720);
  const [progress, setProgress] = useState<RenderProgress>({ percent: 0, seconds: 0 });
  const [rendering, setRendering] = useState(false);
  const [status, setStatus] = useState('로컬 원본을 연결하면 편집을 시작할 수 있습니다.');
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    return window.shortfab?.onProgress((value) => setProgress(value));
  }, []);

  async function pickMedia() {
    setError('');
    if (!window.shortfab) {
      setError('파일 선택과 렌더는 Electron 데스크톱 앱에서만 동작합니다. npm run dev로 실행하세요.');
      return;
    }
    try {
      const selected = await window.shortfab.pickMedia();
      if (!selected) return;
      setMedia(selected);
      setSourceTab('local');
      setStart(0);
      setEnd(Math.min(30, selected.duration));
      setProgress({ percent: 0, seconds: 0 });
      setStatus(`${selected.name} · ${formatTime(selected.duration)} · ${selected.width}×${selected.height}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function moveTo(time: number) {
    if (!media) return;
    const clamped = Math.min(media.duration, Math.max(0, time));
    if (videoRef.current) videoRef.current.currentTime = clamped;
  }

  async function playClip() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = start;
    try {
      await video.play();
    } catch {
      setError('미리보기를 재생할 수 없습니다. 원본 코덱을 확인하세요.');
    }
  }

  async function renderClip() {
    if (!media || !window.shortfab || rendering) return;
    setError('');
    setRendering(true);
    setProgress({ percent: 0, seconds: 0 });
    setStatus('MP4 출력 위치를 선택해 주세요.');
    try {
      const result = await window.shortfab.startRender({ sourceId: media.id, start, end, width });
      if (result.status === 'completed') setStatus(`완료: ${result.outputPath}`);
      else setStatus('내보내기가 취소되었습니다.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes('취소')) setStatus('렌더가 취소되었습니다.');
      else {
        setError(message);
        setStatus('렌더에 실패했습니다. 원본 및 FFmpeg 설치를 확인하세요.');
      }
    } finally {
      setRendering(false);
    }
  }

  const validClip = Boolean(media && Number.isFinite(start) && Number.isFinite(end) &&
    start >= 0 && end > start + 0.199 && end <= media.duration + 0.02);
  const canRender = validClip && !rendering;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">S/</span><div><strong>ShortFab</strong><small>숏컷공장 · Phase 0</small></div></div>
        <span className="stage-label">LOCAL FIRST · 9:16 MP4</span>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <p className="eyebrow">01 — SOURCE</p>
          <h2>영상 가져오기</h2>
          <div className="tab-group">
            <button className={sourceTab === 'local' ? 'active' : ''} onClick={() => setSourceTab('local')}>로컬 파일</button>
            <button className={sourceTab === 'youtube' ? 'active' : ''} onClick={() => setSourceTab('youtube')}>YouTube 탐색</button>
          </div>
          {sourceTab === 'local' ? (
            <section className="pane">
              <button className="primary full" disabled={rendering} onClick={() => void pickMedia()}>
                {media ? '다른 영상 선택' : '영상 파일 선택'}
              </button>
              <p className="hint">MP4 · MOV · MKV · WEBM · M4V</p>
              {media && <div className="source-details"><strong>{media.name}</strong><span>{media.width} × {media.height} · {formatTime(media.duration)}</span><span>{media.hasAudio ? '오디오 포함' : '오디오 없음'}</span></div>}
            </section>
          ) : (
            <section className="pane">
              <label htmlFor="youtube-url">YouTube URL</label>
              <input id="youtube-url" value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder="https://youtu.be/…" />
              <p className="hint">공식 임베드로만 탐색합니다. URL만으로 영상을 다운로드하거나 렌더하지 않습니다. 내보내려면 별도 로컬 원본을 선택하세요.</p>
              {youtubeUrl && !youtubeId && <p className="warning">올바른 YouTube 링크를 입력해 주세요.</p>}
            </section>
          )}

          <div className="section-rule" />
          <p className="eyebrow">02 — FIND THE MOMENT</p>
          <h2>클립 범위</h2>
          <div className="marker-grid">
            <label>IN (초)<input type="number" min="0" step="0.1" value={start} disabled={!media || rendering}
              onChange={(event) => setStart(Number(event.target.value))} /></label>
            <label>OUT (초)<input type="number" min="0" step="0.1" value={end} disabled={!media || rendering}
              onChange={(event) => setEnd(Number(event.target.value))} /></label>
          </div>
          <div className="marker-actions">
            <button disabled={!media || rendering} onClick={() => setStart(Math.min(videoRef.current?.currentTime ?? 0, end))}>현재 시각 → IN</button>
            <button disabled={!media || rendering} onClick={() => setEnd(Math.max(videoRef.current?.currentTime ?? 0, start))}>현재 시각 → OUT</button>
          </div>
          <div className="duration"><span>선택 구간</span><strong>{formatTime(end - start)}</strong></div>
          <button className="secondary full" disabled={!validClip || rendering} onClick={() => void playClip()}>▶ 선택 구간 재생</button>
          {!validClip && media && <p className="warning">OUT은 IN보다 뒤에 있어야 하며 원본 길이를 넘을 수 없습니다.</p>}

          <div className="section-rule" />
          <p className="eyebrow">03 — OUTPUT</p>
          <h2>세로 화면</h2>
          <div className="resolution">
            <button className={width === 720 ? 'selected' : ''} disabled={rendering} onClick={() => setWidth(720)}>720p <small>빠른 테스트</small></button>
            <button className={width === 1080 ? 'selected' : ''} disabled={rendering} onClick={() => setWidth(1080)}>1080p <small>Full HD</small></button>
          </div>
          <p className="hint">중앙 기준 자동 크롭 · 9:16 · 30 fps · H.264/AAC</p>
        </aside>

        <main className="preview-area">
          <div className="preview-heading"><div><p className="eyebrow">CANVAS PREVIEW</p><h2>출력 프레임 미리보기</h2></div><span>9:16</span></div>
          <div className="preview-stage">
            <div className="portrait">
              {sourceTab === 'youtube' && youtubeId ? (
                <iframe title="YouTube official player" src={`https://www.youtube-nocookie.com/embed/${youtubeId}`}
                  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
              ) : media && sourceTab === 'local' ? (
                <video key={media.id} ref={videoRef} src={media.previewUrl} controls playsInline preload="metadata"
                  onTimeUpdate={(event) => {
                    const current = event.currentTarget;
                    if (!current.paused && current.currentTime >= end) current.pause();
                  }} />
              ) : (
                <div className="empty-preview"><span className="film-symbol">▣</span><strong>YOUR SHORT STARTS HERE</strong><small>로컬 영상을 선택하세요</small></div>
              )}
            </div>
          </div>
          <div className="timeline">
            <div className="timeline-top"><span>원본 타임라인</span><span>{media ? formatTime(media.duration) : '00:00'}</span></div>
            <input aria-label="영상 위치" type="range" min="0" max={media?.duration ?? 30} step="0.1"
              disabled={!media || sourceTab !== 'local'} defaultValue={0} key={media?.id ?? 'empty'}
              onChange={(event) => moveTo(Number(event.target.value))} />
            <div className="timeline-markers"><span>IN {formatTime(start)}</span><span>OUT {formatTime(end)}</span></div>
          </div>
        </main>

        <aside className="export-panel">
          <p className="eyebrow">04 — EXPORT</p>
          <h2>MP4 내보내기</h2>
          <div className="export-spec"><span>형식</span><strong>MP4</strong></div>
          <div className="export-spec"><span>해상도</span><strong>{width} × {width * 16 / 9}</strong></div>
          <div className="export-spec"><span>프레임</span><strong>30 FPS</strong></div>
          <div className="export-spec"><span>클립 길이</span><strong>{formatTime(end - start)}</strong></div>
          <button className="primary full export-button" disabled={!canRender} onClick={() => void renderClip()}>
            {rendering ? '렌더링 중…' : 'MP4 익스포트'}
          </button>
          {rendering && <button className="cancel full" onClick={() => void window.shortfab?.cancelRender()}>렌더 취소</button>}
          <div className="progress-area"><div className="progress-head"><span>진행 상태</span><strong>{progress.percent}%</strong></div>
            <div className="progress-track"><div style={{ width: `${progress.percent}%` }} /></div></div>
          <p className="status" aria-live="polite">{status}</p>
          {error && <p role="alert" className="error">{error}</p>}
          <div className="coming-next"><strong>다음 단계</strong><p>프로젝트 저장, 스타일·자막·나레이션, CTA, YouTube 구간 마커는 로드맵에 따라 순차 구현됩니다.</p></div>
        </aside>
      </div>
    </div>
  );
}

export default App;

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

interface Player {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  getDuration(): number;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}
interface PlayerAPI {
  Player: new (element: HTMLElement, options: {
    videoId: string;
    width: string;
    height: string;
    playerVars: Record<string, number>;
    events: {
      onReady: () => void;
      onError: (event: { data: number }) => void;
    };
  }) => Player;
}
declare global {
  interface Window {
    YT?: PlayerAPI;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<PlayerAPI> | null = null;

/** The official API controls the embed; no stream URL or video bytes are accessed. */
function loadAPI(): Promise<PlayerAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      if (error) {
        apiPromise = null;
        reject(error);
      } else if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        apiPromise = null;
        reject(new Error('YouTube 공식 플레이어를 로드하지 못했습니다.'));
      }
    };
    const timeout = setTimeout(() => finish(new Error('YouTube 플레이어 연결 시간이 초과되었습니다.')), 15000);
    window.onYouTubeIframeAPIReady = () => finish();
    script.onerror = () => finish(new Error('YouTube 연결에 실패했습니다. 네트워크를 확인하세요.'));
    document.head.appendChild(script);
  });
  return apiPromise;
}

export interface YouTubeControls {
  seek(time: number): void;
  play(): void;
  pause(): void;
}
interface Props {
  videoId: string;
  start: number | null;
  end: number | null;
  loop: boolean;
  onTime: (time: number) => void;
  onDuration: (videoId: string, seconds: number) => void;
}

export const YouTubePreview = forwardRef<YouTubeControls, Props>(function YouTubePreview(
  { videoId, start, end, loop, onTime, onDuration }, ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const latest = useRef({ start, end, loop, onTime, onDuration });
  const [error, setError] = useState('');
  latest.current = { start, end, loop, onTime, onDuration };

  useImperativeHandle(ref, () => ({
    seek(time) {
      player.current?.seekTo(time, true);
      latest.current.onTime(time);
    },
    play() { player.current?.playVideo(); },
    pause() { player.current?.pauseVideo(); },
  }), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let instance: Player | null = null;
    setError('');
    loadAPI().then((YT) => {
      if (cancelled || !host.current) return;
      instance = new YT.Player(host.current, {
        videoId, width: '100%', height: '100%',
        playerVars: { playsinline: 1, controls: 1, rel: 0 },
        events: {
          onReady: () => {
            if (cancelled || !instance) return;
            player.current = instance;
            timer = setInterval(() => {
              if (!instance || cancelled) return;
              const duration = instance.getDuration();
              if (Number.isFinite(duration) && duration > 0) {
                latest.current.onDuration(videoId, duration);
              }
              const time = instance.getCurrentTime();
              if (!Number.isFinite(time)) return;
              const { start: from, end: to, loop: repeats } = latest.current;
              if (to !== null && from !== null &&
                  instance.getPlayerState() === 1 && time >= to - 0.08) {
                if (repeats) {
                  instance.seekTo(from, true);
                  instance.playVideo();
                  latest.current.onTime(from);
                } else {
                  instance.pauseVideo();
                  latest.current.onTime(to);
                }
              } else {
                latest.current.onTime(time);
              }
            }, 250);
          },
          onError: ({ data }) => {
            if (cancelled) return;
            setError(data === 101 || data === 150 || data === 153
              ? '영상 소유자 설정 또는 YouTube 정책으로 앱 내 재생이 제한됩니다.'
              : 'YouTube 영상을 재생할 수 없습니다. 주소와 공개 상태를 확인하세요.');
          },
        },
      });
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (player.current === instance) player.current = null;
      instance?.destroy();
    };
  }, [videoId]);

  return <div className="youtube-preview">
    <div className="youtube-frame" ref={host} />
    {error && <p className="youtube-player-error" role="alert">{error}</p>}
  </div>;
});

import { layoutDefault, type LayoutStyle } from './layout-styles.js';
import type { SubtitlePreset, SubtitleTrack } from './subtitles.js';

/** A style is one versioned visual composition: frame placement AND caption appearance. */
export const SHORT_STYLES = [
  { id: 'clean-talk', name: '클린 토크', description: '중앙 인물 · 선명한 화이트 자막', layout: 'center', caption: 'classic' },
  { id: 'yellow-pop', name: '옐로우 팝', description: '중앙 화면 · 굵은 노란 강조 자막', layout: 'center', caption: 'bold' },
  { id: 'whole-scene', name: '풀 씬', description: '전체 영상과 블러 배경 · 미니멀 자막', layout: 'blur-fill', caption: 'minimal' },
  { id: 'boxed-story', name: '스토리 박스', description: '중앙 크롭 · 어두운 박스 자막', layout: 'center', caption: 'boxed' },
  { id: 'neon-side', name: '네온 에너지', description: '왼쪽 화면 포커스 · 네온 자막', layout: 'focus-left', caption: 'neon' },
  { id: 'cinema-frame', name: '시네마', description: '블러 배경 · 절제된 시네마 자막', layout: 'blur-fill', caption: 'cinema' },
  { id: 'reaction', name: '리액션 임팩트', description: '오른쪽 화면 포커스 · 대형 임팩트 자막', layout: 'focus-right', caption: 'impact' },
  { id: 'headline', name: '헤드라인', description: '중앙 화면 · 상단 헤드라인 자막', layout: 'center', caption: 'topline' },
] as const;
export type ShortStyleId = typeof SHORT_STYLES[number]['id'];
export interface ShortStyleSelection { id: ShortStyleId; version: 1; }
export function validateShortStyle(input: unknown): ShortStyleSelection | null {
  if (input === undefined || input === null) return null; // Legacy layout/caption choices preserved.
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('쇼츠 스타일 형식이 올바르지 않습니다.');
  const data = input as Partial<ShortStyleSelection>;
  if (data.version !== 1 || !SHORT_STYLES.some(item => item.id === data.id)) {
    throw new Error('지원하지 않는 쇼츠 스타일 또는 버전입니다.');
  }
  return { id: data.id!, version: 1 };
}
/** A new choice atomically changes both layers; it never replaces caption text/timings. */
export function selectShortStyle(id: ShortStyleId, subtitles: SubtitleTrack | null | undefined): {
  style: ShortStyleSelection; layout: LayoutStyle; subtitles: SubtitleTrack;
} {
  const option = SHORT_STYLES.find(item => item.id === id);
  if (!option) throw new Error('지원하지 않는 쇼츠 스타일입니다.');
  return {
    style: { id, version: 1 }, layout: layoutDefault(option.layout),
    subtitles: { ...(subtitles ?? { cues: [] }), preset: option.caption as SubtitlePreset },
  };
}

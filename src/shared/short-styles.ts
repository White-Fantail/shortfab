import { layoutDefault, type LayoutStyle } from './layout-styles.js';
import type { SubtitlePreset, SubtitleTrack } from './subtitles.js';

/** One versioned visual composition: frame, caption, and optional fixed banners. */
export const SHORT_STYLES = [
  { id: 'clean-talk', name: '클린 토크', description: '중앙 인물 · 화이트 자막', layout: 'center', caption: 'classic', positions: [] },
  { id: 'yellow-pop', name: '옐로우 팝', description: '중앙 화면 · 노란 강조', layout: 'center', caption: 'bold', positions: [] },
  { id: 'whole-scene', name: '풀 씬', description: '전체 영상 · 미니멀 자막', layout: 'blur-fill', caption: 'minimal', positions: [] },
  { id: 'boxed-story', name: '스토리 박스', description: '중앙 크롭 · 박스 자막', layout: 'center', caption: 'boxed', positions: [] },
  { id: 'neon-side', name: '네온 에너지', description: '왼쪽 포커스 · 네온 자막', layout: 'focus-left', caption: 'neon', positions: [] },
  { id: 'cinema-frame', name: '시네마', description: '블러 배경 · 시네마 자막', layout: 'blur-fill', caption: 'cinema', positions: [] },
  { id: 'reaction', name: '리액션 임팩트', description: '오른쪽 포커스 · 임팩트 자막', layout: 'focus-right', caption: 'impact', positions: [] },
  { id: 'headline', name: '헤드라인', description: '중앙 화면 · 상단 대사 자막', layout: 'center', caption: 'topline', positions: [] },
  { id: 'top-banner', name: '상단 고정', description: '상단 문구/이미지 · 중앙 영상', layout: 'center', caption: 'classic', positions: ['top'] },
  { id: 'bottom-banner', name: '하단 고정', description: '하단 문구/이미지 · 중앙 영상', layout: 'center', caption: 'topline', positions: ['bottom'] },
  { id: 'dual-banner', name: '상하 고정', description: '위아래 독립 문구/이미지', layout: 'blur-fill', caption: 'classic', positions: ['top', 'bottom'] },
] as const;
export type ShortStyleId = typeof SHORT_STYLES[number]['id'];
export type FixedPosition = 'top' | 'bottom';
export type FixedSlot =
  | { kind: 'text'; text: string; color: string; size: number; background: boolean }
  | { kind: 'image'; dataUrl: string; scale: number };
export type FixedStyleSlots = Partial<Record<FixedPosition, FixedSlot>>;
export interface ShortStyleSelection { id: ShortStyleId; version: 1; fixed?: FixedStyleSlots; }

export function fixedPositions(id: ShortStyleId): readonly FixedPosition[] {
  const style = SHORT_STYLES.find(item => item.id === id);
  return style ? style.positions as readonly FixedPosition[] : [];
}
export function defaultFixedSlot(position: FixedPosition): FixedSlot {
  return { kind: 'text', text: position === 'top' ? '상단 고정 문구' : '하단 고정 문구',
    color: '#ffffff', size: 46, background: true };
}
export function defaultFixedSlots(id: ShortStyleId): FixedStyleSlots {
  return Object.fromEntries(fixedPositions(id).map(position =>
    [position, defaultFixedSlot(position)])) as FixedStyleSlots;
}
function validateSlot(input: unknown, label: string): FixedSlot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(label + ': 고정 콘텐츠 형식 오류');
  const value = input as Partial<FixedSlot>;
  if (value.kind === 'text') {
    if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 100 ||
        typeof value.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.color) ||
        typeof value.size !== 'number' || !Number.isInteger(value.size) ||
        value.size < 24 || value.size > 72 || typeof value.background !== 'boolean') {
      throw new Error(label + ': 문구(1~100자), 색상, 크기(24~72), 배경을 확인하세요.');
    }
    return { kind: 'text', text: value.text.trim(), color: value.color, size: value.size, background: value.background };
  }
  if (value.kind === 'image') {
    // Small, inline images can be safely persisted and reopened without an external file path.
    // Prevent unlimited project JSON growth and exclude SVG, remote URLs and scripts.
    if (typeof value.dataUrl !== 'string' || value.dataUrl.length > 1400000 ||
        (value.dataUrl !== '' && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl)) ||
        typeof value.scale !== 'number' || !Number.isInteger(value.scale) ||
        value.scale < 30 || value.scale > 100) {
      throw new Error(label + ': PNG/JPEG/WebP 이미지(최대 1MB)와 크기를 확인하세요.');
    }
    return { kind: 'image', dataUrl: value.dataUrl, scale: value.scale };
  }
  throw new Error(label + ': 문자 또는 이미지를 선택하세요.');
}
export function validateShortStyle(input: unknown): ShortStyleSelection | null {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('쇼츠 스타일 형식이 올바르지 않습니다.');
  const value = input as Partial<ShortStyleSelection>;
  if (value.version !== 1 || !SHORT_STYLES.some(item => item.id === value.id)) {
    throw new Error('지원하지 않는 쇼츠 스타일 또는 버전입니다.');
  }
  const positions = fixedPositions(value.id!);
  if (!positions.length) {
    if (value.fixed && Object.keys(value.fixed).length) throw new Error('이 스타일은 고정 콘텐츠를 지원하지 않습니다.');
    return { id: value.id!, version: 1 };
  }
  const fixed = value.fixed ?? defaultFixedSlots(value.id!);
  if (!fixed || typeof fixed !== 'object' || Array.isArray(fixed) ||
      Object.keys(fixed).some(key => !positions.includes(key as FixedPosition))) {
    throw new Error('고정 콘텐츠 위치가 잘못되었습니다.');
  }
  const checked: FixedStyleSlots = {};
  for (const position of positions) checked[position] = validateSlot(fixed[position] ?? defaultFixedSlot(position), position);
  return { id: value.id!, version: 1, fixed: checked };
}
/** A new choice changes both layers and supplies editable fixed content where relevant. */
export function selectShortStyle(id: ShortStyleId, subtitles: SubtitleTrack | null | undefined): {
  style: ShortStyleSelection; layout: LayoutStyle; subtitles: SubtitleTrack;
} {
  const option = SHORT_STYLES.find(item => item.id === id);
  if (!option) throw new Error('지원하지 않는 쇼츠 스타일입니다.');
  return {
    style: validateShortStyle({ id, version: 1 })!,
    layout: layoutDefault(option.layout),
    subtitles: { ...(subtitles ?? { cues: [] }), preset: option.caption as SubtitlePreset },
  };
}

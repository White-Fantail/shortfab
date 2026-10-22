import type { OutputWidth } from './contracts.js';

/** Versioned, deterministic style catalog. IDs are persisted in clip JSON. */
export const LAYOUT_STYLES = [
  { id: 'center', name: '중앙 집중', description: '세로 프레임을 가득 채우는 기본 크롭', defaultFocus: 50 },
  { id: 'focus-left', name: '왼쪽 강조', description: '원본 왼쪽을 중심으로 세로 크롭', defaultFocus: 0 },
  { id: 'focus-right', name: '오른쪽 강조', description: '원본 오른쪽을 중심으로 세로 크롭', defaultFocus: 100 },
  { id: 'blur-fill', name: '전체 화면', description: '원본을 모두 보이게 하고 배경은 흐리게', defaultFocus: 50 },
] as const;
export type LayoutStyleId = typeof LAYOUT_STYLES[number]['id'];
export interface LayoutStyle {
  id: LayoutStyleId;
  focus: number; // 0..100: left to right. Not automatic face tracking.
}
export const DEFAULT_LAYOUT: LayoutStyle = { id: 'center', focus: 50 };

export function layoutDefault(id: LayoutStyleId): LayoutStyle {
  const found = LAYOUT_STYLES.find(item => item.id === id);
  if (!found) throw new Error('알 수 없는 레이아웃 스타일입니다.');
  return { id, focus: found.defaultFocus };
}
export function validateLayout(value: unknown): LayoutStyle {
  if (value === null || value === undefined) return { ...DEFAULT_LAYOUT };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('레이아웃 스타일 데이터가 올바르지 않습니다.');
  }
  const layout = value as Partial<LayoutStyle>;
  if (!LAYOUT_STYLES.some(item => item.id === layout.id) ||
      typeof layout.focus !== 'number' || !Number.isFinite(layout.focus) ||
      layout.focus < 0 || layout.focus > 100) {
    throw new Error('레이아웃 또는 크롭 중심을 다시 확인하세요.');
  }
  return { id: layout.id!, focus: layout.focus };
}

export type LayoutFilter = {
  graph: string;
  complex: boolean;
  output: string;
};
/** Used by export and real-frame preview. No unsanitized filter expressions. */
export function layoutFilter(width: OutputWidth, input: LayoutStyle | null | undefined): LayoutFilter {
  const layout = validateLayout(input);
  const height = Math.round(width * 16 / 9);
  if (layout.id === 'blur-fill') {
    const graph =
      '[0:v:0]split=2[back][front];' +
      `[back]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=10:2[bg];` +
      `[front]scale=${width}:${height}:force_original_aspect_ratio=decrease,setsar=1[fg];` +
      '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30[v]';
    return { graph, complex: true, output: '[v]' };
  }
  const position = layout.focus; // Manual refinements apply to every crop preset.
  const x = position === 0 ? '0' : position === 100 ? 'iw-ow' :
    `(iw-ow)*${Number((position / 100).toFixed(4))}`;
  return {
    graph: `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}:${x}:0,setsar=1,fps=30`,
    complex: false, output: '0:v:0',
  };
}
export function layoutSignature(value: LayoutStyle | null | undefined): string {
  return JSON.stringify(validateLayout(value));
}

import { useRef } from 'react';
import { LAYOUT_STYLES, type LayoutStyleId } from './shared/layout-styles';
import { SUBTITLE_PRESETS, type SubtitlePreset } from './shared/subtitles';

type Kind = 'layout' | 'subtitle';
const subtitles: Record<SubtitlePreset, { name: string; description: string }> = {
  classic: { name: '클래식 화이트', description: '큰 흰 글씨·검정 외곽선' },
  bold: { name: '팝 옐로우', description: '노란 굵은 글씨·강한 강조' },
  minimal: { name: '미니멀', description: '작고 담백한 자막' },
  boxed: { name: '박스 자막', description: '반투명 어두운 배경' },
};
export function StyleGallery({ kind, selected, videoId, frameImage, sampleText, disabled, onChoose }: {
  kind: Kind;
  selected: LayoutStyleId | SubtitlePreset;
  videoId: string | null;
  frameImage?: string | null;
  sampleText?: string;
  disabled: boolean;
  onChoose: (id: string) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const items = kind === 'layout'
    ? LAYOUT_STYLES.map(item => ({ id: item.id, name: item.name, description: item.description }))
    : SUBTITLE_PRESETS.map(id => ({ id, ...subtitles[id] }));
  // The YouTube thumbnail is a visual reference, NOT a render-accurate clip frame.
  const fallbackThumbnail = videoId && /^[\w-]{11}$/.test(videoId)
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
  const thumbnail = frameImage || fallbackThumbnail;
  const scroll = (direction: number) => track.current?.scrollBy({ left: direction * 190, behavior: 'smooth' });
  return <div className="style-gallery">
    <div className="style-gallery-heading">
      <strong>{kind === 'layout' ? '화면 스타일 선택' : '자막 스타일 선택'}</strong>
      <div className="style-gallery-arrows">
        <button type="button" aria-label="이전 스타일" onClick={() => scroll(-1)}>‹</button>
        <button type="button" aria-label="다음 스타일" onClick={() => scroll(1)}>›</button>
      </div>
    </div>
    <div className="style-gallery-track" ref={track} aria-label={kind === 'layout' ? '레이아웃 스타일 카드' : '자막 스타일 카드'}>
      {items.map((style) => <button type="button" key={style.id}
        className={`style-gallery-card ${selected === style.id ? 'is-selected' : ''}`}
        aria-pressed={selected === style.id} disabled={disabled}
        onClick={() => onChoose(style.id)}>
        <span className={`style-card-portrait preview-${kind}-${style.id}`} aria-hidden="true">
          {thumbnail ? <>
            {kind === 'layout' && style.id === 'blur-fill' && <img className="style-thumb-blur" src={thumbnail} alt="" loading="lazy" />}
            <img className="style-thumb-primary" src={thumbnail} alt="" loading="lazy" />
          </> : <span className="style-thumb-placeholder">▣</span>}
          {kind === 'subtitle' && <span className={`style-example-text style-example-${style.id}`}>
            {(sampleText?.trim() || '여기에 자막이 나옵니다').slice(0, 55)}
          </span>}
          {selected === style.id && <span className="style-chosen-indicator">✓</span>}
        </span>
        <strong>{style.name}</strong>
        <small>{style.description}</small>
      </button>)}
    </div>
    <p className="hint">카드를 옆으로 넘기고 탭해서 선택하세요. {kind === 'layout'
      ? '선택 클립의 실제 프레임을 불러오지 않았다면 원본 썸네일을 참고 시안으로 표시합니다. 인물 자동 추적은 없습니다.'
      : '자막 미리보기는 스타일 예시이며, 출력에는 실제 인식/입력된 자막이 들어갑니다.'}</p>
  </div>;
}

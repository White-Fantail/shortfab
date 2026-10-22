import { useRef } from 'react';
import { SHORT_STYLES, defaultFixedSlots, fixedPositions, type ShortStyleId, type ShortStyleSelection, type FixedPosition } from './shared/short-styles';

export function StyleGallery({ selected, configuredStyle, videoId, frameImage, focus, sampleText, disabled, onChoose }: {
  selected: ShortStyleId | null;
  configuredStyle?: ShortStyleSelection | null;
  videoId: string | null;
  frameImage?: string | null;
  focus?: number;
  sampleText?: string;
  disabled: boolean;
  onChoose: (id: ShortStyleId) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const fallback = videoId && /^[\w-]{11}$/.test(videoId)
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
  const thumbnail = frameImage || fallback;
  const scroll = (direction: number) => track.current?.scrollBy({ left: direction * 190, behavior: 'smooth' });
  return <div className="style-gallery">
    <div className="style-gallery-heading">
      <strong>쇼츠 스타일 · 화면 + 자막 + 고정 영역</strong>
      <div className="style-gallery-arrows">
        <button type="button" aria-label="이전 스타일" onClick={() => scroll(-1)}>‹</button>
        <button type="button" aria-label="다음 스타일" onClick={() => scroll(1)}>›</button>
      </div>
    </div>
    <div className="style-gallery-track" ref={track} aria-label="통합 쇼츠 스타일 카드">
      {SHORT_STYLES.map(style => {
        const fixed = selected === style.id && configuredStyle?.fixed
          ? configuredStyle.fixed : defaultFixedSlots(style.id);
        return <button type="button" key={style.id}
          className={`style-gallery-card ${selected === style.id ? 'is-selected' : ''}`}
          aria-pressed={selected === style.id} disabled={disabled}
          onClick={() => onChoose(style.id)}>
          <span className={`style-card-portrait preview-layout-${style.layout}`} aria-hidden="true">
            {thumbnail ? <>
              {style.layout === 'blur-fill' && <img className="style-thumb-blur" src={thumbnail} alt="" loading="lazy" />}
              <img className="style-thumb-primary" src={thumbnail} alt="" loading="lazy"
                style={style.layout === 'blur-fill' ? { objectFit: 'contain' } :
                  { objectPosition: `${selected === style.id && Number.isFinite(focus) ? focus :
                    style.layout === 'focus-left' ? 0 : style.layout === 'focus-right' ? 100 : 50}% center` }} />
            </> : <span className="style-thumb-placeholder">▣</span>}
            {fixedPositions(style.id).map((position: FixedPosition) => {
              const slot = fixed[position];
              if (!slot) return null;
              return <span key={position}
                className={`style-example-fixed fixed-${position}`}
                style={slot.kind === 'text' ? {
                  color: slot.color, fontSize: `${Math.round(slot.size * 0.26)}px`,
                  background: slot.background ? 'rgba(10,10,18,.82)' : 'transparent',
                } : undefined}>
                {slot.kind === 'text' ? slot.text : slot.dataUrl
                  ? <img src={slot.dataUrl} alt="" style={{ maxWidth: `${slot.scale}%`, maxHeight: `${slot.scale}%` }} />
                  : <span>이미지 선택</span>}
              </span>;
            })}
            <span className={`style-example-text style-example-${style.caption}`}>
              {(sampleText?.trim() || '여기에 대사가 표시됩니다').slice(0, 55)}
            </span>
            {selected === style.id && <span className="style-chosen-indicator">✓</span>}
          </span>
          <strong>{style.name}</strong>
          <small>{style.description}</small>
        </button>;
      })}
    </div>
    <p className="hint">카드는 정지 프레임 시안입니다. 고정 텍스트·이미지는 04 나레이션에서 수정하면 선택 카드에도 반영되며, MP4 전체 구간에 출력됩니다.</p>
  </div>;
}

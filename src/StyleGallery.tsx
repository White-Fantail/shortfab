import { useRef } from 'react';
import { SHORT_STYLES, type ShortStyleId } from './shared/short-styles';

export function StyleGallery({ selected, videoId, frameImage, focus, sampleText, disabled, onChoose }: {
  selected: ShortStyleId | null;
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
      <strong>쇼츠 스타일 선택 · 화면 + 자막</strong>
      <div className="style-gallery-arrows">
        <button type="button" aria-label="이전 스타일" onClick={() => scroll(-1)}>‹</button>
        <button type="button" aria-label="다음 스타일" onClick={() => scroll(1)}>›</button>
      </div>
    </div>
    <div className="style-gallery-track" ref={track} aria-label="통합 쇼츠 스타일 카드">
      {SHORT_STYLES.map(style => <button type="button" key={style.id}
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
          <span className={`style-example-text style-example-${style.caption}`}>
            {(sampleText?.trim() || '여기에 대사가 표시됩니다').slice(0, 55)}
          </span>
          {selected === style.id && <span className="style-chosen-indicator">✓</span>}
        </span>
        <strong>{style.name}</strong>
        <small>{style.description}</small>
      </button>)}
    </div>
    <p className="hint">스타일 하나로 화면 구도와 자막 디자인이 함께 변경됩니다. 자막 문장과 시간은 보존됩니다.
      미리보기는 정지 프레임에 합성을 흉내 낸 참고 시안이며, 실제 출력 영상의 재생 프리뷰는 아닙니다.</p>
  </div>;
}

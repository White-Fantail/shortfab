import type { ProjectClip } from './shared/projects';
import { SHORT_STYLES, defaultFixedSlot, fixedPositions } from './shared/short-styles';
import { splitNarration } from './shared/narration';

/** Lightweight live guide: overlay text follows the selected clip while export uses FFmpeg. */
export function StyledPreviewOverlay({ clip, time, frameImage, videoId }: {
  clip: ProjectClip;
  time: number;
  frameImage: string | null;
  videoId: string | null;
}) {
  const style = SHORT_STYLES.find(item => item.id === clip.style?.id);
  if (!style) return null;
  const active = clip.subtitles?.cues.find(cue =>
    time >= clip.start + cue.start && time < clip.start + cue.end && cue.text.trim());
  const ttsSample = clip.narration?.mode === 'tts' ? splitNarration(clip.narration.text)[0] : '';
  const fallbackText = ttsSample || clip.subtitles?.cues[0]?.text || '자막 예시';
  const caption = active?.text || fallbackText;
  const illustrative = !active || Boolean(ttsSample);
  const backdrop = frameImage || (videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId)
    ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);
  return <>
    {style.layout === 'blur-fill' && backdrop && <img className="live-style-backdrop"
      alt="" src={backdrop} aria-hidden="true" />}
    {fixedPositions(style.id).map(position => {
      const slot = clip.style?.fixed?.[position] ?? defaultFixedSlot(position);
      return <div key={position} aria-hidden="true"
        className={`live-style-fixed style-example-fixed fixed-${position}`}
        style={slot.kind === 'text' ? {
          color: slot.color, fontSize: `${(slot.size / 720 * 100).toFixed(2)}cqw`,
          background: slot.background ? 'rgba(10,10,18,.82)' : 'transparent',
        } : undefined}>
        {slot.kind === 'text' ? slot.text : slot.dataUrl
          ? <img alt="" src={slot.dataUrl} style={{ maxWidth: `${slot.scale}%`, maxHeight: `${slot.scale}%` }} />
          : null}
      </div>;
    })}
    {caption && <div aria-hidden="true" className={`live-style-caption live-caption-${style.caption}${active?.emphasis ? ' live-caption-emphasis' : ''}${illustrative ? ' illustrative' : ''}`}>
      {caption}
    </div>}
    {clip.subtitles?.hook && time >= clip.start && time < clip.start + clip.subtitles.hook.duration &&
      !fixedPositions(style.id).length && <div aria-hidden="true"
        className={`subtitle-hook-preview hook-${clip.subtitles.hook.style}`}>
        {clip.subtitles.hook.text}
      </div>}
  </>;
}

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateSubtitleTrack, type SubtitleCue, type SubtitleHook, type SubtitleTrack } from '../src/shared/subtitles.js';

export interface CaptionInterval {
  start: number;
  end: number;
  cue: SubtitleCue | null;
  hook: SubtitleHook | null;
}

/** Keep transparent gaps. Never skip a cue or silently export missing captions. */
export function captionIntervals(track: SubtitleTrack, seconds: number): CaptionInterval[] {
  const checked = validateSubtitleTrack(track, seconds);
  if (!checked) return [];
  const positions = [0, seconds, ...checked.cues.flatMap(cue => [cue.start, cue.end])];
  if (checked.hook) positions.push(checked.hook.duration);
  const boundaries = [...new Set(positions.map(value => Math.min(seconds, Math.max(0, value))))]
    .sort((a, b) => a - b);
  return boundaries.slice(0, -1).flatMap((start, index) => {
    const end = boundaries[index + 1];
    if (end - start < 0.00001) return [];
    const at = (start + end) / 2;
    const cue = checked.cues.find(value => at >= value.start && at < value.end) ?? null;
    const hook = checked.hook && at < checked.hook.duration ? checked.hook : null;
    return [{ start, end, cue, hook }];
  });
}

/** Constant graph. The caption text and any user paths never enter filter syntax. */
export function captionOverlayGraph(layoutGraph: string, complex: boolean): string {
  const base = complex ? layoutGraph : '[0:v:0]' + layoutGraph + '[v]';
  return base + ';[v][1:v]overlay=shortest=0:repeatlast=1:format=auto,format=yuv420p[outputv]';
}

// This script runs in an isolated, hidden Electron window, never on an external site.
// Canvas uses system fonts for Korean/English without FFmpeg's optional libass library.
const PAINT_CANVAS = [
  'function(model){',
  'const c=document.createElement("canvas"); c.width=model.width; c.height=Math.round(model.width*16/9);',
  'const ctx=c.getContext("2d",{alpha:true}); if(!ctx)throw Error("Canvas 2D unavailable");',
  'const s=model.width/720;',
  'const presets={',
  'classic:{size:48,color:"#ffffff",bold:true,outline:3,bottom:148},',
  'bold:{size:60,color:"#ffe500",bold:true,outline:4,bottom:150},',
  'minimal:{size:40,color:"#ffffff",bold:false,outline:2,bottom:170},',
  'boxed:{size:46,color:"#ffffff",bold:true,outline:2,bottom:155,box:true},',
  'neon:{size:54,color:"#42ddff",bold:true,outline:5,bottom:155,glow:true},',
  'cinema:{size:42,color:"#ffffff",bold:false,outline:2,bottom:180},',
  'impact:{size:72,color:"#ffffff",bold:true,outline:5,bottom:185},',
  'topline:{size:46,color:"#ffffff",bold:true,outline:3,top:175}};',
  'function draw(text,style,mode){',
  'if(!text)return;',
  'let size=style.size*s; const maxWidth=c.width-(mode==="hook"?70:84)*s;',
  'const family="\"Apple SD Gothic Neo\",\"Noto Sans CJK KR\",Arial,sans-serif";',
  'let lines=[];',
  'for(let attempt=0;attempt<12;attempt++){',
  'ctx.font=(style.bold?"900 ":"400 ")+size+"px "+family;',
  'lines=[];',
  'for(const paragraph of text.split(/\\r?\\n/)){',
  'let row=""; for(const char of Array.from(paragraph)){',
  'const candidate=row+char;',
  'if(row&&ctx.measureText(candidate).width>maxWidth){lines.push(row.trim());row=char;}else row=candidate;',
  '} lines.push(row.trim());',
  '}',
  'if(lines.length<=5&&lines.length*size*1.25<c.height*.48)break;',
  'size*=.88;',
  '}',
  'const lineHeight=size*1.22;',
  'let y=style.top===undefined?c.height-style.bottom*s-(lines.length-1)*lineHeight:style.top*s;',
  'ctx.textAlign="center";ctx.textBaseline="alphabetic";ctx.lineJoin="round";',
  'ctx.lineWidth=style.outline*2*s;ctx.strokeStyle="#0c0c0e";ctx.fillStyle=style.color;',
  'for(const line of lines){',
  'const width=ctx.measureText(line).width;',
  'if(style.box){ctx.fillStyle=mode==="hook"?"rgba(20,15,22,.86)":"rgba(0,0,0,.74)";',
  'ctx.fillRect((c.width-width)/2-17*s,y-size-8*s,width+34*s,lineHeight+12*s);ctx.fillStyle=style.color;}',
  'if(style.glow){ctx.shadowColor="#10d5ff";ctx.shadowBlur=10*s;}',
  'ctx.strokeText(line,c.width/2,y);ctx.fillText(line,c.width/2,y);ctx.shadowBlur=0;',
  'y+=lineHeight;',
  '}',
  '}',
  'if(model.cue)draw(model.cue.text,model.cue.emphasis?',
  '{size:62,color:"#ffe500",bold:true,outline:5,bottom:160}:presets[model.preset],"cue");',
  'if(model.hook)draw(model.hook.text,model.hook.style==="banner"?',
  '{size:62,color:"#ffffff",bold:true,outline:2,top:135,box:true}:',
  '{size:60,color:"#ffff66",bold:true,outline:5,top:135},"hook");',
  'return c.toDataURL("image/png");',
  '}',
].join('\n');

/** Produces one timestamped PNG stream (not 30 simultaneous FFmpeg inputs). */
export async function createCaptionOverlay(
  track: SubtitleTrack, seconds: number, width: number, directory: string,
  cancelled: () => boolean = () => false,
): Promise<string> {
  const intervals = captionIntervals(track, seconds);
  if (!intervals.length) throw new Error('합성할 자막 구간이 없습니다.');
  // Dynamic import so the pure graph/timeline tests run without an Electron process.
  const { BrowserWindow } = await import('electron');
  if (typeof BrowserWindow !== 'function') throw new Error('Electron 자막 캔버스를 실행할 수 없습니다.');
  const window = new BrowserWindow({ show: false, width: 320, height: 240,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadURL('data:text/html;charset=utf-8,<html><body></body></html>');
    const names = new Map<string, string>();
    const lines = ['ffconcat version 1.0'];
    let last = '';
    for (const interval of intervals) {
      if (cancelled()) throw new Error('렌더가 취소되었습니다.');
      const model = { width, preset: track.preset, cue: interval.cue, hook: interval.hook };
      const key = JSON.stringify(model);
      let filename = names.get(key);
      if (!filename) {
        filename = 'caption-' + names.size + '.png';
        const data: string = await window.webContents.executeJavaScript(
          '(' + PAINT_CANVAS + ')(' + key + ')', true);
        if (!data.startsWith('data:image/png;base64,')) throw new Error('자막 이미지 생성에 실패했습니다.');
        await writeFile(join(directory, filename), Buffer.from(data.slice('data:image/png;base64,'.length), 'base64'),
          { mode: 0o600 });
        names.set(key, filename);
      }
      lines.push("file '" + filename + "'", 'duration ' + (interval.end - interval.start).toFixed(6));
      last = filename;
    }
    lines.push("file '" + last + "'");
    const filepath = join(directory, 'captions.ffconcat');
    await writeFile(filepath, lines.join('\n') + '\n', { mode: 0o600 });
    return filepath;
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

import { describe, expect, it } from 'vitest';
import { SHORT_STYLES, selectShortStyle, validateShortStyle } from './short-styles.js';
import { splitNarration, validateNarration } from './narration.js';
import { compositionStyleSignature } from './style-signature.js';
import { validateProjectEdits } from './projects.js';
import { acceptStep, newWizard, reconcileWizard, stepPlan } from './wizard.js';

const clip = (id: string) => ({
  id, source: 'youtube' as const, title: 'Clipped', start: 2, end: 30, width: 720 as const,
  layout: { id: 'center' as const, focus: 50 },
  subtitles: { preset: 'classic' as const, cues: [{ id: 'cue1', start: 0, end: 2, text: '원본 대사' }] },
});
const a=clip('a2c61b6b-65b2-4e98-9b13-d8dd8f8120f3');
const b=clip('a2c61b6b-65b2-4e98-9b13-d8dd8f8120f4');
describe('Unified visual style and narration', () => {
  it('chooses the frame+captions as one style but preserves actual caption text and timing', () => {
    expect(SHORT_STYLES).toHaveLength(8);
    const patch=selectShortStyle('reaction',a.subtitles);
    expect(patch.layout.id).toBe('focus-right');
    expect(patch.subtitles.preset).toBe('impact');
    expect(patch.subtitles.cues).toEqual(a.subtitles.cues);
    expect(validateShortStyle(patch.style)).toEqual(patch.style);
    expect(() => validateShortStyle({id:'custom script',version:1})).toThrow();
  });
  it('roundtrips versioned choice/narration and retains legacy visuals without rewriting them', () => {
    const project={id:'c84ac160-6a0b-4d63-bae3-3256f6e6b276',revision:0,title:'Video',
      youtubeUrl:'https://youtu.be/abcdefghijk',youtubeDuration:40,
      selectedClipId:a.id};
    const styled={ ...a, ...selectShortStyle('yellow-pop',a.subtitles),
      narration:{mode:'tts' as const,voice:'ko' as const,text:'첫 번째 문장. 두 번째 문장.'}};
    const saved=validateProjectEdits({...project,clips:[styled]},null);
    expect(saved.clips[0].style).toEqual({id:'yellow-pop',version:1});
    expect(saved.clips[0].narration).toEqual(styled.narration);
    expect(validateProjectEdits({...project,clips:[a]},null).clips[0].style).toBeNull();
    expect(() => validateProjectEdits({...project,clips:[{...a,style:{id:'invalid',version:1}}]},null)).toThrow();
  });
  it('revises only edited clip downstream plans and changes export signature',()=>{
    let state=newWizard([a,b]);
    for (const c of [a,b]) for (const step of ['layout','audio','subtitles','review','export'] as const) {
      state=acceptStep(state,c.id,step);
    }
    const before={youtubeUrl:'https://youtu.be/abcdefghijk',youtubeDuration:40,clips:[a,b]};
    const edited={...a,...selectShortStyle('headline',a.subtitles),narration:{mode:'tts' as const,voice:'en' as const,text:'New intro.'}};
    state=reconcileWizard(state,before,{...before,clips:[edited,b]});
    expect(stepPlan(state,a.id,'layout').status).toBe('needs_review');
    expect(stepPlan(state,a.id,'subtitles').status).toBe('needs_review');
    expect(stepPlan(state,a.id,'export').status).toBe('needs_review');
    expect(stepPlan(state,b.id,'export').status).toBe('accepted');
    expect(compositionStyleSignature(a)).not.toBe(compositionStyleSignature(edited));
  });
  it('splits spoken script deterministically and rejects unsafe settings',()=>{
    expect(splitNarration('안녕. 다시 만나!\nGood morning.')).toEqual(['안녕.','다시 만나!','Good morning.']);
    expect(validateNarration({mode:'off',voice:'ko',text:''})?.mode).toBe('off');
    expect(() => validateNarration({mode:'tts',voice:'en',text:''})).toThrow();
    expect(() => validateNarration({mode:'tts',voice:'ko',text:'x'.repeat(1201)})).toThrow();
  });
});

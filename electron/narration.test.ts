import { describe, expect, it } from 'vitest';
import { narrationAudioFilter } from './narration.js';
describe('local narration audio graph',()=>{
  it('ducks background under voice without trusting user strings in FFmpeg filters',()=>{
    const graph=narrationAudioFilter(true,2);
    expect(graph.graph).toContain('volume=0.18');
    expect(graph.graph).toContain('[2:a:0]volume=1');
    expect(graph.map).toBe('[outa]');
    expect(narrationAudioFilter(false,1)).toEqual({graph:null,map:'1:a:0'});
    expect(()=>narrationAudioFilter(true,99)).toThrow();
  });
});

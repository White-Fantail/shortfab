import { layoutSignature } from './layout-styles.js';
import type { ProjectClip } from './projects.js';

/** Bind exported media to both layout geometry and the chosen visual preset version. */
export function compositionStyleSignature(clip: Pick<ProjectClip, 'layout' | 'style'> | null | undefined): string {
  return layoutSignature(clip?.layout) + '|' + JSON.stringify(clip?.style ?? null);
}

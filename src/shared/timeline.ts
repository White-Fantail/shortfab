/**
 * The YouTube IFrame API may keep reporting the old playback time for a short
 * period after seekTo(). Holding the desired position prevents the editor
 * timeline from snapping backwards and then forwards during that delay.
 */
export class SeekTimeGuard {
  private pending: { target: number; at: number } | null = null;

  seek(target: number, at = Date.now()): void {
    if (Number.isFinite(target) && target >= 0) this.pending = { target, at };
  }

  sample(actual: number, at = Date.now()): number | null {
    if (!Number.isFinite(actual) || actual < 0) return null;
    if (this.pending) {
      const { target, at: requestedAt } = this.pending;
      if (Math.abs(actual - target) <= 1.5 || at - requestedAt >= 6500) {
        this.pending = null;
      } else {
        return null;
      }
    }
    return actual;
  }

  reset(): void {
    this.pending = null;
  }
}

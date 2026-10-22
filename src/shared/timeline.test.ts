import { describe, expect, it } from 'vitest';
import { SeekTimeGuard } from './timeline.js';

describe('YouTube timeline seeking', () => {
  it('does not snap back to the old time while a requested seek is pending', () => {
    const guard = new SeekTimeGuard();
    guard.seek(620, 1000);
    expect(guard.sample(180, 1050)).toBeNull();
    expect(guard.sample(180.5, 1320)).toBeNull();
    expect(guard.sample(619.5, 1400)).toBe(619.5);
    expect(guard.sample(620.25, 1650)).toBe(620.25);
  });

  it('only accepts the newest seek after rapid successive movements', () => {
    const guard = new SeekTimeGuard();
    guard.seek(240, 1000);
    guard.seek(480, 1100);
    expect(guard.sample(240, 1200)).toBeNull();
    expect(guard.sample(479.8, 1400)).toBe(479.8);
  });

  it('recovers from a failed seek and ignores invalid samples', () => {
    const guard = new SeekTimeGuard();
    guard.seek(70, 1000);
    expect(guard.sample(Number.NaN, 1200)).toBeNull();
    expect(guard.sample(5, 3500)).toBeNull();
    expect(guard.sample(5, 7500)).toBe(5);
  });

  it('resets when changing media', () => {
    const guard = new SeekTimeGuard();
    guard.seek(50, 1000);
    guard.reset();
    expect(guard.sample(1, 1100)).toBe(1);
  });
});

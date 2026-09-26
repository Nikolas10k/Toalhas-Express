import { describe, expect, it } from 'vitest';
import { computeBackoffMs } from '@/server/core/backoff';

describe('computeBackoffMs', () => {
  it('cresce exponencialmente com jitter entre 50% e 100%', () => {
    const lo = (n: number) => computeBackoffMs(n, { baseMs: 1000, random: () => 0 });
    const hi = (n: number) => computeBackoffMs(n, { baseMs: 1000, random: () => 0.999999 });
    expect(lo(1)).toBe(500);
    expect(hi(1)).toBe(1000);
    expect(lo(3)).toBe(2000);
    expect(hi(3)).toBe(4000);
  });

  it('respeita o teto', () => {
    expect(computeBackoffMs(40, { baseMs: 1000, maxMs: 60_000, random: () => 0.999999 })).toBe(60_000);
  });

  it('trata tentativa inválida como a primeira', () => {
    expect(computeBackoffMs(0, { baseMs: 1000, random: () => 0 })).toBe(500);
  });
});

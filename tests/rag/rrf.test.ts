import { describe, it, expect } from 'vitest';
import { rrfFuse, rrfFuseIds } from '@/lib/rag/rrf';

describe('rrfFuse', () => {
  it('returns empty for no input', () => {
    expect(rrfFuse([])).toEqual([]);
  });

  it('sums scores across lists', () => {
    // 'a' is top of both lists: 1/(60+1) + 1/(60+1) = ~0.0328
    // 'b' is rank 2 in both:    1/62 + 1/62     = ~0.0323
    const out = rrfFuse([
      [
        { id: 'a', rank: 1 },
        { id: 'b', rank: 2 },
      ],
      [
        { id: 'a', rank: 1 },
        { id: 'b', rank: 2 },
      ],
    ]);
    expect(out[0].id).toBe('a');
    expect(out[1].id).toBe('b');
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it('favours items appearing across multiple lists', () => {
    // x appears rank 5 in two lists; y appears rank 1 in only one list.
    // 2/(60+5) = 0.0308 < 1/(60+1) = 0.0164 — nope, 2/65 ≈ 0.0308 vs 1/61 ≈ 0.0164
    // So x (multi-list) wins.
    const out = rrfFuse([
      [
        { id: 'y', rank: 1 },
        { id: 'x', rank: 5 },
      ],
      [{ id: 'x', rank: 5 }],
    ]);
    expect(out[0].id).toBe('x');
  });

  it('rrfFuseIds converts string lists correctly', () => {
    const out = rrfFuseIds([
      ['a', 'b', 'c'],
      ['b', 'c', 'a'],
    ]);
    expect(out.map((f) => f.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

/**
 * Reciprocal Rank Fusion.
 *
 * Merges multiple ranked result lists into a single list by summing
 * `1 / (k + rank_i)` across lists. `k=60` is the canonical default
 * (Cormack, Clarke, Buettcher, 2009).
 */

export interface RankedItem {
  id: string;
  rank: number; // 1-based rank within its source list
}

export interface FusedItem {
  id: string;
  score: number;
}

/**
 * Fuse N ranked lists by RRF. Input lists must be pre-sorted by their
 * own relevance (best first). Items are identified by `id`; appearances
 * in multiple lists accumulate score.
 */
export function rrfFuse(lists: RankedItem[][], k = 60): FusedItem[] {
  const accum = new Map<string, number>();
  for (const list of lists) {
    for (const item of list) {
      const prev = accum.get(item.id) ?? 0;
      accum.set(item.id, prev + 1 / (k + item.rank));
    }
  }
  return Array.from(accum.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Convenience: fuse lists given as plain `string[]` of ids in rank order.
 */
export function rrfFuseIds(lists: string[][], k = 60): FusedItem[] {
  const wrapped = lists.map((list) => list.map<RankedItem>((id, i) => ({ id, rank: i + 1 })));
  return rrfFuse(wrapped, k);
}

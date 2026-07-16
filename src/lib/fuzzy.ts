// A tiny subsequence fuzzy matcher for the command palette (PRD §15.1).
//
// Scores a query against a candidate string: every query char must appear in
// order (subsequence match), and matches score higher when they are contiguous,
// at a word boundary, or at the very start. Returns null for a non-match.

export interface FuzzyMatch {
  score: number;
  /** indices in the target that matched, for highlighting */
  positions: number[];
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (q === '') return { score: 0, positions: [] };
  const t = target.toLowerCase();

  let score = 0;
  let qi = 0;
  let prevMatch = -2;
  const positions: number[] = [];

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue;
    positions.push(ti);
    let s = 1;
    if (ti === prevMatch + 1) s += 3; // contiguous run
    if (ti === 0)
      s += 5; // start of string
    else {
      const before = t[ti - 1]!;
      if (before === ' ' || before === '_' || before === '.' || before === '-') s += 4; // word start
    }
    score += s;
    prevMatch = ti;
    qi++;
  }

  if (qi < q.length) return null; // not all query chars consumed → no match
  // prefer shorter targets when scores tie
  score -= t.length * 0.01;
  return { score, positions };
}

export interface Ranked<T> {
  item: T;
  match: FuzzyMatch;
}

/** Filter + rank a list by a query, best first. Empty query keeps input order. */
export function fuzzyRank<T>(query: string, items: T[], key: (item: T) => string): Ranked<T>[] {
  if (query.trim() === '')
    return items.map((item) => ({ item, match: { score: 0, positions: [] } }));
  const out: Ranked<T>[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, key(item));
    if (match) out.push({ item, match });
  }
  out.sort((a, b) => b.match.score - a.match.score);
  return out;
}

// A small line-level diff (PRD §8, "Cursor preservation").
//
// When a model-initiated change reprints the canonical text under the user
// (e.g. dragging a table reorders statements), the editor must NOT do a
// full-document replace — that collapses to a single giant change spanning the
// cursor, so CodeMirror maps the caret to the end of the replacement and it
// jumps. Instead we emit a *minimal* set of changes keyed to the lines that
// actually differ; CodeMirror's own position mapping then keeps the caret put
// whenever it sits on an untouched line.
//
// The changes are plain `{ from, to, insert }` spans in ORIGINAL-document
// coordinates — exactly what `EditorView.dispatch({ changes })` expects. They
// are non-overlapping and returned in ascending order.

export interface LineChange {
  /** char offset in the old document (inclusive) */
  from: number;
  /** char offset in the old document (exclusive) */
  to: number;
  /** replacement text */
  insert: string;
}

type Op = { t: 'keep' } | { t: 'del' } | { t: 'ins'; line: string };

/**
 * Longest-common-subsequence alignment of two line arrays, returned as an
 * ordered op list (`keep`/`del` consume an old line; `ins` adds a new one).
 * Common prefix/suffix lines are stripped first so the O(n·m) DP only runs over
 * the genuinely-changed middle — a handful of lines for a typical edit, even in
 * a thousand-line document.
 */
function lcsOps(a: string[], b: string[]): Op[] {
  let lo = 0;
  let aHi = a.length;
  let bHi = b.length;
  while (lo < aHi && lo < bHi && a[lo] === b[lo]) lo++;
  while (aHi > lo && bHi > lo && a[aHi - 1] === b[bHi - 1]) {
    aHi--;
    bHi--;
  }

  const ops: Op[] = [];
  for (let i = 0; i < lo; i++) ops.push({ t: 'keep' });

  const am = aHi - lo;
  const bm = bHi - lo;
  if (am === 0 || bm === 0) {
    for (let i = lo; i < aHi; i++) ops.push({ t: 'del' });
    for (let j = lo; j < bHi; j++) ops.push({ t: 'ins', line: b[j]! });
  } else {
    // LCS DP over the changed middle, then backtrack into ops.
    const dp: number[][] = Array.from({ length: am + 1 }, () => new Array(bm + 1).fill(0));
    for (let i = am - 1; i >= 0; i--) {
      for (let j = bm - 1; j >= 0; j--) {
        dp[i]![j]! =
          a[lo + i] === b[lo + j]
            ? dp[i + 1]![j + 1]! + 1
            : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < am && j < bm) {
      if (a[lo + i] === b[lo + j]) {
        ops.push({ t: 'keep' });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        ops.push({ t: 'del' });
        i++;
      } else {
        ops.push({ t: 'ins', line: b[lo + j]! });
        j++;
      }
    }
    while (i < am) {
      ops.push({ t: 'del' });
      i++;
    }
    while (j < bm) {
      ops.push({ t: 'ins', line: b[lo + j]! });
      j++;
    }
  }

  for (let i = bHi; i < b.length; i++) ops.push({ t: 'keep' });
  return ops;
}

/**
 * Compute the minimal line-level changes turning `oldText` into `newText`.
 * Returns `[]` when the texts are identical.
 */
export function diffLines(oldText: string, newText: string): LineChange[] {
  if (oldText === newText) return [];

  const A = oldText.split('\n');
  const B = newText.split('\n');
  const N = A.length;
  const end = oldText.length;

  // Char offset where old line i begins (each line but the last is followed by
  // its '\n' separator). Valid for i in [0, N-1]; the append point past the last
  // line is `end`, handled explicitly below (the last line has no separator).
  const start = new Array<number>(N);
  start[0] = 0;
  for (let i = 1; i < N; i++) start[i] = start[i - 1]! + A[i - 1]!.length + 1;

  const changes: LineChange[] = [];
  // A group is a maximal run of del/ins ops between kept lines: it deletes old
  // lines [i, k) and inserts `ins` in their place.
  let ai = 0;
  let group: { i: number; k: number; ins: string[] } | null = null;

  const flush = () => {
    if (!group) return;
    const { i, k, ins } = group;
    let from: number;
    let to: number;
    let insert: string;
    if (k < N) {
      // interior: replace whole lines [i, k), each with its trailing separator
      from = start[i]!;
      to = start[k]!;
      insert = ins.map((l) => `${l}\n`).join('');
    } else if (i === k) {
      // pure insertion after the final line: append separator + new lines
      from = end;
      to = end;
      insert = ins.length ? `\n${ins.join('\n')}` : '';
    } else {
      // replacement running to end-of-document (final line has no separator)
      to = end;
      if (i === 0) {
        from = 0;
        insert = ins.join('\n');
      } else {
        from = start[i]! - 1; // also drop the separator before the first line
        insert = ins.length ? `\n${ins.join('\n')}` : '';
      }
    }
    changes.push({ from, to, insert });
    group = null;
  };

  for (const op of lcsOps(A, B)) {
    if (op.t === 'keep') {
      flush();
      ai++;
    } else if (op.t === 'del') {
      if (!group) group = { i: ai, k: ai, ins: [] };
      ai++;
      group.k = ai;
    } else {
      if (!group) group = { i: ai, k: ai, ins: [] };
      group.ins.push(op.line);
    }
  }
  flush();
  return changes;
}

/** Test helper: apply changes (original-doc coords) to reconstruct the new text. */
export function applyLineChanges(oldText: string, changes: LineChange[]): string {
  let out = '';
  let pos = 0;
  for (const c of changes) {
    out += oldText.slice(pos, c.from) + c.insert;
    pos = c.to;
  }
  out += oldText.slice(pos);
  return out;
}

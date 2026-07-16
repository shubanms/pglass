// View helpers (Phase 16). Best-effort dependency detection: which tables a
// view's query reads from, found by matching table names as whole words in the
// (lower-cased) query text. Good enough to draw dashed dependency edges.
import type { Schema, TableId, View } from './types.ts';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Table ids referenced by a view's query (heuristic, whole-word match). */
export function viewDependencies(schema: Schema, view: View): TableId[] {
  const q = view.query.toLowerCase();
  const out: TableId[] = [];
  for (const t of schema.tables) {
    const re = new RegExp(`\\b${escapeRegExp(t.name.toLowerCase())}\\b`);
    if (re.test(q)) out.push(t.id);
  }
  return out;
}

export function viewById(schema: Schema, id: TableId | string): View | undefined {
  return schema.views.find((v) => v.id === id);
}

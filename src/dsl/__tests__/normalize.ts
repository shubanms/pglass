// Test helper: rewrite all generated IDs to deterministic sequential tokens so
// two independently-parsed schemas can be deep-compared. IDs are random by
// design (they survive renames), so they must be normalized away for equality.
import type { Schema } from '../../model/types.ts';

export function normalizeIds(schema: Schema): Schema {
  const map = new Map<string, string>();
  const counters: Record<string, number> = {};
  const remap = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    if (!map.has(id)) {
      const prefix = id.split('_')[0] ?? 'x';
      counters[prefix] = (counters[prefix] ?? 0) + 1;
      map.set(id, `${prefix}_${counters[prefix]}`);
    }
    return map.get(id);
  };

  // Deterministic assignment order: tables → columns, enums, groups, then rels.
  for (const t of schema.tables) {
    remap(t.id);
    for (const c of t.columns) remap(c.id);
  }
  for (const e of schema.enums) remap(e.id);
  for (const g of schema.groups) remap(g.id);
  for (const ix of schema.indexes) remap(ix.id);
  for (const r of schema.relationships) remap(r.id);
  for (const n of schema.notes) remap(n.id);

  const clone: Schema = structuredClone(schema);
  for (const t of clone.tables) {
    t.id = remap(t.id) as never;
    t.primaryKey = t.primaryKey.map((c) => remap(c) as never);
    if (t.groupId) t.groupId = remap(t.groupId) as never;
    for (const c of t.columns) {
      c.id = remap(c.id) as never;
      if (c.type.udtId) c.type.udtId = remap(c.type.udtId) as never;
    }
  }
  for (const e of clone.enums) e.id = remap(e.id) as never;
  for (const g of clone.groups) g.id = remap(g.id) as never;
  for (const ix of clone.indexes) {
    ix.id = remap(ix.id) as never;
    ix.table = remap(ix.table) as never;
    ix.keys = ix.keys.map((k) =>
      k.kind === 'column' ? { ...k, column: remap(k.column) as never } : k,
    );
    if (ix.include) ix.include = ix.include.map((c) => remap(c) as never);
  }
  for (const r of clone.relationships) {
    r.id = remap(r.id) as never;
    r.sourceTable = remap(r.sourceTable) as never;
    r.targetTable = remap(r.targetTable) as never;
    r.sourceColumns = r.sourceColumns.map((c) => remap(c) as never);
    r.targetColumns = r.targetColumns.map((c) => remap(c) as never);
  }
  for (const n of clone.notes) n.id = remap(n.id) as never;
  return clone;
}

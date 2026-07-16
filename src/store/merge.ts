// Identity reconciliation for the bidirectional sync loop. See PRD §8.
//
// When DSL text parses to a fresh schema, we must NOT wholesale-replace the
// live model — that would destroy pos/color/collapsed/groupId and all visual
// state the DSL doesn't encode. Instead we match entities by identity and carry
// visual state across, so renaming a table in text keeps its box in place.
import type {
  Column,
  ColumnId,
  EnumId,
  GroupId,
  Relationship,
  Schema,
  Table,
  TableId,
} from '../model/types.ts';

const RENAME_OVERLAP_THRESHOLD = 0.6;

function tableKey(t: Table): string {
  return `${t.namespace.toLowerCase()} ${t.name.toLowerCase()}`;
}

function columnNameSet(t: Table): Set<string> {
  return new Set(t.columns.map((c) => c.name.toLowerCase()));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Reconcile `next` (freshly parsed from text) against `prev` (the live model),
 * carrying visual state forward. The result is structurally `next` but keeps
 * stable ids and positions wherever an entity was matched.
 */
export function mergeSchema(prev: Schema, next: Schema): Schema {
  // ── Match tables ──
  const prevByKey = new Map<string, Table>();
  for (const t of prev.tables) prevByKey.set(tableKey(t), t);

  const tableIdRemap = new Map<TableId, TableId>(); // next.id → carried id
  const matchedPrev = new Set<string>();
  const unmatchedNext: Table[] = [];

  for (const nt of next.tables) {
    const prevT = prevByKey.get(tableKey(nt));
    if (prevT) {
      tableIdRemap.set(nt.id, prevT.id);
      matchedPrev.add(tableKey(prevT));
    } else {
      unmatchedNext.push(nt);
    }
  }

  // Rename detection: exactly one dropped + one added with ≥60% column overlap.
  const unmatchedPrev = prev.tables.filter((t) => !matchedPrev.has(tableKey(t)));
  if (unmatchedNext.length === 1 && unmatchedPrev.length === 1) {
    const nt = unmatchedNext[0]!;
    const pt = unmatchedPrev[0]!;
    if (jaccard(columnNameSet(nt), columnNameSet(pt)) >= RENAME_OVERLAP_THRESHOLD) {
      tableIdRemap.set(nt.id, pt.id);
      matchedPrev.add(tableKey(pt));
      unmatchedNext.length = 0;
    }
  }

  // ── Build carried tables + a global column-id remap (next id → carried id) ──
  const columnIdRemap = new Map<ColumnId, ColumnId>();
  const prevById = new Map<TableId, Table>();
  for (const t of prev.tables) prevById.set(t.id, t);

  let placeX = prev.tables.length
    ? Math.max(...prev.tables.map((t) => t.pos.x + (t.size?.w ?? 240))) + 80
    : 40;
  let placeY = 40;

  const carriedTables: Table[] = next.tables.map((nt) => {
    const carriedId = tableIdRemap.get(nt.id);
    const prevT = carriedId ? prevById.get(carriedId) : undefined;
    if (prevT && carriedId) {
      return mergeTable(prevT, nt, carriedId, columnIdRemap);
    }
    // genuinely new → auto-place; ids stay as parsed
    for (const c of nt.columns) columnIdRemap.set(c.id, c.id);
    const placed: Table = { ...nt, pos: { x: placeX, y: placeY } };
    placeY += 220;
    if (placeY > 40 + 220 * 4) {
      placeY = 40;
      placeX += 320;
    }
    return placed;
  });

  // ── Relationships: remap endpoints + columns, reattach waypoints/color ──
  const prevRelByKey = new Map<string, Relationship>();
  for (const pr of prev.relationships) prevRelByKey.set(relVisualKey(prev, pr), pr);

  const carriedRels: Relationship[] = next.relationships.map((r) => {
    const remapped: Relationship = {
      ...r,
      sourceTable: tableIdRemap.get(r.sourceTable) ?? r.sourceTable,
      targetTable: tableIdRemap.get(r.targetTable) ?? r.targetTable,
      sourceColumns: r.sourceColumns.map((c) => columnIdRemap.get(c) ?? c),
      targetColumns: r.targetColumns.map((c) => columnIdRemap.get(c) ?? c),
    };
    const carried: Schema = { ...next, tables: carriedTables, relationships: [] };
    const prevRel = prevRelByKey.get(relVisualKey(carried, remapped));
    if (prevRel) {
      if (prevRel.waypoints) remapped.waypoints = prevRel.waypoints;
      if (prevRel.color && !remapped.color) remapped.color = prevRel.color;
    }
    return remapped;
  });

  // ── Indexes: remap table + key columns ──
  const carriedIndexes = next.indexes.map((ix) => ({
    ...ix,
    table: tableIdRemap.get(ix.table) ?? ix.table,
    keys: ix.keys.map((k) =>
      k.kind === 'column' ? { ...k, column: columnIdRemap.get(k.column) ?? k.column } : k,
    ),
    include: ix.include?.map((c) => columnIdRemap.get(c) ?? c),
  }));

  // ── Enums: carry position/color/id by (namespace, name) ──
  const enumIdRemap = new Map<EnumId, EnumId>();
  const carriedEnums = next.enums.map((ne) => {
    const pe = prev.enums.find(
      (e) =>
        e.namespace.toLowerCase() === ne.namespace.toLowerCase() &&
        e.name.toLowerCase() === ne.name.toLowerCase(),
    );
    if (!pe) return ne;
    enumIdRemap.set(ne.id, pe.id);
    return { ...ne, id: pe.id, pos: pe.pos ?? ne.pos, color: ne.color ?? pe.color };
  });
  // Re-point column udtIds that referenced next's enum ids.
  for (const t of carriedTables) {
    for (const c of t.columns) {
      if (c.type.udtId && enumIdRemap.has(c.type.udtId)) {
        c.type = { ...c.type, udtId: enumIdRemap.get(c.type.udtId) };
      }
    }
  }

  // ── Views: carry position/color/id by (namespace, name) ──
  const carriedViews = next.views.map((nv) => {
    const pv = prev.views.find(
      (v) =>
        v.namespace.toLowerCase() === nv.namespace.toLowerCase() &&
        v.name.toLowerCase() === nv.name.toLowerCase(),
    );
    if (!pv) return nv;
    return { ...nv, id: pv.id, pos: pv.pos ?? nv.pos, color: nv.color ?? pv.color };
  });

  // ── Groups: carry id/collapsed by name, re-point table.groupId ──
  const groupIdRemap = new Map<GroupId, GroupId>();
  const carriedGroups = next.groups.map((ng) => {
    const pg = prev.groups.find((g) => g.name.toLowerCase() === ng.name.toLowerCase());
    if (!pg) return ng;
    groupIdRemap.set(ng.id, pg.id);
    return { ...ng, id: pg.id, collapsed: pg.collapsed };
  });
  for (const t of carriedTables) {
    if (t.groupId && groupIdRemap.has(t.groupId)) t.groupId = groupIdRemap.get(t.groupId);
  }

  return {
    ...next,
    tables: carriedTables,
    relationships: carriedRels,
    indexes: carriedIndexes,
    enums: carriedEnums,
    views: carriedViews,
    groups: carriedGroups,
    notes: mergeNotes(prev, next),
    meta: { ...next.meta, createdAt: prev.meta.createdAt },
  };
}

function mergeTable(
  prevT: Table,
  nextT: Table,
  carriedId: TableId,
  columnIdRemap: Map<ColumnId, ColumnId>,
): Table {
  const prevByName = new Map<string, Column>();
  for (const c of prevT.columns) prevByName.set(c.name.toLowerCase(), c);

  const usedPrev = new Set<string>();
  let columns: Column[] = nextT.columns.map((nc) => {
    const pc = prevByName.get(nc.name.toLowerCase());
    if (pc) {
      usedPrev.add(nc.name.toLowerCase());
      columnIdRemap.set(nc.id, pc.id);
      return { ...nc, id: pc.id, color: nc.color ?? pc.color };
    }
    columnIdRemap.set(nc.id, nc.id);
    return nc;
  });

  // Column rename detection: exactly one dropped + one added.
  const droppedPrev = prevT.columns.filter((c) => !usedPrev.has(c.name.toLowerCase()));
  const added = columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !prevByName.has(c.name.toLowerCase()));
  if (droppedPrev.length === 1 && added.length === 1) {
    const pc = droppedPrev[0]!;
    const { c: nc, i } = added[0]!;
    columnIdRemap.set(nc.id, pc.id);
    columns = columns.map((c, idx) => (idx === i ? { ...c, id: pc.id } : c));
  }

  const primaryKey = nextT.primaryKey.map((id) => columnIdRemap.get(id) ?? id);

  return {
    ...nextT,
    id: carriedId,
    columns,
    primaryKey,
    pos: prevT.pos,
    size: prevT.size,
    color: nextT.color ?? prevT.color,
    collapsed: prevT.collapsed,
    groupId: nextT.groupId ?? prevT.groupId,
    showAsMN: prevT.showAsMN,
  };
}

/** A rename-stable key for reattaching a relationship's visual state. */
function relVisualKey(schema: Schema, r: Relationship): string {
  const src = schema.tables.find((t) => t.id === r.sourceTable);
  const tgt = schema.tables.find((t) => t.id === r.targetTable);
  const srcCols = r.sourceColumns
    .map((id) => src?.columns.find((c) => c.id === id)?.name.toLowerCase() ?? String(id))
    .sort()
    .join(',');
  const srcName = src ? tableKey(src) : String(r.sourceTable);
  const tgtName = tgt ? tableKey(tgt) : String(r.targetTable);
  return `${srcName}|${srcCols}|${tgtName}`;
}

function mergeNotes(prev: Schema, next: Schema): Schema['notes'] {
  return next.notes.map((n, i) => {
    const pn = prev.notes[i];
    return pn ? { ...n, id: pn.id, pos: pn.pos, size: pn.size, color: pn.color } : n;
  });
}

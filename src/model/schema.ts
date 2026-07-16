// Schema construction helpers and lookups. Pure data — no React, no DOM.
import type {
  Column,
  ColumnId,
  EnumId,
  EnumType,
  Index,
  Relationship,
  Schema,
  Table,
  TableId,
} from './types.ts';

/** A fresh, empty schema. `createdAt`/`updatedAt` are passed in so the model
 *  layer stays free of ambient clock reads (keeps it deterministic to test). */
export function emptySchema(name = 'untitled', now = '1970-01-01T00:00:00.000Z'): Schema {
  return {
    version: 1,
    name,
    tables: [],
    relationships: [],
    indexes: [],
    enums: [],
    views: [],
    notes: [],
    groups: [],
    namespaces: ['public'],
    meta: { createdAt: now, updatedAt: now },
  };
}

// ─── Lookups ────────────────────────────────────────────────────────────

export function tableById(schema: Schema, id: TableId): Table | undefined {
  return schema.tables.find((t) => t.id === id);
}

export function tableByName(schema: Schema, namespace: string, name: string): Table | undefined {
  const ns = namespace.toLowerCase();
  const nm = name.toLowerCase();
  return schema.tables.find((t) => t.namespace.toLowerCase() === ns && t.name.toLowerCase() === nm);
}

export function columnById(table: Table, id: ColumnId): Column | undefined {
  return table.columns.find((c) => c.id === id);
}

export function columnByName(table: Table, name: string): Column | undefined {
  const nm = name.toLowerCase();
  return table.columns.find((c) => c.name.toLowerCase() === nm);
}

export function enumById(schema: Schema, id: EnumId): EnumType | undefined {
  return schema.enums.find((e) => e.id === id);
}

export function enumByName(schema: Schema, namespace: string, name: string): EnumType | undefined {
  const ns = namespace.toLowerCase();
  const nm = name.toLowerCase();
  return schema.enums.find((e) => e.namespace.toLowerCase() === ns && e.name.toLowerCase() === nm);
}

export function indexesForTable(schema: Schema, id: TableId): Index[] {
  return schema.indexes.filter((ix) => ix.table === id);
}

/** All relationships where the table is either the FK holder or the referenced. */
export function relsForTable(schema: Schema, id: TableId): Relationship[] {
  return schema.relationships.filter((r) => r.sourceTable === id || r.targetTable === id);
}

/** Columns that hold a foreign key (appear in some relationship's source). */
export function fkColumnIds(schema: Schema, tableId: TableId): Set<ColumnId> {
  const out = new Set<ColumnId>();
  for (const r of schema.relationships) {
    if (r.sourceTable === tableId) for (const c of r.sourceColumns) out.add(c);
  }
  return out;
}

/**
 * Does `columns` (as an ordered set) exactly match the target's PK, or is it
 * covered by a UNIQUE constraint / unique index on the target? Used to derive
 * cardinality and to validate FK targets (invariant §4.1.3).
 */
export function columnsAreUnique(schema: Schema, table: Table, columns: ColumnId[]): boolean {
  if (columns.length === 0) return false;
  const set = new Set(columns);

  // Exact PK match (as a set — order doesn't affect uniqueness).
  if (table.primaryKey.length === columns.length && table.primaryKey.every((c) => set.has(c))) {
    return true;
  }

  // Single-column UNIQUE flag.
  if (columns.length === 1) {
    const col = table.columns.find((c) => c.id === columns[0]);
    if (col?.unique) return true;
  }

  // A UNIQUE index whose key columns are exactly this set.
  for (const ix of indexesForTable(schema, table.id)) {
    if (!ix.unique) continue;
    const keyCols = ix.keys
      .filter((k): k is Extract<typeof k, { kind: 'column' }> => k.kind === 'column')
      .map((k) => k.column);
    if (keyCols.length !== ix.keys.length) continue; // expression index — skip
    if (keyCols.length === columns.length && keyCols.every((c) => set.has(c))) {
      return true;
    }
  }
  return false;
}

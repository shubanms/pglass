import { relsForTable } from './schema.ts';
// Many-to-many junction detection (PRD §12.3). A junction table is a pure
// link table: exactly two foreign keys, a primary key that is exactly the union
// of those FK columns, and at most two other (payload) columns. Such a table can
// be collapsed on the canvas into a single dashed M:N edge between its parents.
import type { Relationship, Schema, Table, TableId } from './types.ts';

export interface Junction {
  table: Table;
  /** the two FK relationships (source = this junction) */
  relA: Relationship;
  relB: Relationship;
  parentA: TableId;
  parentB: TableId;
  /** count of non-key payload columns (0–2) */
  extraColumns: number;
}

/** Returns junction metadata if `table` is a link table, else null. */
export function detectJunction(schema: Schema, table: Table): Junction | null {
  // exactly two FKs whose source is this table
  const fks = relsForTable(schema, table.id).filter((r) => r.sourceTable === table.id);
  if (fks.length !== 2) return null;
  const [relA, relB] = fks as [Relationship, Relationship];
  // both single-column FKs to two *different* parents (not self-referential)
  if (relA.targetTable === relB.targetTable) return null;
  if (relA.targetTable === table.id || relB.targetTable === table.id) return null;

  // PK must be exactly the union of the two FK column sets
  const fkCols = new Set([...relA.sourceColumns, ...relB.sourceColumns]);
  const pk = new Set(table.primaryKey);
  if (pk.size !== fkCols.size) return null;
  for (const c of pk) if (!fkCols.has(c)) return null;

  // at most two payload columns beyond the key
  const extraColumns = table.columns.length - fkCols.size;
  if (extraColumns < 0 || extraColumns > 2) return null;

  return {
    table,
    relA,
    relB,
    parentA: relA.targetTable,
    parentB: relB.targetTable,
    extraColumns,
  };
}

/** Whether `table` qualifies as a junction (for the subtle N:M badge). */
export function isJunction(schema: Schema, table: Table): boolean {
  return detectJunction(schema, table) !== null;
}

/** All junction tables in the schema. */
export function junctions(schema: Schema): Junction[] {
  const out: Junction[] = [];
  for (const t of schema.tables) {
    const j = detectJunction(schema, t);
    if (j) out.push(j);
  }
  return out;
}

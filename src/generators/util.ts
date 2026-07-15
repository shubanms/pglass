// Shared helpers for the code generators (PRD §11). Every generator is a pure
// (schema, opts) => string. This module holds naming utilities, relationship
// lookups, and the FK-aware topological ordering the ORM/seed generators need.
import { graphTopoOrder } from '../lib/graph.ts';
import type {
  Column,
  ColumnId,
  EnumType,
  Relationship,
  Schema,
  Table,
  TableId,
} from '../model/types.ts';

export function pascalCase(s: string): string {
  return s
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

export function camelCase(s: string): string {
  const p = pascalCase(s);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

/** Naive singularization for entity names (users → User, categories → Category).
 *  Guards against words that merely end in "s" (status, address, axis, bonus). */
export function singular(s: string): string {
  if (/ies$/i.test(s)) return s.replace(/ies$/i, 'y');
  if (/(us|ss|is|os)$/i.test(s)) return s; // status, class, axis, bonus
  if (/(x|z|ch|sh)es$/i.test(s)) return s.replace(/es$/i, '');
  if (/s$/i.test(s)) return s.replace(/s$/i, '');
  return s;
}

/** Enum type name for target languages — enums are NOT singularized. */
export function enumTypeName(name: string): string {
  return pascalCase(name);
}

/** In Postgres a primary-key column is implicitly NOT NULL even when the model
 *  doesn't store the flag. Generators use this for nullability. */
export function effectiveNotNull(table: Table, col: Column): boolean {
  return col.notNull || isPk(table, col);
}

export function isPk(table: Table, col: Column): boolean {
  return table.primaryKey.includes(col.id);
}

export function fkForColumn(schema: Schema, table: Table, col: Column): Relationship | undefined {
  return schema.relationships.find(
    (r) =>
      r.sourceTable === table.id && r.sourceColumns.length === 1 && r.sourceColumns[0] === col.id,
  );
}

export function fksFrom(schema: Schema, tableId: TableId): Relationship[] {
  return schema.relationships.filter((r) => r.sourceTable === tableId);
}

export function fksTo(schema: Schema, tableId: TableId): Relationship[] {
  return schema.relationships.filter((r) => r.targetTable === tableId);
}

export function tableOf(schema: Schema, id: TableId): Table | undefined {
  return schema.tables.find((t) => t.id === id);
}

export function columnOf(table: Table, id: ColumnId): Column | undefined {
  return table.columns.find((c) => c.id === id);
}

export function enumOf(schema: Schema, col: Column): EnumType | undefined {
  if (col.type.udtId) return schema.enums.find((e) => e.id === col.type.udtId);
  return schema.enums.find((e) => e.name.toLowerCase() === col.type.name.toLowerCase());
}

/** Columns whose value is auto-produced (identity or generated) — omitted from
 *  insert/create shapes in Zod, seed, etc. */
export function isAutoColumn(col: Column): boolean {
  return col.identity !== 'none' || col.generated.kind === 'stored';
}

export function hasDefault(col: Column): boolean {
  return col.default !== undefined || isAutoColumn(col);
}

/**
 * Tables in FK-dependency order (parents before children). Ties broken by the
 * schema's declared order for determinism. Returns cycle edges too, so callers
 * (seed) can break them.
 */
export function topoTables(schema: Schema): { order: Table[]; cyclic: boolean } {
  const ids = schema.tables.map((t) => t.id);
  const edges: [TableId, TableId][] = [];
  for (const r of schema.relationships) {
    if (r.sourceTable !== r.targetTable) edges.push([r.targetTable, r.sourceTable]); // parent → child
  }
  const { order, cyclic } = graphTopoOrder(ids, edges);
  const byId = new Map(schema.tables.map((t) => [t.id, t] as const));
  return { order: order.map((id) => byId.get(id)!).filter(Boolean), cyclic };
}

/** A stable, human-readable relationship name for the "many" side. */
export function relFieldName(schema: Schema, rel: Relationship): string {
  const src = tableOf(schema, rel.sourceTable);
  return src ? src.name : 'related';
}

export interface GenOptions {
  /** rows per table for the seed generator */
  rows?: number;
}

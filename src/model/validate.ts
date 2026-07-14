// Structural validation of a Schema (NOT linting — see src/lint for that).
// PRD §4.1: invariants 1, 4, 5, 6, 9 are "structural corruption" and throw;
// the rest surface as Diagnostics.
import { columnsAreUnique } from './schema.ts';
import type { Diagnostic, Schema } from './types.ts';

export class SchemaCorruptionError extends Error {
  constructor(message: string) {
    super(`Schema corruption: ${message}`);
    this.name = 'SchemaCorruptionError';
  }
}

/**
 * Validate a schema. Throws SchemaCorruptionError on invariants 1/4/5/6/9.
 * Returns Diagnostics for the softer invariants (2/3/7/8/10).
 * Intended to run on every mutation in dev.
 */
export function validate(schema: Schema): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // Build a table-id → column-id set for cross-references (invariant 1).
  const columnOwner = new Map<string, string>(); // columnId → tableId
  for (const table of schema.tables) {
    const seenCols = new Set<string>(); // lower-cased names (invariant 4)
    for (const col of table.columns) {
      const key = col.name.toLowerCase();
      if (seenCols.has(key)) {
        throw new SchemaCorruptionError(
          `duplicate column "${col.name}" in table ${table.namespace}.${table.name}`,
        );
      }
      seenCols.add(key);
      columnOwner.set(col.id, table.id);
    }
  }

  // Invariant 5: table names unique within a namespace.
  const seenTables = new Set<string>();
  for (const table of schema.tables) {
    const key = `${table.namespace.toLowerCase()}.${table.name.toLowerCase()}`;
    if (seenTables.has(key)) {
      throw new SchemaCorruptionError(`duplicate table ${key}`);
    }
    seenTables.add(key);
  }

  // Invariant 6: PK entries belong to the table, no duplicates.
  for (const table of schema.tables) {
    const own = new Set(table.columns.map((c) => c.id));
    const seenPk = new Set<string>();
    for (const cid of table.primaryKey) {
      if (!own.has(cid)) {
        throw new SchemaCorruptionError(
          `primary key of ${table.name} references unknown column ${cid}`,
        );
      }
      if (seenPk.has(cid)) {
        throw new SchemaCorruptionError(`duplicate PK column ${cid} in ${table.name}`);
      }
      seenPk.add(cid);
    }
  }

  // Invariant 9: index keys reference columns of Index.table.
  for (const ix of schema.indexes) {
    const table = schema.tables.find((t) => t.id === ix.table);
    if (!table) {
      throw new SchemaCorruptionError(`index ${ix.id} references unknown table ${ix.table}`);
    }
    const own = new Set(table.columns.map((c) => c.id));
    for (const key of ix.keys) {
      if (key.kind === 'column' && !own.has(key.column)) {
        throw new SchemaCorruptionError(
          `index ${ix.name ?? ix.id} references column ${key.column} not in ${table.name}`,
        );
      }
    }
    for (const inc of ix.include ?? []) {
      if (!own.has(inc)) {
        throw new SchemaCorruptionError(
          `index ${ix.name ?? ix.id} INCLUDE references column ${inc} not in ${table.name}`,
        );
      }
    }
  }

  // ── Soft invariants → diagnostics ──

  for (const rel of schema.relationships) {
    // Invariant 2: matched, non-empty column lists.
    if (rel.sourceColumns.length === 0 || rel.sourceColumns.length !== rel.targetColumns.length) {
      diags.push({
        severity: 'error',
        code: 'PGL010',
        message: 'Foreign key source and target column counts must match and be non-empty',
        target: { kind: 'rel', id: rel.id },
      });
      continue;
    }

    // Invariant 1 (soft side): referenced columns resolve.
    const badSource = rel.sourceColumns.some((c) => columnOwner.get(c) !== rel.sourceTable);
    const badTarget = rel.targetColumns.some((c) => columnOwner.get(c) !== rel.targetTable);
    if (badSource || badTarget) {
      throw new SchemaCorruptionError(
        `relationship ${rel.id} references columns not on the stated tables`,
      );
    }

    // Invariant 7: no self-FK to identical columns.
    if (
      rel.sourceTable === rel.targetTable &&
      rel.sourceColumns.length === rel.targetColumns.length &&
      rel.sourceColumns.every((c, i) => c === rel.targetColumns[i])
    ) {
      diags.push({
        severity: 'error',
        code: 'PGL_SELF_FK',
        message: 'A foreign key cannot reference the same columns on the same table',
        target: { kind: 'rel', id: rel.id },
      });
    }

    // Invariant 3: target columns must be PK or unique on the target.
    const target = schema.tables.find((t) => t.id === rel.targetTable);
    if (target && !columnsAreUnique(schema, target, rel.targetColumns)) {
      diags.push({
        severity: 'error',
        code: 'PGL201',
        message: `Foreign key target columns are not a primary key or unique constraint on ${target.name}`,
        target: { kind: 'rel', id: rel.id },
      });
    }
  }

  // Invariant 8: enum values non-empty and unique.
  for (const en of schema.enums) {
    const seen = new Set<string>();
    for (const v of en.values) {
      if (v.length === 0) {
        diags.push({
          severity: 'error',
          code: 'PGL_ENUM_EMPTY',
          message: `Enum ${en.name} has an empty value`,
          target: { kind: 'enum', id: en.id },
        });
      }
      if (seen.has(v)) {
        diags.push({
          severity: 'error',
          code: 'PGL012',
          message: `Enum ${en.name} has a duplicate value "${v}"`,
          target: { kind: 'enum', id: en.id },
        });
      }
      seen.add(v);
    }
  }

  return diags;
}

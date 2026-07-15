// Performance lint rules (PRD §10) — warnings.
import { newIndexId } from '../../model/ids.ts';
import { fkColumnIds, indexesForTable } from '../../model/schema.ts';
import type { Column, Diagnostic, Schema, Table } from '../../model/types.ts';
import type { LintRule } from '../types.ts';

const PRICE_RE = /price|amount|cost|total|balance|fee/i;

function columnHasIndex(schema: Schema, table: Table, col: Column): boolean {
  if (table.primaryKey[0] === col.id) return true;
  for (const ix of indexesForTable(schema, table.id)) {
    const first = ix.keys[0];
    if (first?.kind === 'column' && first.column === col.id) return true;
  }
  return false;
}

const L101: LintRule = {
  code: 'L101',
  name: 'FK column has no index',
  category: 'performance',
  severity: 'warning',
  description: 'A foreign-key column without an index makes every parent DELETE a sequential scan.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      const fks = fkColumnIds(schema, t.id);
      for (const col of t.columns) {
        if (!fks.has(col.id)) continue;
        if (!columnHasIndex(schema, t, col)) {
          out.push({
            severity: 'warning',
            code: 'L101',
            message: `FK column "${t.name}.${col.name}" has no index`,
            target: { kind: 'column', table: t.id, id: col.id },
            fix: {
              title: 'Create an index on the FK column',
              apply: (s) => addIndex(s, t.id, col.id, `${t.name}_${col.name}_idx`),
            },
          });
        }
      }
    }
    return out;
  },
};

const L104: LintRule = {
  code: 'L104',
  name: 'varchar(n) where text would do',
  category: 'performance',
  severity: 'warning',
  description: 'Postgres has no performance benefit from varchar(n); text avoids future rewrites.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      for (const c of t.columns) {
        if (c.type.name === 'varchar' && c.type.args.length) {
          out.push({
            severity: 'warning',
            code: 'L104',
            message: `"${t.name}.${c.name}" uses varchar(${c.type.args[0]}); prefer text`,
            target: { kind: 'column', table: t.id, id: c.id },
            fix: {
              title: 'Change to text',
              apply: (s) => patchColumnType(s, t.id, c.id, 'text'),
            },
          });
        }
      }
    }
    return out;
  },
};

const L105: LintRule = {
  code: 'L105',
  name: 'char(n) used',
  category: 'performance',
  severity: 'warning',
  description: 'char(n) is blank-padded and almost always the wrong choice in Postgres.',
  defaultOn: true,
  check: (schema) =>
    simpleColumnRule(
      schema,
      (c) => c.type.name === 'char',
      'L105',
      (t, c) => `"${t.name}.${c.name}" uses char(n); prefer text or varchar`,
    ),
};

const L106: LintRule = {
  code: 'L106',
  name: 'timestamp without time zone',
  category: 'performance',
  severity: 'warning',
  description: 'Prefer timestamptz — timestamp without time zone drops offset information.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      for (const c of t.columns) {
        if (c.type.name === 'timestamp') {
          out.push({
            severity: 'warning',
            code: 'L106',
            message: `"${t.name}.${c.name}" is timestamp without time zone; prefer timestamptz`,
            target: { kind: 'column', table: t.id, id: c.id },
            fix: {
              title: 'Change to timestamptz',
              apply: (s) => patchColumnType(s, t.id, c.id, 'timestamptz'),
            },
          });
        }
      }
    }
    return out;
  },
};

const L107: LintRule = {
  code: 'L107',
  name: 'money type used',
  category: 'performance',
  severity: 'warning',
  description: 'The money type has locale/precision pitfalls; prefer numeric or integer cents.',
  defaultOn: true,
  check: (schema) =>
    simpleColumnRule(
      schema,
      (c) => c.type.name === 'money',
      'L107',
      (t, c) => `"${t.name}.${c.name}" uses money; prefer numeric or integer cents`,
    ),
};

const L103: LintRule = {
  code: 'L103',
  name: 'Too many indexes',
  category: 'performance',
  severity: 'warning',
  description: 'A table with more than 8 indexes suffers write amplification.',
  defaultOn: true,
  check(schema) {
    return schema.tables
      .filter((t) => indexesForTable(schema, t.id).length > 8)
      .map((t) => ({
        severity: 'warning' as const,
        code: 'L103',
        message: `Table "${t.name}" has ${indexesForTable(schema, t.id).length} indexes (> 8) — write amplification`,
        target: { kind: 'table' as const, id: t.id },
      }));
  },
};

const L108: LintRule = {
  code: 'L108',
  name: 'Float type on a money-like column',
  category: 'performance',
  severity: 'warning',
  description: 'Never use float/real/double for currency — use numeric or integer cents.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    const floats = new Set(['real', 'double precision']);
    for (const t of schema.tables) {
      for (const c of t.columns) {
        if (floats.has(c.type.name) && PRICE_RE.test(c.name)) {
          out.push({
            severity: 'warning',
            code: 'L108',
            message: `"${t.name}.${c.name}" stores money-like data as a float; use numeric or integer cents`,
            target: { kind: 'column', table: t.id, id: c.id },
          });
        }
      }
    }
    return out;
  },
};

export const PERFORMANCE_RULES: LintRule[] = [L101, L103, L104, L105, L106, L107, L108];

// ── helpers ──
function simpleColumnRule(
  schema: Schema,
  pred: (c: Column) => boolean,
  code: string,
  msg: (t: Table, c: Column) => string,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const t of schema.tables) {
    for (const c of t.columns) {
      if (pred(c)) {
        out.push({
          severity: 'warning',
          code,
          message: msg(t, c),
          target: { kind: 'column', table: t.id, id: c.id },
        });
      }
    }
  }
  return out;
}

function patchColumnType(schema: Schema, tableId: string, colId: string, typeName: string): Schema {
  return {
    ...schema,
    tables: schema.tables.map((t) =>
      t.id === tableId
        ? {
            ...t,
            columns: t.columns.map((c) =>
              c.id === colId ? { ...c, type: { name: typeName, args: [], arrayDims: 0 } } : c,
            ),
          }
        : t,
    ),
  };
}

function addIndex(schema: Schema, tableId: string, colId: string, name: string): Schema {
  return {
    ...schema,
    indexes: [
      ...schema.indexes,
      {
        id: newIndexId(),
        table: tableId as never,
        name,
        unique: false,
        method: 'btree' as const,
        keys: [{ kind: 'column' as const, column: colId as never }],
      },
    ],
  };
}

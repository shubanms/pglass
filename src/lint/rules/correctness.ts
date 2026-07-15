import { typeStr } from '../../dsl/printer.ts';
import { hasCycle } from '../../lib/graph.ts';
// Correctness lint rules (PRD §10) — errors by default.
import { newColumnId } from '../../model/ids.ts';
import { columnsAreUnique, indexesForTable } from '../../model/schema.ts';
import type { Diagnostic, Index, Schema, Table } from '../../model/types.ts';
import type { LintRule } from '../types.ts';

const colName = (t: Table, id: string) => t.columns.find((c) => c.id === id)?.name ?? '?';

const L001: LintRule = {
  code: 'L001',
  name: 'Table has no primary key',
  category: 'correctness',
  severity: 'error',
  description: 'Every table should have a primary key.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      if (t.primaryKey.length === 0) {
        out.push({
          severity: 'error',
          code: 'L001',
          message: `Table "${t.name}" has no primary key`,
          target: { kind: 'table', id: t.id },
          fix: {
            title: 'Add an id bigint primary key',
            apply: (s) => addIdPk(s, t.id),
          },
        });
      }
    }
    return out;
  },
};

const L002: LintRule = {
  code: 'L002',
  name: 'FK references a non-unique column',
  category: 'correctness',
  severity: 'error',
  description: 'A foreign key must reference a primary key or a uniquely-indexed column.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const r of schema.relationships) {
      const target = schema.tables.find((t) => t.id === r.targetTable);
      if (target && !columnsAreUnique(schema, target, r.targetColumns)) {
        out.push({
          severity: 'error',
          code: 'L002',
          message: `Foreign key references ${target.name}(${r.targetColumns.map((c) => colName(target, c)).join(', ')}) which is not a primary key or unique`,
          target: { kind: 'rel', id: r.id },
        });
      }
    }
    return out;
  },
};

const L003: LintRule = {
  code: 'L003',
  name: 'FK column type mismatch',
  category: 'correctness',
  severity: 'error',
  description: 'A foreign key column must have the same type as the column it references.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const r of schema.relationships) {
      const src = schema.tables.find((t) => t.id === r.sourceTable);
      const tgt = schema.tables.find((t) => t.id === r.targetTable);
      if (!src || !tgt) continue;
      for (let i = 0; i < r.sourceColumns.length; i++) {
        const sc = src.columns.find((c) => c.id === r.sourceColumns[i]);
        const tc = tgt.columns.find((c) => c.id === r.targetColumns[i]);
        if (sc && tc && !typesCompatible(typeStr(sc.type), typeStr(tc.type))) {
          out.push({
            severity: 'error',
            code: 'L003',
            message: `FK ${src.name}.${sc.name} (${typeStr(sc.type)}) does not match ${tgt.name}.${tc.name} (${typeStr(tc.type)})`,
            target: { kind: 'column', table: src.id, id: sc.id },
          });
        }
      }
    }
    return out;
  },
};

const L005: LintRule = {
  code: 'L005',
  name: 'Uninsertable circular FK dependency',
  category: 'correctness',
  severity: 'error',
  description: 'A cycle of all-NOT NULL foreign keys can never be inserted into.',
  defaultOn: true,
  check(schema) {
    // Build the FK graph over NOT NULL edges only.
    const edges: [string, string][] = [];
    for (const r of schema.relationships) {
      const src = schema.tables.find((t) => t.id === r.sourceTable);
      const allNotNull =
        !!src && r.sourceColumns.every((id) => src.columns.find((c) => c.id === id)?.notNull);
      if (allNotNull && r.sourceTable !== r.targetTable) edges.push([r.sourceTable, r.targetTable]);
    }
    if (
      !hasCycle(
        schema.tables.map((t) => t.id),
        edges,
      )
    )
      return [];
    return [
      {
        severity: 'error',
        code: 'L005',
        message:
          'Circular foreign-key dependency with all-NOT NULL columns is uninsertable — make one edge nullable or deferrable',
      },
    ];
  },
};

const L006: LintRule = {
  code: 'L006',
  name: 'Nullable primary-key column',
  category: 'correctness',
  severity: 'error',
  description: 'A primary-key column cannot be nullable.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      for (const cid of t.primaryKey) {
        const c = t.columns.find((x) => x.id === cid);
        if (c && !c.notNull) {
          out.push({
            severity: 'error',
            code: 'L006',
            message: `Primary-key column "${t.name}.${c.name}" is nullable`,
            target: { kind: 'column', table: t.id, id: c.id },
            fix: {
              title: 'Mark NOT NULL',
              apply: (s) => patchColumn(s, t.id, c.id, { notNull: true }),
            },
          });
        }
      }
    }
    return out;
  },
};

const L007: LintRule = {
  code: 'L007',
  name: 'Unused enum',
  category: 'correctness',
  severity: 'warning',
  description: 'An enum type is declared but never used by any column.',
  defaultOn: true,
  check(schema) {
    const used = new Set<string>();
    for (const t of schema.tables) {
      for (const c of t.columns) {
        if (c.type.udtId) used.add(c.type.udtId);
        const byName = schema.enums.find((e) => e.name.toLowerCase() === c.type.name.toLowerCase());
        if (byName) used.add(byName.id);
      }
    }
    return schema.enums
      .filter((e) => !used.has(e.id))
      .map((e) => ({
        severity: 'warning' as const,
        code: 'L007',
        message: `Enum "${e.name}" is declared but never used`,
        target: { kind: 'enum' as const, id: e.id },
      }));
  },
};

const L008: LintRule = {
  code: 'L008',
  name: 'Duplicate index',
  category: 'correctness',
  severity: 'warning',
  description: 'Two indexes cover the same columns with the same method and predicate.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      const seen = new Map<string, Index>();
      for (const ix of indexesForTable(schema, t.id)) {
        const key = indexSig(t, ix);
        const prev = seen.get(key);
        if (prev) {
          out.push({
            severity: 'warning',
            code: 'L008',
            message: `Index "${ix.name ?? '(unnamed)'}" duplicates "${prev.name ?? '(unnamed)'}" on ${t.name}`,
            target: { kind: 'index', id: ix.id },
            fix: { title: 'Drop the duplicate index', apply: (s) => dropIndex(s, ix.id) },
          });
        } else {
          seen.set(key, ix);
        }
      }
    }
    return out;
  },
};

const L009: LintRule = {
  code: 'L009',
  name: 'Redundant prefix index',
  category: 'correctness',
  severity: 'warning',
  description: 'An index whose columns are a leading prefix of another index is redundant.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      const idxs = indexesForTable(schema, t.id).filter((ix) => !ix.unique);
      const cols = (ix: Index) =>
        ix.keys.map((k) => (k.kind === 'column' ? colName(t, k.column) : `\`${k.expr}\``));
      for (const a of idxs) {
        for (const b of idxs) {
          if (a === b) continue;
          const ca = cols(a);
          const cb = cols(b);
          if (ca.length < cb.length && ca.every((c, i) => c === cb[i]) && a.method === b.method) {
            out.push({
              severity: 'warning',
              code: 'L009',
              message: `Index "${a.name ?? '(unnamed)'}" is a prefix of "${b.name ?? '(unnamed)'}" and is redundant`,
              target: { kind: 'index', id: a.id },
              fix: { title: 'Drop the redundant index', apply: (s) => dropIndex(s, a.id) },
            });
          }
        }
      }
    }
    return out;
  },
};

export const CORRECTNESS_RULES: LintRule[] = [L001, L002, L003, L005, L006, L007, L008, L009];

// ── helpers ──
function indexSig(t: Table, ix: Index): string {
  const keys = ix.keys.map((k) => (k.kind === 'column' ? colName(t, k.column) : k.expr)).join(',');
  return `${ix.unique}|${ix.method}|${keys}|${ix.where ?? ''}`;
}

function typesCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  // integer families are FK-compatible in practice (serial normalizes to int)
  const fam = (t: string) => (['smallint', 'integer', 'bigint'].includes(t) ? 'int' : t);
  return fam(a) === fam(b);
}

function addIdPk(schema: Schema, tableId: string): Schema {
  return {
    ...schema,
    tables: schema.tables.map((t) => {
      if (t.id !== tableId) return t;
      const id = newColumnId();
      return {
        ...t,
        columns: [
          {
            id,
            name: uniqueName(t, 'id'),
            type: { name: 'bigint', args: [], arrayDims: 0 },
            notNull: true,
            unique: false,
            identity: 'by_default' as const,
            generated: { kind: 'none' as const },
          },
          ...t.columns,
        ],
        primaryKey: [id],
      };
    }),
  };
}

function patchColumn(schema: Schema, tableId: string, colId: string, patch: object): Schema {
  return {
    ...schema,
    tables: schema.tables.map((t) =>
      t.id === tableId
        ? { ...t, columns: t.columns.map((c) => (c.id === colId ? { ...c, ...patch } : c)) }
        : t,
    ),
  };
}

function dropIndex(schema: Schema, indexId: string): Schema {
  return { ...schema, indexes: schema.indexes.filter((ix) => ix.id !== indexId) };
}

function uniqueName(t: Table, base: string): string {
  let name = base;
  let n = 1;
  while (t.columns.some((c) => c.name.toLowerCase() === name.toLowerCase()))
    name = `${base}_${++n}`;
  return name;
}

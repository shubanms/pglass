// Design / consistency lint rules (PRD §10).
import { singular } from '../../generators/util.ts';
import type { Diagnostic, Schema } from '../../model/types.ts';
import type { LintRule } from '../types.ts';

const RESERVED = new Set([
  'user',
  'order',
  'group',
  'table',
  'column',
  'select',
  'where',
  'check',
  'default',
  'primary',
  'foreign',
  'references',
  'constraint',
  'unique',
  'index',
  'grant',
  'all',
  'and',
  'or',
  'not',
  'null',
  'true',
  'false',
  'end',
  'limit',
  'offset',
  'desc',
  'asc',
  'from',
  'to',
  'case',
]);

function nameCase(name: string): 'snake' | 'camel' | 'pascal' | 'other' {
  if (/^[a-z][a-z0-9_]*$/.test(name)) return 'snake';
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return 'camel';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'pascal';
  return 'other';
}

const L201: LintRule = {
  code: 'L201',
  name: 'Inconsistent table name casing',
  category: 'design',
  severity: 'warning',
  description: 'Table names mix snake_case / camelCase / PascalCase.',
  defaultOn: true,
  check(schema) {
    const cases = new Set(schema.tables.map((t) => nameCase(t.name)));
    cases.delete('other');
    if (cases.size <= 1) return [];
    return [
      {
        severity: 'warning',
        code: 'L201',
        message: `Table names mix casing styles: ${[...cases].join(', ')}`,
      },
    ];
  },
};

const L202: LintRule = {
  code: 'L202',
  name: 'Inconsistent pluralization',
  category: 'design',
  severity: 'warning',
  description: 'Some table names are plural, others singular.',
  defaultOn: true,
  check(schema) {
    if (schema.tables.length < 2) return [];
    const plural = (n: string) => singular(n).toLowerCase() !== n.toLowerCase();
    const plurals = schema.tables.filter((t) => plural(t.name)).length;
    if (plurals > 0 && plurals < schema.tables.length) {
      return [
        {
          severity: 'warning',
          code: 'L202',
          message: `Table names mix plural and singular (${plurals}/${schema.tables.length} plural)`,
        },
      ];
    }
    return [];
  },
};

const L203: LintRule = {
  code: 'L203',
  name: 'FK column not named <table>_id',
  category: 'design',
  severity: 'warning',
  description: 'A single-column FK should be named <referenced_table_singular>_id.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const r of schema.relationships) {
      if (r.sourceColumns.length !== 1) continue;
      const src = schema.tables.find((t) => t.id === r.sourceTable);
      const tgt = schema.tables.find((t) => t.id === r.targetTable);
      const col = src?.columns.find((c) => c.id === r.sourceColumns[0]);
      if (!src || !tgt || !col) continue;
      const expected = `${singular(tgt.name).toLowerCase()}_id`;
      if (col.name.toLowerCase() !== expected) {
        out.push({
          severity: 'warning',
          code: 'L203',
          message: `FK column "${src.name}.${col.name}" should be named "${expected}"`,
          target: { kind: 'column', table: src.id, id: col.id },
        });
      }
    }
    return out;
  },
};

const L205: LintRule = {
  code: 'L205',
  name: 'Reserved word as identifier',
  category: 'design',
  severity: 'warning',
  description: 'A table/column named after a Postgres reserved word must be quoted forever.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      if (RESERVED.has(t.name.toLowerCase())) {
        out.push({
          severity: 'warning',
          code: 'L205',
          message: `Table name "${t.name}" is a reserved word`,
          target: { kind: 'table', id: t.id },
          fix: {
            title: `Rename to "${t.name}s"`,
            apply: (s) => renameTable(s, t.id, `${t.name}s`),
          },
        });
      }
      for (const c of t.columns) {
        if (RESERVED.has(c.name.toLowerCase())) {
          out.push({
            severity: 'warning',
            code: 'L205',
            message: `Column name "${t.name}.${c.name}" is a reserved word`,
            target: { kind: 'column', table: t.id, id: c.id },
          });
        }
      }
    }
    return out;
  },
};

const L206: LintRule = {
  code: 'L206',
  name: 'Identifier over 63 characters',
  category: 'design',
  severity: 'error',
  description: 'Postgres silently truncates identifiers longer than 63 bytes.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const t of schema.tables) {
      if (t.name.length > 63) {
        out.push({
          severity: 'error',
          code: 'L206',
          message: `Table name "${t.name}" is ${t.name.length} chars (> 63); Postgres will truncate it`,
          target: { kind: 'table', id: t.id },
          fix: {
            title: 'Truncate to 63 chars',
            apply: (s) => renameTable(s, t.id, t.name.slice(0, 63)),
          },
        });
      }
      for (const c of t.columns) {
        if (c.name.length > 63) {
          out.push({
            severity: 'error',
            code: 'L206',
            message: `Column name "${t.name}.${c.name}" is ${c.name.length} chars (> 63)`,
            target: { kind: 'column', table: t.id, id: c.id },
          });
        }
      }
    }
    return out;
  },
};

const L210: LintRule = {
  code: 'L210',
  name: 'Nullable foreign key',
  category: 'design',
  severity: 'info',
  description: 'A nullable FK — confirm the relationship is truly optional.',
  defaultOn: false,
  check(schema) {
    const out: Diagnostic[] = [];
    for (const r of schema.relationships) {
      const src = schema.tables.find((t) => t.id === r.sourceTable);
      if (!src) continue;
      const anyNullable = r.sourceColumns.some(
        (id) => !src.columns.find((c) => c.id === id)?.notNull,
      );
      if (anyNullable) {
        out.push({
          severity: 'info',
          code: 'L210',
          message: `FK on "${src.name}" is nullable — is this relationship optional?`,
          target: { kind: 'rel', id: r.id },
        });
      }
    }
    return out;
  },
};

const L211: LintRule = {
  code: 'L211',
  name: 'Bidirectional FK dependency',
  category: 'design',
  severity: 'warning',
  description: 'Two tables reference each other, creating a dependency cycle.',
  defaultOn: true,
  check(schema) {
    const out: Diagnostic[] = [];
    const pairs = new Set<string>();
    for (const r of schema.relationships) {
      if (r.sourceTable === r.targetTable) continue;
      const back = schema.relationships.find(
        (o) => o.sourceTable === r.targetTable && o.targetTable === r.sourceTable,
      );
      if (back) {
        const key = [r.sourceTable, r.targetTable].sort().join('|');
        if (!pairs.has(key)) {
          pairs.add(key);
          const a = schema.tables.find((t) => t.id === r.sourceTable)?.name;
          const b = schema.tables.find((t) => t.id === r.targetTable)?.name;
          out.push({
            severity: 'warning',
            code: 'L211',
            message: `"${a}" and "${b}" reference each other (bidirectional dependency)`,
          });
        }
      }
    }
    return out;
  },
};

const L204: LintRule = {
  code: 'L204',
  name: 'Missing created_at / updated_at',
  category: 'design',
  severity: 'warning',
  description: 'Table has neither a created_at nor updated_at column.',
  defaultOn: false,
  check(schema) {
    return schema.tables
      .filter((t) => !t.columns.some((c) => /^(created_at|updated_at)$/i.test(c.name)))
      .map((t) => ({
        severity: 'warning' as const,
        code: 'L204',
        message: `Table "${t.name}" has no created_at / updated_at`,
        target: { kind: 'table' as const, id: t.id },
      }));
  },
};

export const DESIGN_RULES: LintRule[] = [L201, L202, L203, L204, L205, L206, L210, L211];

// ── helpers ──
function renameTable(schema: Schema, tableId: string, name: string): Schema {
  return { ...schema, tables: schema.tables.map((t) => (t.id === tableId ? { ...t, name } : t)) };
}

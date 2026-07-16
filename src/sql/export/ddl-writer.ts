// Postgres DDL writer: Schema → CREATE ... statements. See PRD §11 (primary
// export) and §13.1 (serial is legacy — always emit GENERATED ... AS IDENTITY).
import { columnById, indexesForTable } from '../../model/schema.ts';
import type {
  Column,
  EnumType,
  Index,
  RefAction,
  Relationship,
  Schema,
  Table,
  View,
} from '../../model/types.ts';

export interface DdlOptions {
  ifNotExists: boolean;
  includeDropPrelude: boolean;
  includeComments: boolean;
  includeIndexes: boolean;
  /** re-emit CREATE EXTENSION captured on import */
  includeExtensions: boolean;
}

export const DEFAULT_DDL_OPTIONS: DdlOptions = {
  ifNotExists: false,
  includeDropPrelude: false,
  includeComments: true,
  includeIndexes: true,
  includeExtensions: true,
};

/** Quote an identifier only when it isn't a simple lowercase word. */
export function ident(name: string): string {
  return /^[a-z_][a-z0-9_]*$/.test(name) && !RESERVED.has(name)
    ? name
    : `"${name.replace(/"/g, '""')}"`;
}

function qname(namespace: string, name: string): string {
  return namespace === 'public' ? ident(name) : `${ident(namespace)}.${ident(name)}`;
}

function sqlString(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function columnType(col: Column): string {
  let base = col.type.name;
  if (col.type.args.length) base += `(${col.type.args.join(', ')})`;
  base += '[]'.repeat(col.type.arrayDims);
  return base;
}

function refAction(a: RefAction): string {
  switch (a) {
    case 'cascade':
      return 'CASCADE';
    case 'restrict':
      return 'RESTRICT';
    case 'set_null':
      return 'SET NULL';
    case 'set_default':
      return 'SET DEFAULT';
    case 'no_action':
      return 'NO ACTION';
  }
}

function writeEnum(en: EnumType): string {
  const vals = en.values.map(sqlString).join(', ');
  return `CREATE TYPE ${qname(en.namespace, en.name)} AS ENUM (${vals});`;
}

function writeView(v: View): string {
  const kw = v.materialized ? 'MATERIALIZED VIEW' : 'VIEW';
  return `CREATE ${kw} ${qname(v.namespace, v.name)} AS\n${v.query};`;
}

function writeColumn(col: Column, table: Table): string {
  const parts = [`  ${ident(col.name)} ${columnType(col)}`];
  if (col.collation) parts.push(`COLLATE ${ident(col.collation)}`);
  if (col.identity !== 'none') {
    parts.push(`GENERATED ${col.identity === 'always' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`);
  }
  if (col.generated.kind === 'stored') {
    parts.push(`GENERATED ALWAYS AS (${col.generated.expr}) STORED`);
  }
  if (col.default !== undefined && col.identity === 'none' && col.generated.kind === 'none') {
    parts.push(`DEFAULT ${col.default}`);
  }
  if (col.notNull) parts.push('NOT NULL');
  if (col.unique && !table.primaryKey.includes(col.id)) parts.push('UNIQUE');
  if (col.check) parts.push(`CHECK (${col.check})`);
  return parts.join(' ');
}

function writeTable(table: Table, opts: DdlOptions): string {
  const lines: string[] = [];
  const inner: string[] = table.columns.map((c) => writeColumn(c, table));

  if (table.primaryKey.length) {
    const cols = table.primaryKey.map((id) => ident(columnById(table, id)?.name ?? '?')).join(', ');
    inner.push(`  PRIMARY KEY (${cols})`);
  }
  for (const chk of table.checks) {
    const name = chk.name ? `CONSTRAINT ${ident(chk.name)} ` : '';
    inner.push(`  ${name}CHECK (${chk.expr})`);
  }

  const ine = opts.ifNotExists ? 'IF NOT EXISTS ' : '';
  const persistence =
    table.persistence === 'unlogged'
      ? 'UNLOGGED '
      : table.persistence === 'temporary'
        ? 'TEMPORARY '
        : '';
  lines.push(`CREATE ${persistence}TABLE ${ine}${qname(table.namespace, table.name)} (`);
  lines.push(inner.join(',\n'));
  lines.push(');');
  if (table.rowLevelSecurity) {
    lines.push(`ALTER TABLE ${qname(table.namespace, table.name)} ENABLE ROW LEVEL SECURITY;`);
  }
  return lines.join('\n');
}

function writeForeignKey(schema: Schema, rel: Relationship): string | null {
  const src = schema.tables.find((t) => t.id === rel.sourceTable);
  const tgt = schema.tables.find((t) => t.id === rel.targetTable);
  if (!src || !tgt) return null;
  const srcCols = rel.sourceColumns.map((id) => ident(columnById(src, id)?.name ?? '?')).join(', ');
  const tgtCols = rel.targetColumns.map((id) => ident(columnById(tgt, id)?.name ?? '?')).join(', ');
  const name =
    rel.name ??
    `${src.name}_${rel.sourceColumns.map((id) => columnById(src, id)?.name).join('_')}_fkey`;
  let sql = `ALTER TABLE ${qname(src.namespace, src.name)} ADD CONSTRAINT ${ident(name)} FOREIGN KEY (${srcCols}) REFERENCES ${qname(tgt.namespace, tgt.name)} (${tgtCols})`;
  if (rel.onDelete !== 'no_action') sql += ` ON DELETE ${refAction(rel.onDelete)}`;
  if (rel.onUpdate !== 'no_action') sql += ` ON UPDATE ${refAction(rel.onUpdate)}`;
  if (rel.deferrable) sql += ' DEFERRABLE';
  if (rel.initiallyDeferred) sql += ' INITIALLY DEFERRED';
  return `${sql};`;
}

function writeIndex(schema: Schema, ix: Index): string | null {
  const table = schema.tables.find((t) => t.id === ix.table);
  if (!table) return null;
  const keys = ix.keys
    .map((k) => {
      if (k.kind === 'expr') return `(${k.expr})`;
      let s = ident(columnById(table, k.column)?.name ?? '?');
      if (k.opclass) s += ` ${k.opclass}`;
      if (k.sort) s += ` ${k.sort.toUpperCase()}`;
      if (k.nulls) s += ` NULLS ${k.nulls.toUpperCase()}`;
      return s;
    })
    .join(', ');
  const name = ix.name ?? `${table.name}_idx`;
  const unique = ix.unique ? 'UNIQUE ' : '';
  const method = ix.method !== 'btree' ? ` USING ${ix.method}` : '';
  let sql = `CREATE ${unique}INDEX ${ident(name)} ON ${qname(table.namespace, table.name)}${method} (${keys})`;
  if (ix.include?.length) {
    sql += ` INCLUDE (${ix.include.map((id) => ident(columnById(table, id)?.name ?? '?')).join(', ')})`;
  }
  if (ix.where) sql += ` WHERE ${ix.where}`;
  return `${sql};`;
}

function writeComments(schema: Schema): string[] {
  const out: string[] = [];
  for (const t of schema.tables) {
    if (t.comment)
      out.push(`COMMENT ON TABLE ${qname(t.namespace, t.name)} IS ${sqlString(t.comment)};`);
    for (const c of t.columns) {
      if (c.comment)
        out.push(
          `COMMENT ON COLUMN ${qname(t.namespace, t.name)}.${ident(c.name)} IS ${sqlString(c.comment)};`,
        );
    }
  }
  for (const e of schema.enums) {
    if (e.comment)
      out.push(`COMMENT ON TYPE ${qname(e.namespace, e.name)} IS ${sqlString(e.comment)};`);
  }
  return out;
}

export function exportDDL(schema: Schema, options: Partial<DdlOptions> = {}): string {
  const opts = { ...DEFAULT_DDL_OPTIONS, ...options };
  const sections: string[] = [];

  if (opts.includeExtensions && schema.meta.extensions?.length) {
    sections.push(
      schema.meta.extensions.map((e) => `CREATE EXTENSION IF NOT EXISTS ${ident(e)};`).join('\n'),
    );
  }

  if (opts.includeDropPrelude) {
    const drops: string[] = [];
    for (const v of schema.views)
      drops.push(
        `DROP ${v.materialized ? 'MATERIALIZED VIEW' : 'VIEW'} IF EXISTS ${qname(v.namespace, v.name)} CASCADE;`,
      );
    for (const t of schema.tables)
      drops.push(`DROP TABLE IF EXISTS ${qname(t.namespace, t.name)} CASCADE;`);
    for (const e of schema.enums)
      drops.push(`DROP TYPE IF EXISTS ${qname(e.namespace, e.name)} CASCADE;`);
    if (drops.length) sections.push(drops.join('\n'));
  }

  // 1. schemas (namespaces other than public)
  const schemas = schema.namespaces.filter((n) => n !== 'public');
  if (schemas.length) {
    sections.push(
      schemas
        .map((n) => `CREATE SCHEMA ${opts.ifNotExists ? 'IF NOT EXISTS ' : ''}${ident(n)};`)
        .join('\n'),
    );
  }

  // 2. enums
  if (schema.enums.length) sections.push(schema.enums.map(writeEnum).join('\n'));

  // 3. tables (without FKs)
  for (const t of schema.tables) sections.push(writeTable(t, opts));

  // 4. indexes
  if (opts.includeIndexes) {
    const idx: string[] = [];
    for (const t of schema.tables) {
      for (const ix of indexesForTable(schema, t.id)) {
        const s = writeIndex(schema, ix);
        if (s) idx.push(s);
      }
    }
    if (idx.length) sections.push(idx.join('\n'));
  }

  // 5. foreign keys (after all tables exist)
  const fks = schema.relationships
    .map((r) => writeForeignKey(schema, r))
    .filter((s): s is string => !!s);
  if (fks.length) sections.push(fks.join('\n'));

  // 5b. views (after the tables they read from)
  for (const v of schema.views) sections.push(writeView(v));

  // 6. comments
  if (opts.includeComments) {
    const comments = writeComments(schema);
    // re-emit preserved raw objects (views/functions/triggers) verbatim
    const raw = schema.meta.rawObjects?.map((r) => r.sql.trim()) ?? [];
    if (comments.length) sections.push(comments.join('\n'));
    if (raw.length) sections.push(raw.join('\n\n'));
  }

  return `${sections.join('\n\n')}\n`;
}

// A pragmatic subset of Postgres reserved words that must be quoted as identifiers.
const RESERVED = new Set([
  'user',
  'order',
  'group',
  'table',
  'column',
  'select',
  'from',
  'where',
  'default',
  'check',
  'primary',
  'foreign',
  'references',
  'constraint',
  'unique',
  'index',
  'create',
  'grant',
  'all',
  'and',
  'or',
  'not',
  'null',
  'true',
  'false',
  'end',
  'desc',
  'asc',
  'limit',
  'offset',
]);

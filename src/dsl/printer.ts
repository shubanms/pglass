// Deterministic .pgl printer: schema → canonical text. See PRD §5.2 / §5.3.
//
// Output MUST be byte-stable for a given model so git diffs are meaningful and
// the sync loop doesn't thrash. print(parse(text)) === text for canonical input.
import { columnById, indexesForTable, tableById } from '../model/schema.ts';
import type {
  Column,
  ColumnId,
  EnumType,
  Index,
  PgType,
  RefAction,
  Relationship,
  Schema,
  Table,
} from '../model/types.ts';

const INTEGER_TYPES = new Set(['smallint', 'integer', 'bigint']);
const INDENT = '  ';

export function print(schema: Schema): string {
  const out: string[] = [];

  // 1. project
  if (schema.name && schema.name !== 'untitled') {
    if (schema.meta.description) {
      out.push(`project ${str(schema.name)} {`);
      out.push(`${INDENT}description: ${str(schema.meta.description)}`);
      out.push('}');
    } else {
      out.push(`project ${str(schema.name)} {}`);
    }
    out.push('');
  }

  // 2. enums (alphabetical)
  const enums = [...schema.enums].sort((a, b) => qual(a).localeCompare(qual(b)));
  for (const en of enums) {
    out.push(printEnum(en));
    out.push('');
  }

  // 3. tables (canvas reading order: pos.y bucketed to 100px, then pos.x; stable
  //    sort preserves source order when positions are equal)
  const tables = [...schema.tables].sort((a, b) => {
    const ay = Math.floor(a.pos.y / 100);
    const by = Math.floor(b.pos.y / 100);
    if (ay !== by) return ay - by;
    return a.pos.x - b.pos.x;
  });

  // Decide which relationships print inline vs standalone.
  const inlineRelIds = chooseInlineRels(schema);

  for (const table of tables) {
    out.push(printTable(schema, table, inlineRelIds));
    out.push('');
  }

  // 4. standalone refs (alphabetical by source table then column)
  const standalone = schema.relationships
    .filter((r) => !inlineRelIds.has(r.id))
    .map((r) => ({ r, text: printRef(schema, r) }))
    .sort((a, b) => a.text.localeCompare(b.text));
  if (standalone.length) {
    for (const { text } of standalone) out.push(text);
    out.push('');
  }

  // 5. groups
  for (const g of schema.groups) {
    const members = schema.tables.filter((t) => t.groupId === g.id).map((t) => t.name);
    const head = g.color ? `group ${g.name} [color: ${g.color}] {` : `group ${g.name} {`;
    out.push(head);
    for (const m of members) out.push(`${INDENT}${m}`);
    out.push('}');
    out.push('');
  }

  // 6. notes
  for (let i = 0; i < schema.notes.length; i++) {
    const note = schema.notes[i]!;
    out.push(`note note_${i + 1} {`);
    out.push(`${INDENT}'''`);
    for (const line of note.text.split('\n')) out.push(`${INDENT}${line}`.trimEnd());
    out.push(`${INDENT}'''`);
    out.push('}');
    out.push('');
  }

  // single trailing newline, LF only
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function printEnum(en: EnumType): string {
  const lines: string[] = [`enum ${qual(en)} {`];
  for (const v of en.values) {
    const note = en.valueNotes?.[v];
    const value = identOrString(v);
    lines.push(note ? `${INDENT}${value} [note: ${str(note)}]` : `${INDENT}${value}`);
  }
  lines.push('}');
  return lines.join('\n');
}

function printTable(schema: Schema, table: Table, inlineRelIds: Set<string>): string {
  const header =
    table.color !== undefined
      ? `table ${qualTable(table)} [color: ${table.color}] {`
      : `table ${qualTable(table)} {`;
  const lines: string[] = [header];

  const singlePk = table.primaryKey.length === 1 ? table.primaryKey[0] : undefined;

  // Column alignment widths. Names pad to the widest name over all columns;
  // types pad to the widest type *among columns that carry settings*, so the
  // opening "[" lines up with exactly one space of separation (PRD §5.2).
  const rendered = table.columns.map((c) => ({
    col: c,
    settings: columnSettings(schema, table, c, singlePk, inlineRelIds),
    tstr: typeStr(c.type),
  }));
  const maxNameLen = Math.max(0, ...rendered.map((r) => r.col.name.length));
  const maxTypeLen = Math.max(
    0,
    ...rendered.filter((r) => r.settings.length).map((r) => r.tstr.length),
  );

  for (const r of rendered) {
    const name = r.col.name.padEnd(maxNameLen);
    if (r.settings.length) {
      lines.push(`${INDENT}${name}  ${r.tstr.padEnd(maxTypeLen)} [${r.settings.join(', ')}]`);
    } else {
      lines.push(`${INDENT}${name}  ${r.tstr}`.trimEnd());
    }
  }

  // indexes block: composite PK + non-inline indexes
  const indexes = indexesForTable(schema, table.id);
  const compositePk = table.primaryKey.length > 1;
  if (compositePk || indexes.length) {
    lines.push('');
    lines.push(`${INDENT}indexes {`);
    const entries: { keys: string; settings: string }[] = [];
    if (compositePk) {
      const cols = table.primaryKey.map((id) => columnById(table, id)?.name ?? '?').join(', ');
      entries.push({ keys: `(${cols})`, settings: 'pk' });
    }
    for (const ix of indexes) {
      entries.push({ keys: indexKeyStr(table, ix), settings: indexSettings(ix) });
    }
    const maxKeys = Math.max(0, ...entries.map((e) => e.keys.length));
    for (const e of entries) {
      if (e.settings) {
        lines.push(`${INDENT}${INDENT}${e.keys.padEnd(maxKeys)} [${e.settings}]`);
      } else {
        lines.push(`${INDENT}${INDENT}${e.keys}`);
      }
    }
    lines.push(`${INDENT}}`);
  }

  // checks block
  if (table.checks.length) {
    lines.push('');
    lines.push(`${INDENT}checks {`);
    const entries = table.checks.map((c) => ({
      expr: str(c.expr),
      name: c.name,
    }));
    const maxExpr = Math.max(0, ...entries.map((e) => e.expr.length));
    for (const e of entries) {
      if (e.name) {
        lines.push(`${INDENT}${INDENT}${e.expr.padEnd(maxExpr)} [name: ${str(e.name)}]`);
      } else {
        lines.push(`${INDENT}${INDENT}${e.expr}`);
      }
    }
    lines.push(`${INDENT}}`);
  }

  // table note
  if (table.comment) {
    lines.push('');
    lines.push(`${INDENT}note: ${str(table.comment)}`);
  }

  lines.push('}');
  return lines.join('\n');
}

function columnSettings(
  schema: Schema,
  table: Table,
  col: Column,
  singlePk: ColumnId | undefined,
  inlineRelIds: Set<string>,
): string[] {
  const s: string[] = [];
  // Fixed order: pk, increment, not null, unique, default, identity, generated,
  // check, collate, ref, color, note.
  const isSinglePk = singlePk === col.id;
  if (isSinglePk) s.push('pk');

  const isIncrement = col.identity === 'by_default' && INTEGER_TYPES.has(col.type.name);
  if (isIncrement) s.push('increment');

  // `pk` already implies NOT NULL, so don't print it redundantly for the
  // single-column primary key (composite PK members still print it).
  if (col.notNull && !isSinglePk) s.push('not null');
  if (col.unique) s.push('unique');
  if (col.default !== undefined) s.push(`default: ${defaultVal(col.default)}`);

  if (!isIncrement && col.identity !== 'none') {
    s.push(`identity: ${col.identity === 'always' ? 'always' : 'by default'}`);
  }
  if (col.generated.kind === 'stored') s.push(`generated: ${str(col.generated.expr)}`);
  if (col.check) s.push(`check: ${str(col.check)}`);
  if (col.collation) s.push(`collate: ${str(col.collation)}`);

  // inline ref, if this column is the (single) source of an inlined relationship
  const rel = schema.relationships.find(
    (r) => inlineRelIds.has(r.id) && r.sourceColumns.length === 1 && r.sourceColumns[0] === col.id,
  );
  if (rel) s.push(inlineRefStr(schema, table, rel, col));

  if (col.color !== undefined) s.push(`color: ${col.color}`);
  if (col.comment) s.push(`note: ${str(col.comment)}`);
  return s;
}

function inlineRefStr(schema: Schema, table: Table, rel: Relationship, col: Column): string {
  const tgtTable = tableById(schema, rel.targetTable);
  const tgtCol = tgtTable ? columnById(tgtTable, rel.targetColumns[0]!) : undefined;
  const op = col.unique ? '-' : '>';
  const tgtName =
    tgtTable && tgtTable.namespace !== table.namespace
      ? `${tgtTable.namespace}.${tgtTable.name}`
      : (tgtTable?.name ?? '?');
  const settings = refSettings(rel);
  const base = `ref: ${op} ${tgtName}.${tgtCol?.name ?? '?'}`;
  return settings ? `${base} [${settings}]` : base;
}

function printRef(schema: Schema, rel: Relationship): string {
  const src = tableById(schema, rel.sourceTable);
  const tgt = tableById(schema, rel.targetTable);
  const srcCols = rel.sourceColumns
    .map((id) => (src ? columnById(src, id)?.name : undefined) ?? '?')
    .join(', ');
  const tgtCols = rel.targetColumns
    .map((id) => (tgt ? columnById(tgt, id)?.name : undefined) ?? '?')
    .join(', ');
  const srcRef =
    rel.sourceColumns.length > 1
      ? `${src?.name ?? '?'}.(${srcCols})`
      : `${src?.name ?? '?'}.${srcCols}`;
  const tgtRef =
    rel.targetColumns.length > 1
      ? `${tgt?.name ?? '?'}.(${tgtCols})`
      : `${tgt?.name ?? '?'}.${tgtCols}`;
  const settings = refSettings(rel);
  const base = `ref: ${srcRef} > ${tgtRef}`;
  return settings ? `${base} [${settings}]` : base;
}

function refSettings(rel: Relationship): string {
  const parts: string[] = [];
  if (rel.onDelete !== 'no_action') parts.push(`delete: ${refAction(rel.onDelete)}`);
  if (rel.onUpdate !== 'no_action') parts.push(`update: ${refAction(rel.onUpdate)}`);
  if (rel.name) parts.push(`name: ${str(rel.name)}`);
  if (rel.comment) parts.push(`note: ${str(rel.comment)}`);
  return parts.join(', ');
}

function refAction(a: RefAction): string {
  switch (a) {
    case 'cascade':
      return 'cascade';
    case 'restrict':
      return 'restrict';
    case 'set_null':
      return 'set null';
    case 'set_default':
      return 'set default';
    case 'no_action':
      return 'no action';
  }
}

/** Which relationships are eligible to print inline on a column (§5.3). */
function chooseInlineRels(schema: Schema): Set<string> {
  // A source column used by more than one FK forces all its FKs to standalone.
  const sourceColUse = new Map<ColumnId, number>();
  for (const r of schema.relationships) {
    for (const c of r.sourceColumns) sourceColUse.set(c, (sourceColUse.get(c) ?? 0) + 1);
  }
  const inline = new Set<string>();
  for (const r of schema.relationships) {
    if (r.sourceColumns.length !== 1 || r.targetColumns.length !== 1) continue;
    const col = r.sourceColumns[0]!;
    if ((sourceColUse.get(col) ?? 0) === 1) inline.add(r.id);
  }
  return inline;
}

function indexKeyStr(table: Table, ix: Index): string {
  if (ix.keys.length === 1 && ix.keys[0]!.kind === 'expr') {
    return `\`${(ix.keys[0] as { expr: string }).expr}\``;
  }
  const parts = ix.keys.map((k) => {
    if (k.kind === 'expr') return `\`${k.expr}\``;
    const name = columnById(table, k.column)?.name ?? '?';
    let s = name;
    if (k.sort) s += ` ${k.sort}`;
    if (k.nulls) s += ` nulls ${k.nulls}`;
    return s;
  });
  return `(${parts.join(', ')})`;
}

function indexSettings(ix: Index): string {
  // order: unique, type, where, include, name, note
  const parts: string[] = [];
  if (ix.unique) parts.push('unique');
  if (ix.method !== 'btree') parts.push(`type: ${ix.method}`);
  if (ix.where) parts.push(`where: ${str(ix.where)}`);
  if (ix.name) parts.push(`name: ${str(ix.name)}`);
  if (ix.comment) parts.push(`note: ${str(ix.comment)}`);
  return parts.join(', ');
}

// ── value formatting ──

export function typeStr(t: PgType): string {
  let s = t.name;
  if (t.args.length) s += `(${t.args.join(',')})`;
  s += '[]'.repeat(t.arrayDims);
  return s;
}

/** DSL rendering of a stored SQL default expression. */
function defaultVal(raw: string): string {
  if (/^'([^']|'')*'$/.test(raw)) return raw; // SQL string literal → valid DSL string
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw; // number
  const lower = raw.toLowerCase();
  if (lower === 'true' || lower === 'false' || lower === 'null') return lower;
  return `\`${raw}\``; // raw SQL expression
}

/** A single-quoted DSL string literal with '' escaping. */
function str(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** Bare identifier if it's a simple word, else a quoted string. */
function identOrString(s: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : str(s);
}

function qual(e: EnumType): string {
  return e.namespace === 'public' ? e.name : `${e.namespace}.${e.name}`;
}
function qualTable(t: Table): string {
  return t.namespace === 'public' ? t.name : `${t.namespace}.${t.name}`;
}

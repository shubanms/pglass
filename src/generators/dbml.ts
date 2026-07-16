// DBML for interop with dbdiagram.io — near-1:1 with our model. PRD §11.
import type { Column, Schema, Table } from '../model/types.ts';
import { columnOf, isPk, tableOf } from './util.ts';

function typeStr(col: Column): string {
  let s = col.type.name;
  if (col.type.args.length) s += `(${col.type.args.join(',')})`;
  s += '[]'.repeat(col.type.arrayDims);
  return s;
}

export function generateDbml(schema: Schema): string {
  const out: string[] = [];

  if (schema.name && schema.name !== 'untitled') {
    out.push(`Project "${schema.name}" {`, "  database_type: 'PostgreSQL'");
    if (schema.meta.description)
      out.push(`  Note: '${schema.meta.description.replace(/'/g, "\\'")}'`);
    out.push('}', '');
  }

  for (const en of schema.enums) {
    out.push(`Enum ${en.name} {`);
    for (const v of en.values) out.push(`  "${v}"`);
    out.push('}', '');
  }

  for (const table of schema.tables) {
    out.push(`Table ${table.name} {`);
    for (const col of table.columns) {
      const settings: string[] = [];
      if (isPk(table, col) && table.primaryKey.length === 1) settings.push('pk');
      if (col.identity !== 'none') settings.push('increment');
      if (col.notNull) settings.push('not null');
      if (col.unique) settings.push('unique');
      if (col.default !== undefined) settings.push(`default: ${dbmlDefault(col.default)}`);
      if (col.comment) settings.push(`note: '${col.comment.replace(/'/g, "\\'")}'`);
      const s = settings.length ? ` [${settings.join(', ')}]` : '';
      out.push(`  ${col.name} ${typeStr(col)}${s}`);
    }
    if (table.primaryKey.length > 1) {
      out.push('', '  indexes {');
      out.push(
        `    (${table.primaryKey.map((id) => columnOf(table, id)?.name ?? '?').join(', ')}) [pk]`,
      );
      out.push('  }');
    }
    out.push('}', '');
  }

  for (const rel of schema.relationships) {
    const src = tableOf(schema, rel.sourceTable);
    const tgt = tableOf(schema, rel.targetTable);
    if (!src || !tgt) continue;
    const srcCols = colRef(
      src,
      rel.sourceColumns.map((id) => columnOf(src, id)?.name ?? '?'),
    );
    const tgtCols = colRef(
      tgt,
      rel.targetColumns.map((id) => columnOf(tgt, id)?.name ?? '?'),
    );
    out.push(`Ref: ${src.name}.${srcCols} > ${tgt.name}.${tgtCols}`);
  }

  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function colRef(_t: Table, names: string[]): string {
  return names.length > 1 ? `(${names.join(', ')})` : names[0]!;
}

function dbmlDefault(raw: string): string {
  if (/^'.*'$/.test(raw)) return raw;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  if (raw === 'true' || raw === 'false' || raw === 'null') return raw;
  return `\`${raw}\``;
}

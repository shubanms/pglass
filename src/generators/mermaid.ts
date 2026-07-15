// Mermaid erDiagram — correct crow's-foot syntax, PK/FK markers, column types.
// This is what goes in the README (dogfooding). PRD §11.
import { columnsAreUnique } from '../model/schema.ts';
import type { Schema, Table } from '../model/types.ts';
import { columnOf, isPk, tableOf } from './util.ts';

/** Mermaid identifiers can't contain dots/spaces — sanitize. */
function mid(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

function mermaidType(typeName: string, dims: number): string {
  return `${typeName.replace(/ /g, '_')}${'[]'.repeat(dims)}`;
}

export function generateMermaid(schema: Schema): string {
  const out: string[] = ['erDiagram'];

  const fkCols = new Set<string>();
  for (const r of schema.relationships) for (const c of r.sourceColumns) fkCols.add(c);

  for (const table of schema.tables) {
    out.push(`  ${mid(table.name)} {`);
    for (const col of table.columns) {
      const marks: string[] = [];
      if (isPk(table, col)) marks.push('PK');
      if (fkCols.has(col.id)) marks.push('FK');
      const suffix = marks.length ? ` "${marks.join(',')}"` : '';
      out.push(`    ${mermaidType(col.type.name, col.type.arrayDims)} ${mid(col.name)}${suffix}`);
    }
    out.push('  }');
  }

  for (const rel of schema.relationships) {
    const src = tableOf(schema, rel.sourceTable);
    const tgt = tableOf(schema, rel.targetTable);
    if (!src || !tgt) continue;
    // target side is "one" (|| if all FK cols NOT NULL, else |o);
    // source side is many (}o), or }| collapses to |o for 1:1.
    const allNotNull = rel.sourceColumns.every((id) => columnOf(src, id)?.notNull);
    const unique = columnsAreUnique(schema, src, rel.sourceColumns);
    const left = allNotNull ? '||' : '|o';
    const right = unique ? 'o|' : 'o{';
    const label = fkLabel(src, rel.name);
    out.push(`  ${mid(tgt.name)} ${left}--${right} ${mid(src.name)} : ${label}`);
  }

  return `${out.join('\n')}\n`;
}

function fkLabel(src: Table, name?: string): string {
  const raw = name ?? `has_${src.name}`;
  return `"${raw.replace(/"/g, '')}"`;
}

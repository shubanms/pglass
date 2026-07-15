// PlantUML entity-relationship diagram. PRD §11.
import type { Column, Schema } from '../model/types.ts';
import { columnOf, isPk, tableOf } from './util.ts';

function typeStr(col: Column): string {
  let s = col.type.name;
  if (col.type.args.length) s += `(${col.type.args.join(',')})`;
  s += '[]'.repeat(col.type.arrayDims);
  return s;
}

export function generatePlantUml(schema: Schema): string {
  const out: string[] = ['@startuml', 'hide circle', 'skinparam linetype ortho', ''];

  const fkCols = new Set<string>();
  for (const r of schema.relationships) for (const c of r.sourceColumns) fkCols.add(c);

  for (const table of schema.tables) {
    out.push(`entity "${table.name}" as ${table.name} {`);
    const pkCols = table.columns.filter((c) => isPk(table, c));
    const rest = table.columns.filter((c) => !isPk(table, c));
    for (const col of pkCols) out.push(`  * ${col.name} : ${typeStr(col)} <<PK>>`);
    if (pkCols.length) out.push('  --');
    for (const col of rest) {
      const mark = fkCols.has(col.id) ? ' <<FK>>' : '';
      const req = col.notNull ? '* ' : '  ';
      out.push(`  ${req}${col.name} : ${typeStr(col)}${mark}`);
    }
    out.push('}', '');
  }

  for (const rel of schema.relationships) {
    const src = tableOf(schema, rel.sourceTable);
    const tgt = tableOf(schema, rel.targetTable);
    if (!src || !tgt) continue;
    const allNotNull = rel.sourceColumns.every((id) => columnOf(src, id)?.notNull);
    // target ||--o{ source  (one-to-many)
    const leftCard = allNotNull ? '||' : '|o';
    out.push(`${tgt.name} ${leftCard}--o{ ${src.name}`);
  }

  out.push('@enduml');
  return `${out.join('\n')}\n`;
}

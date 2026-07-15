// Markdown data dictionary — per-table docs with a column table, relationships,
// and indexes, plus a TOC and an embedded Mermaid overview. PRD §11.
import { indexesForTable } from '../model/schema.ts';
import type { Column, Schema } from '../model/types.ts';
import { generateMermaid } from './mermaid.ts';
import { columnOf, fkForColumn, fksTo, isPk, tableOf } from './util.ts';

function typeStr(col: Column): string {
  let s = col.type.name;
  if (col.type.args.length) s += `(${col.type.args.join(',')})`;
  s += '[]'.repeat(col.type.arrayDims);
  return s;
}

function anchor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function generateMarkdown(schema: Schema): string {
  const out: string[] = [];
  const title = schema.name && schema.name !== 'untitled' ? schema.name : 'Database';
  out.push(`# ${title}`, '');
  if (schema.meta.description) out.push(schema.meta.description, '');

  // overview ER diagram
  out.push('## Overview', '', '```mermaid', generateMermaid(schema).trimEnd(), '```', '');

  // table of contents
  out.push('## Tables', '');
  for (const t of schema.tables) out.push(`- [${t.name}](#${anchor(t.name)})`);
  if (schema.enums.length) {
    out.push('', '## Enums', '');
    for (const e of schema.enums) out.push(`- **${e.name}**: ${e.values.join(', ')}`);
  }
  out.push('');

  // per-table detail
  for (const table of schema.tables) {
    out.push(`## ${table.name}`, '');
    if (table.comment) out.push(table.comment, '');

    out.push('| Column | Type | Null | Default | Description |');
    out.push('|---|---|---|---|---|');
    for (const col of table.columns) {
      const marks: string[] = [];
      if (isPk(table, col)) marks.push('🔑');
      if (fkForColumn(schema, table, col)) marks.push('🔗');
      const name = `${marks.join('')} ${col.name}`.trim();
      out.push(
        `| ${name} | \`${typeStr(col)}\` | ${col.notNull ? 'no' : 'yes'} | ${col.default ? `\`${col.default}\`` : ''} | ${col.comment ?? ''} |`,
      );
    }
    out.push('');

    // relationships
    const outgoing = schema.relationships.filter((r) => r.sourceTable === table.id);
    const incoming = fksTo(schema, table.id);
    if (outgoing.length || incoming.length) {
      out.push('**Relationships**', '');
      for (const r of outgoing) {
        const tgt = tableOf(schema, r.targetTable);
        const cols = r.sourceColumns.map((id) => columnOf(table, id)?.name).join(', ');
        out.push(
          `- \`${cols}\` → [${tgt?.name}](#${anchor(tgt?.name ?? '')}) (on delete ${r.onDelete.replace('_', ' ')})`,
        );
      }
      for (const r of incoming) {
        const src = tableOf(schema, r.sourceTable);
        out.push(`- ← [${src?.name}](#${anchor(src?.name ?? '')}) references this table`);
      }
      out.push('');
    }

    // indexes
    const idx = indexesForTable(schema, table.id);
    if (idx.length) {
      out.push('**Indexes**', '');
      for (const ix of idx) {
        const keys = ix.keys
          .map((k) => (k.kind === 'column' ? columnOf(table, k.column)?.name : k.expr))
          .join(', ');
        const flags = [ix.unique ? 'unique' : '', ix.method !== 'btree' ? ix.method : '']
          .filter(Boolean)
          .join(', ');
        out.push(`- \`${ix.name ?? '(unnamed)'}\` (${keys})${flags ? ` — ${flags}` : ''}`);
      }
      out.push('');
    }
  }

  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

// Prisma schema generator. PRD §11 — @relation with explicit fields/references,
// @@index / @@unique / @@id, enum blocks, @map for non-camelCase names.
import { indexesForTable } from '../model/schema.ts';
import type { Column, IndexKey, Relationship, Schema, Table } from '../model/types.ts';
import {
  camelCase,
  columnOf,
  effectiveNotNull,
  enumOf,
  enumTypeName,
  isPk,
  pascalCase,
  singular,
  tableOf,
} from './util.ts';

function prismaScalar(name: string): string {
  switch (name) {
    case 'smallint':
    case 'integer':
    case 'serial':
    case 'smallserial':
      return 'Int';
    case 'bigint':
    case 'bigserial':
      return 'BigInt';
    case 'real':
    case 'double precision':
      return 'Float';
    case 'numeric':
    case 'decimal':
    case 'money':
      return 'Decimal';
    case 'boolean':
      return 'Boolean';
    case 'json':
    case 'jsonb':
      return 'Json';
    case 'uuid':
      return 'String';
    case 'date':
    case 'timestamp':
    case 'timestamptz':
    case 'time':
    case 'timetz':
      return 'DateTime';
    case 'bytea':
      return 'Bytes';
    default:
      return 'String';
  }
}

function fieldName(name: string): string {
  return camelCase(name);
}
function modelName(name: string): string {
  return pascalCase(singular(name));
}

export function generatePrisma(schema: Schema): string {
  const out: string[] = [
    'datasource db {',
    '  provider = "postgresql"',
    '  url      = env("DATABASE_URL")',
    '}',
    '',
    'generator client {',
    '  provider = "prisma-client-js"',
    '}',
    '',
  ];

  for (const en of [...schema.enums].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push(`enum ${enumTypeName(en.name)} {`);
    for (const v of en.values) {
      const safe = /^[A-Za-z_][A-Za-z0-9_]*$/.test(v);
      out.push(safe ? `  ${v}` : `  ${sanitizeEnum(v)} @map("${v}")`);
    }
    out.push('}', '');
  }

  for (const table of schema.tables) {
    out.push(`model ${modelName(table.name)} {`);
    // scalar fields
    for (const col of table.columns) {
      out.push(`  ${prismaField(schema, table, col)}`);
    }
    // relation fields (belongs-to for each outgoing FK)
    for (const rel of schema.relationships.filter((r) => r.sourceTable === table.id)) {
      out.push(`  ${prismaBelongsTo(schema, table, rel)}`);
    }
    // has-many back-relations
    for (const rel of schema.relationships.filter((r) => r.targetTable === table.id)) {
      const child = tableOf(schema, rel.sourceTable);
      if (child) out.push(`  ${fieldName(child.name)} ${modelName(child.name)}[]`);
    }

    // composite PK
    if (table.primaryKey.length > 1) {
      out.push(
        `  @@id([${table.primaryKey.map((id) => fieldName(columnOf(table, id)?.name ?? '')).join(', ')}])`,
      );
    }
    // indexes
    for (const ix of indexesForTable(schema, table.id)) {
      const cols = ix.keys
        .filter((k): k is Extract<IndexKey, { kind: 'column' }> => k.kind === 'column')
        .map((k) => fieldName(columnOf(table, k.column)?.name ?? ''));
      if (!cols.length) continue;
      out.push(`  ${ix.unique ? '@@unique' : '@@index'}([${cols.join(', ')}])`);
    }
    if (table.name !== fieldName(table.name)) out.push(`  @@map("${table.name}")`);
    out.push('}', '');
  }

  return out.join('\n');
}

function prismaField(schema: Schema, table: Table, col: Column): string {
  const en = enumOf(schema, col);
  let type = en ? enumTypeName(en.name) : prismaScalar(col.type.name);
  if (col.type.arrayDims > 0) type += '[]';
  else if (!effectiveNotNull(table, col)) type += '?';

  const attrs: string[] = [];
  if (isPk(table, col) && table.primaryKey.length === 1) attrs.push('@id');
  if (col.identity !== 'none') attrs.push('@default(autoincrement())');
  else if (col.default !== undefined) {
    const d = prismaDefault(col.default, !!en);
    if (d) attrs.push(`@default(${d})`);
  }
  if (col.unique && !(isPk(table, col) && table.primaryKey.length === 1)) attrs.push('@unique');
  if (col.name !== fieldName(col.name)) attrs.push(`@map("${col.name}")`);

  return `${fieldName(col.name)} ${type} ${attrs.join(' ')}`.trimEnd();
}

function prismaBelongsTo(schema: Schema, table: Table, rel: Relationship): string {
  const tgt = tableOf(schema, rel.targetTable);
  if (!tgt) return '';
  const fields = rel.sourceColumns.map((id) => fieldName(columnOf(table, id)?.name ?? ''));
  const refs = rel.targetColumns.map((id) => fieldName(columnOf(tgt, id)?.name ?? ''));
  const onDelete = rel.onDelete !== 'no_action' ? `, onDelete: ${prismaAction(rel.onDelete)}` : '';
  // relation field name: the singular target, camelCased
  const fname = fieldName(singular(tgt.name));
  return `${fname} ${modelName(tgt.name)} @relation(fields: [${fields.join(', ')}], references: [${refs.join(', ')}]${onDelete})`;
}

function prismaAction(a: string): string {
  return (
    {
      cascade: 'Cascade',
      restrict: 'Restrict',
      set_null: 'SetNull',
      set_default: 'SetDefault',
      no_action: 'NoAction',
    }[a] ?? 'NoAction'
  );
}

function prismaDefault(raw: string, isEnum: boolean): string | null {
  if (/^'(.*)'$/.test(raw)) {
    const inner = raw.slice(1, -1).replace(/''/g, "'");
    return isEnum ? sanitizeEnum(inner) : `"${inner}"`;
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  if (raw === 'true' || raw === 'false') return raw;
  if (/now\(\)/i.test(raw)) return 'now()';
  if (/gen_random_uuid|uuid_generate/i.test(raw)) return 'dbgenerated("gen_random_uuid()")';
  return `dbgenerated("${raw.replace(/"/g, '\\"')}")`;
}

function sanitizeEnum(v: string): string {
  return v.replace(/[^A-Za-z0-9_]/g, '_');
}

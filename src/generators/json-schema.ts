// JSON Schema (draft 2020-12) — one definition per table, $ref for FKs. PRD §11.
import type { Column, Schema } from '../model/types.ts';
import { enumOf, fkForColumn, tableOf } from './util.ts';

function jsonType(col: Column): object {
  const en = undefined; // enums handled by caller
  void en;
  switch (col.type.name) {
    case 'smallint':
    case 'integer':
    case 'serial':
    case 'smallserial':
    case 'bigserial':
      return { type: 'integer' };
    case 'bigint':
      return { type: 'integer' };
    case 'real':
    case 'double precision':
    case 'numeric':
    case 'decimal':
    case 'money':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'json':
    case 'jsonb':
      return {};
    case 'uuid':
      return { type: 'string', format: 'uuid' };
    case 'date':
      return { type: 'string', format: 'date' };
    case 'timestamp':
    case 'timestamptz':
      return { type: 'string', format: 'date-time' };
    case 'time':
    case 'timetz':
      return { type: 'string', format: 'time' };
    case 'inet':
    case 'cidr':
      return { type: 'string', format: 'ipv4' };
    default:
      return { type: 'string' };
  }
}

function propSchema(schema: Schema, col: Column): object {
  const en = enumOf(schema, col);
  let base: object = en ? { type: 'string', enum: en.values } : jsonType(col);
  for (let i = 0; i < col.type.arrayDims; i++) base = { type: 'array', items: base };
  if (!col.notNull && !('enum' in base)) {
    // allow null
    const b = base as { type?: string };
    if (b.type) base = { ...base, type: [b.type, 'null'] };
  }
  const fk = fkForColumn(schema, tableFor(schema, col)!, col);
  if (fk) {
    const tgt = tableOf(schema, fk.targetTable);
    if (tgt) (base as Record<string, unknown>).$comment = `FK → ${tgt.name}`;
  }
  return base;
}

function tableFor(schema: Schema, col: Column) {
  return schema.tables.find((t) => t.columns.some((c) => c.id === col.id));
}

export function generateJsonSchema(schema: Schema): string {
  const defs: Record<string, object> = {};
  for (const table of schema.tables) {
    const properties: Record<string, object> = {};
    const required: string[] = [];
    for (const col of table.columns) {
      properties[col.name] = propSchema(schema, col);
      if (col.notNull && col.default === undefined) required.push(col.name);
    }
    defs[table.name] = {
      type: 'object',
      additionalProperties: false,
      properties,
      ...(required.length ? { required } : {}),
    };
  }

  const doc = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: schema.name,
    ...(schema.meta.description ? { description: schema.meta.description } : {}),
    $defs: defs,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

// Zod schemas — one per table, plus an Insert variant that omits
// identity/generated/defaulted columns. PRD §11.
import type { Column, Schema } from '../model/types.ts';
import type { Table } from '../model/types.ts';
import { camelCase, effectiveNotNull, enumOf, hasDefault, pascalCase, singular } from './util.ts';

function zodScalar(name: string): string {
  switch (name) {
    case 'smallint':
    case 'integer':
    case 'real':
    case 'double precision':
    case 'serial':
    case 'smallserial':
    case 'bigserial':
      return 'z.number()';
    case 'bigint':
    case 'numeric':
    case 'decimal':
    case 'money':
      return 'z.string()';
    case 'boolean':
      return 'z.boolean()';
    case 'uuid':
      return 'z.string().uuid()';
    case 'json':
    case 'jsonb':
      return 'z.unknown()';
    case 'date':
    case 'timestamp':
    case 'timestamptz':
    case 'time':
    case 'timetz':
      return 'z.coerce.date()';
    case 'inet':
    case 'cidr':
      return 'z.string()';
    case 'bytea':
      return 'z.instanceof(Uint8Array)';
    default:
      return 'z.string()';
  }
}

function zodType(schema: Schema, table: Table, col: Column): string {
  const en = enumOf(schema, col);
  let base = en ? `${camelCase(en.name)}Schema` : zodScalar(col.type.name);
  for (let i = 0; i < col.type.arrayDims; i++) base = `z.array(${base})`;
  if (!effectiveNotNull(table, col)) base += '.nullable()';
  return base;
}

export function generateZod(schema: Schema): string {
  const out: string[] = ["import { z } from 'zod';", ''];

  for (const en of [...schema.enums].sort((a, b) => a.name.localeCompare(b.name))) {
    const vals = en.values.map((v) => JSON.stringify(v)).join(', ');
    out.push(`export const ${camelCase(en.name)}Schema = z.enum([${vals}]);`);
  }
  if (schema.enums.length) out.push('');

  for (const table of schema.tables) {
    const base = camelCase(singular(table.name));
    out.push(`export const ${base}Schema = z.object({`);
    for (const col of table.columns) {
      out.push(`  ${propName(col.name)}: ${zodType(schema, table, col)},`);
    }
    out.push('});');

    // Insert variant: omit auto/defaulted columns.
    const omit = table.columns.filter(hasDefault).map((c) => `${propName(c.name)}: true`);
    if (omit.length) {
      out.push(`export const ${base}InsertSchema = ${base}Schema.omit({ ${omit.join(', ')} });`);
    } else {
      out.push(`export const ${base}InsertSchema = ${base}Schema;`);
    }
    out.push(
      `export type ${pascalCase(singular(table.name))} = z.infer<typeof ${base}Schema>;`,
      '',
    );
  }

  return out.join('\n');
}

function propName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

// Drizzle ORM schema generator (postgres-core). PRD §11.
import { indexesForTable } from '../model/schema.ts';
import type { Column, IndexKey, Schema } from '../model/types.ts';
import { camelCase, columnOf, enumOf, isPk, tableOf } from './util.ts';

function drizzleBuilder(col: Column, schema: Schema): { call: string; imp: string } {
  const en = enumOf(schema, col);
  if (en) return { call: `${camelCase(en.name)}Enum('${col.name}')`, imp: '' };
  const n = col.type.name;
  const q = `'${col.name}'`;
  switch (n) {
    case 'smallint':
      return { call: `smallint(${q})`, imp: 'smallint' };
    case 'integer':
    case 'serial':
      return col.identity !== 'none'
        ? { call: `serial(${q})`, imp: 'serial' }
        : { call: `integer(${q})`, imp: 'integer' };
    case 'bigint':
    case 'bigserial':
      return col.identity !== 'none'
        ? { call: `bigserial(${q}, { mode: 'number' })`, imp: 'bigserial' }
        : { call: `bigint(${q}, { mode: 'number' })`, imp: 'bigint' };
    case 'boolean':
      return { call: `boolean(${q})`, imp: 'boolean' };
    case 'numeric':
    case 'decimal':
      return {
        call: `numeric(${q}${col.type.args.length ? `, { precision: ${col.type.args[0]}, scale: ${col.type.args[1] ?? 0} }` : ''})`,
        imp: 'numeric',
      };
    case 'real':
      return { call: `real(${q})`, imp: 'real' };
    case 'double precision':
      return { call: `doublePrecision(${q})`, imp: 'doublePrecision' };
    case 'uuid':
      return { call: `uuid(${q})`, imp: 'uuid' };
    case 'varchar':
      return {
        call: `varchar(${q}${col.type.args[0] ? `, { length: ${col.type.args[0]} }` : ''})`,
        imp: 'varchar',
      };
    case 'char':
      return {
        call: `char(${q}${col.type.args[0] ? `, { length: ${col.type.args[0]} }` : ''})`,
        imp: 'char',
      };
    case 'text':
    case 'citext':
      return { call: `text(${q})`, imp: 'text' };
    case 'json':
      return { call: `json(${q})`, imp: 'json' };
    case 'jsonb':
      return { call: `jsonb(${q})`, imp: 'jsonb' };
    case 'date':
      return { call: `date(${q})`, imp: 'date' };
    case 'timestamp':
      return { call: `timestamp(${q})`, imp: 'timestamp' };
    case 'timestamptz':
      return { call: `timestamp(${q}, { withTimezone: true })`, imp: 'timestamp' };
    default:
      return { call: `text(${q})`, imp: 'text' };
  }
}

export function generateDrizzle(schema: Schema): string {
  const IMPORTS = new Set<string>(['pgTable']);
  const body: string[] = [];

  // enums
  for (const en of [...schema.enums].sort((a, b) => a.name.localeCompare(b.name))) {
    IMPORTS.add('pgEnum');
    const vals = en.values.map((v) => `'${v}'`).join(', ');
    body.push(`export const ${camelCase(en.name)}Enum = pgEnum('${en.name}', [${vals}]);`, '');
  }

  for (const table of schema.tables) {
    const varName = camelCase(table.name);
    body.push(`export const ${varName} = pgTable('${table.name}', {`);
    for (const col of table.columns) {
      const { call, imp } = drizzleBuilder(col, schema);
      if (imp) IMPORTS.add(imp);
      let chain = call;
      if (isPk(table, col) && table.primaryKey.length === 1) chain += '.primaryKey()';
      if (col.notNull && !(isPk(table, col) && table.primaryKey.length === 1))
        chain += '.notNull()';
      if (col.unique) chain += '.unique()';
      const fk = schema.relationships.find(
        (r) =>
          r.sourceTable === table.id &&
          r.sourceColumns.length === 1 &&
          r.sourceColumns[0] === col.id,
      );
      if (fk) {
        const tgt = tableOf(schema, fk.targetTable);
        const tgtCol = tgt ? columnOf(tgt, fk.targetColumns[0]!) : undefined;
        if (tgt && tgtCol) {
          const od =
            fk.onDelete !== 'no_action' ? `, { onDelete: '${fk.onDelete.replace('_', ' ')}' }` : '';
          chain += `.references(() => ${camelCase(tgt.name)}.${camelCase(tgtCol.name)}${od})`;
        }
      }
      if (col.default !== undefined) chain += drizzleDefault(col.default);
      body.push(`  ${camelCase(col.name)}: ${chain},`);
    }
    const extras: string[] = [];
    if (table.primaryKey.length > 1) {
      IMPORTS.add('primaryKey');
      extras.push(
        `    pk: primaryKey({ columns: [${table.primaryKey.map((id) => `t.${camelCase(columnOf(table, id)?.name ?? '')}`).join(', ')}] }),`,
      );
    }
    for (const ix of indexesForTable(schema, table.id)) {
      const cols = ix.keys
        .filter((k): k is Extract<IndexKey, { kind: 'column' }> => k.kind === 'column')
        .map((k) => `t.${camelCase(columnOf(table, k.column)?.name ?? '')}`);
      if (!cols.length) continue;
      IMPORTS.add(ix.unique ? 'uniqueIndex' : 'index');
      const fn = ix.unique ? 'uniqueIndex' : 'index';
      extras.push(
        `    ${camelCase(ix.name ?? `${table.name}_idx`)}: ${fn}('${ix.name ?? `${table.name}_idx`}').on(${cols.join(', ')}),`,
      );
    }
    if (extras.length) {
      body.push('}, (t) => ({', ...extras, '}));', '');
    } else {
      body.push('});', '');
    }
  }

  const imports = `import { ${[...IMPORTS].sort().join(', ')} } from 'drizzle-orm/pg-core';`;
  // sql`` is referenced by raw-expression defaults
  const needsSql = body.some((l) => l.includes('sql`'));
  const finalImports = needsSql ? `${imports}\nimport { sql } from 'drizzle-orm';` : imports;
  return `${finalImports}\n\n${body.join('\n').replace(/\n+$/, '')}\n`;
}

function drizzleDefault(raw: string): string {
  if (/^'(.*)'$/.test(raw)) return `.default(${raw})`;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return `.default(${raw})`;
  if (raw === 'true' || raw === 'false') return `.default(${raw})`;
  return `.default(sql\`${raw}\`)`;
}

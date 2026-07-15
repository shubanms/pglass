// TypeORM entity generator — decorators, @ManyToOne/@OneToMany pairs. PRD §11.
import type { Column, Schema, Table } from '../model/types.ts';
import {
  camelCase,
  effectiveNotNull,
  enumOf,
  isPk,
  pascalCase,
  singular,
  tableOf,
} from './util.ts';

function tsScalar(name: string): string {
  switch (name) {
    case 'smallint':
    case 'integer':
    case 'real':
    case 'double precision':
      return 'number';
    case 'bigint':
    case 'numeric':
    case 'decimal':
    case 'money':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'json':
    case 'jsonb':
      return 'unknown';
    case 'date':
    case 'timestamp':
    case 'timestamptz':
      return 'Date';
    default:
      return 'string';
  }
}

function ormColumnType(col: Column): string {
  const n = col.type.name;
  const map: Record<string, string> = {
    integer: 'int',
    smallint: 'smallint',
    bigint: 'bigint',
    'double precision': 'double precision',
    timestamptz: 'timestamptz',
  };
  return map[n] ?? n;
}

export function generateTypeOrm(schema: Schema): string {
  const out: string[] = [
    "import { Entity, PrimaryColumn, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';",
    '',
  ];

  for (const table of schema.tables) {
    const cls = pascalCase(singular(table.name));
    out.push(`@Entity(${JSON.stringify(table.name)})`);
    out.push(`export class ${cls} {`);

    for (const col of table.columns) {
      out.push(...ormColumn(schema, table, col).map((l) => `  ${l}`));
      out.push('');
    }
    // one-to-many back relations
    for (const rel of schema.relationships.filter((r) => r.targetTable === table.id)) {
      const child = tableOf(schema, rel.sourceTable);
      if (!child) continue;
      const childCls = pascalCase(singular(child.name));
      out.push(`  @OneToMany(() => ${childCls}, (row) => row.${camelCase(singular(table.name))})`);
      out.push(`  ${camelCase(child.name)}!: ${childCls}[];`, '');
    }
    // trim trailing blank line
    if (out[out.length - 1] === '') out.pop();
    out.push('}', '');
  }

  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function ormColumn(schema: Schema, table: Table, col: Column): string[] {
  const lines: string[] = [];
  const en = enumOf(schema, col);
  const fk = schema.relationships.find(
    (r) =>
      r.sourceTable === table.id && r.sourceColumns.length === 1 && r.sourceColumns[0] === col.id,
  );

  const isSinglePk = isPk(table, col) && table.primaryKey.length === 1;
  const notNull = effectiveNotNull(table, col);
  const optsParts: string[] = [];
  if (en)
    optsParts.push(`type: 'enum'`, `enum: [${en.values.map((v) => JSON.stringify(v)).join(', ')}]`);
  else optsParts.push(`type: '${ormColumnType(col)}'`);
  if (!notNull) optsParts.push('nullable: true');
  if (col.unique) optsParts.push('unique: true');
  if (col.default !== undefined) optsParts.push(`default: ${typeormDefault(col.default)}`);
  if (col.name !== camelCase(col.name)) optsParts.push(`name: ${JSON.stringify(col.name)}`);
  const opts = `{ ${optsParts.join(', ')} }`;

  const tsType = en ? en.values.map((v) => JSON.stringify(v)).join(' | ') : tsScalar(col.type.name);
  const nullSuffix = notNull ? '' : ' | null';

  if (isSinglePk && col.identity !== 'none') {
    lines.push('@PrimaryGeneratedColumn()');
  } else if (isSinglePk) {
    lines.push(`@PrimaryColumn(${opts})`);
  } else {
    lines.push(`@Column(${opts})`);
  }
  lines.push(`${camelCase(col.name)}!: ${tsType}${nullSuffix};`);

  // belongs-to relation for FK columns
  if (fk) {
    const tgt = tableOf(schema, fk.targetTable);
    if (tgt) {
      const od =
        fk.onDelete !== 'no_action'
          ? `, { onDelete: '${fk.onDelete.replace('_', ' ').toUpperCase()}' }`
          : '';
      lines.push('');
      lines.push(`@ManyToOne(() => ${pascalCase(singular(tgt.name))}${od})`);
      lines.push(`@JoinColumn({ name: ${JSON.stringify(col.name)} })`);
      lines.push(`${camelCase(singular(tgt.name))}!: ${pascalCase(singular(tgt.name))};`);
    }
  }
  return lines;
}

function typeormDefault(raw: string): string {
  if (/^'(.*)'$/.test(raw)) return raw.replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  if (raw === 'true' || raw === 'false') return raw;
  return `() => ${JSON.stringify(raw)}`;
}

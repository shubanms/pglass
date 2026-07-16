// SQLAlchemy 2.0 generator — Mapped[...] / mapped_column() style with
// relationship() back_populates on both sides. PRD §11.
import type { Column, Schema, Table } from '../model/types.ts';
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

function pyType(col: Column, schema: Schema): string {
  const en = enumOf(schema, col);
  if (en) return enumTypeName(en.name);
  switch (col.type.name) {
    case 'smallint':
    case 'integer':
    case 'bigint':
    case 'serial':
    case 'bigserial':
      return 'int';
    case 'real':
    case 'double precision':
      return 'float';
    case 'numeric':
    case 'decimal':
    case 'money':
      return 'Decimal';
    case 'boolean':
      return 'bool';
    case 'json':
    case 'jsonb':
      return 'dict';
    case 'uuid':
      return 'uuid.UUID';
    case 'date':
      return 'date';
    case 'timestamp':
    case 'timestamptz':
      return 'datetime';
    case 'bytea':
      return 'bytes';
    default:
      return 'str';
  }
}

function saColumnType(col: Column, schema: Schema): string {
  const en = enumOf(schema, col);
  if (en) return `SAEnum(${enumTypeName(en.name)}, name='${en.name}')`;
  switch (col.type.name) {
    case 'smallint':
      return 'SmallInteger';
    case 'integer':
    case 'serial':
      return 'Integer';
    case 'bigint':
    case 'bigserial':
      return 'BigInteger';
    case 'real':
    case 'double precision':
      return 'Float';
    case 'numeric':
    case 'decimal':
      return col.type.args.length ? `Numeric(${col.type.args.join(', ')})` : 'Numeric';
    case 'boolean':
      return 'Boolean';
    case 'jsonb':
      return 'JSONB';
    case 'json':
      return 'JSON';
    case 'uuid':
      return 'PgUUID(as_uuid=True)';
    case 'varchar':
      return col.type.args[0] ? `String(${col.type.args[0]})` : 'String';
    case 'text':
    case 'citext':
      return 'Text';
    case 'date':
      return 'Date';
    case 'timestamp':
      return 'DateTime';
    case 'timestamptz':
      return 'DateTime(timezone=True)';
    default:
      return 'Text';
  }
}

export function generateSqlAlchemy(schema: Schema): string {
  const out: string[] = [
    'from __future__ import annotations',
    'from datetime import date, datetime',
    'from decimal import Decimal',
    'import enum',
    'import uuid',
    'from sqlalchemy import (BigInteger, Boolean, Date, DateTime, Enum as SAEnum, Float,',
    '    ForeignKey, Integer, Numeric, SmallInteger, String, Text, Index, CheckConstraint)',
    'from sqlalchemy.dialects.postgresql import JSON, JSONB, UUID as PgUUID',
    'from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship',
    '',
    '',
    'class Base(DeclarativeBase):',
    '    pass',
    '',
  ];

  for (const en of [...schema.enums].sort((a, b) => a.name.localeCompare(b.name))) {
    out.push('', `class ${enumTypeName(en.name)}(enum.Enum):`);
    for (const v of en.values)
      out.push(`    ${v.replace(/[^A-Za-z0-9_]/g, '_')} = ${JSON.stringify(v)}`);
    out.push('');
  }

  for (const table of schema.tables) {
    out.push('', `class ${pascalCase(singular(table.name))}(Base):`);
    out.push(`    __tablename__ = ${JSON.stringify(table.name)}`);
    out.push('');
    for (const col of table.columns) {
      out.push(`    ${saColumnLine(schema, table, col)}`);
    }
    // relationships
    for (const rel of schema.relationships.filter((r) => r.sourceTable === table.id)) {
      const tgt = tableOf(schema, rel.targetTable);
      if (!tgt) continue;
      const attr = camelCase(singular(tgt.name));
      out.push(
        `    ${attr}: Mapped["${pascalCase(singular(tgt.name))}"] = relationship(back_populates="${camelCase(table.name)}")`,
      );
    }
    for (const rel of schema.relationships.filter((r) => r.targetTable === table.id)) {
      const child = tableOf(schema, rel.sourceTable);
      if (!child) continue;
      out.push(
        `    ${camelCase(child.name)}: Mapped[list["${pascalCase(singular(child.name))}"]] = relationship(back_populates="${camelCase(singular(table.name))}")`,
      );
    }
    // __table_args__ for composite PK / checks / indexes
    const args: string[] = [];
    for (const chk of table.checks)
      args.push(
        `CheckConstraint(${JSON.stringify(chk.expr)}${chk.name ? `, name=${JSON.stringify(chk.name)}` : ''})`,
      );
    if (args.length) {
      out.push('', `    __table_args__ = (${args.join(', ')},)`);
    }
    out.push('');
  }

  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function saColumnLine(schema: Schema, table: Table, col: Column): string {
  const parts: string[] = [saColumnType(col, schema)];
  const fk = schema.relationships.find(
    (r) =>
      r.sourceTable === table.id && r.sourceColumns.length === 1 && r.sourceColumns[0] === col.id,
  );
  if (fk) {
    const tgt = tableOf(schema, fk.targetTable);
    const tgtCol = tgt ? columnOf(tgt, fk.targetColumns[0]!) : undefined;
    if (tgt && tgtCol) {
      const od =
        fk.onDelete !== 'no_action'
          ? `, ondelete=${JSON.stringify(fk.onDelete.replace('_', ' ').toUpperCase())}`
          : '';
      parts.push(`ForeignKey("${tgt.name}.${tgtCol.name}"${od})`);
    }
  }
  const notNull = effectiveNotNull(table, col);
  if (isPk(table, col)) parts.push('primary_key=True');
  if (col.identity !== 'none') parts.push('autoincrement=True');
  if (!notNull) parts.push('nullable=True');
  if (col.unique) parts.push('unique=True');

  const py = pyType(col, schema);
  const opt = notNull ? py : `${py} | None`;
  return `${col.name}: Mapped[${opt}] = mapped_column(${parts.join(', ')})`;
}

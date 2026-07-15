// Faker-based seed data (PRD §11.1). FK-aware: tables are inserted in
// topological order and FK columns draw from already-generated parent keys.
// Faker is dynamically imported so it stays out of the main app bundle.
import type { Faker } from '@faker-js/faker';
import type { Column, Schema, Table } from '../model/types.ts';
import { columnOf, enumOf, isAutoColumn, tableOf, topoTables } from './util.ts';

export interface SeedOptions {
  rows?: number;
  perTable?: Record<string, number>;
  seed?: number;
}

export async function generateSeed(schema: Schema, opts: SeedOptions = {}): Promise<string> {
  const { faker } = await import('@faker-js/faker');
  faker.seed(opts.seed ?? 42);
  return buildSeed(schema, faker, opts);
}

/** Split out so tests can inject a seeded faker synchronously. */
export function buildSeed(schema: Schema, faker: Faker, opts: SeedOptions = {}): string {
  const defaultRows = opts.rows ?? 10;
  const { order, cyclic } = topoTables(schema);
  const generated = new Map<string, Record<string, unknown>[]>(); // tableId → rows
  const out: string[] = ['BEGIN;', ''];
  if (cyclic) {
    out.push(
      '-- ⚠ FK cycle detected; nullable edges are broken with NULLs.',
      'SET CONSTRAINTS ALL DEFERRED;',
      '',
    );
  }

  for (const table of order) {
    const n = opts.perTable?.[table.name] ?? defaultRows;
    const rows: Record<string, unknown>[] = [];
    const seenUnique = new Map<string, Set<string>>();

    for (let i = 0; i < n; i++) {
      const row: Record<string, unknown> = {};
      for (const col of table.columns) {
        if (isAutoColumn(col)) continue; // identity/generated → let the DB fill
        row[col.name] = valueFor(schema, faker, table, col, generated, i);
      }
      // enforce single-column UNIQUE with a few retries
      for (const col of table.columns) {
        if (!col.unique) continue;
        const set = seenUnique.get(col.name) ?? new Set();
        let tries = 0;
        while (set.has(String(row[col.name])) && tries++ < 20) {
          row[col.name] = valueFor(schema, faker, table, col, generated, i + tries * 997);
        }
        set.add(String(row[col.name]));
        seenUnique.set(col.name, set);
      }
      rows.push(row);
    }
    generated.set(table.id, rows);

    // emit INSERT
    const cols = table.columns.filter((c) => !isAutoColumn(c));
    if (cols.length === 0 || rows.length === 0) continue;
    out.push(`INSERT INTO ${table.name} (${cols.map((c) => c.name).join(', ')}) VALUES`);
    const tuples = rows.map((r) => `  (${cols.map((c) => sqlLiteral(r[c.name])).join(', ')})`);
    out.push(`${tuples.join(',\n')};`, '');
  }

  out.push('COMMIT;');
  return `${out.join('\n')}\n`;
}

function valueFor(
  schema: Schema,
  faker: Faker,
  table: Table,
  col: Column,
  generated: Map<string, Record<string, unknown>[]>,
  i: number,
): unknown {
  // FK column → draw from an already-generated parent key
  const fk = schema.relationships.find(
    (r) =>
      r.sourceTable === table.id && r.sourceColumns.length === 1 && r.sourceColumns[0] === col.id,
  );
  if (fk) {
    if (!col.notNull && faker.number.int({ min: 0, max: 99 }) < 15) return null;
    const parent = tableOf(schema, fk.targetTable);
    const parentRows = parent ? generated.get(parent.id) : undefined;
    const targetCol = parent ? columnOf(parent, fk.targetColumns[0]!) : undefined;
    if (parent && parentRows && parentRows.length && targetCol) {
      // parent PK may be an identity column not stored in the row → synthesize 1..N
      const pick = faker.helpers.arrayElement(parentRows);
      const v = pick[targetCol.name];
      return v ?? faker.number.int({ min: 1, max: parentRows.length });
    }
    return col.notNull ? faker.number.int({ min: 1, max: 10 }) : null;
  }

  if (!col.notNull && faker.number.int({ min: 0, max: 99 }) < 8) return null;

  const en = enumOf(schema, col);
  if (en) return faker.helpers.arrayElement(en.values);

  return byName(faker, col) ?? byType(faker, col, i);
}

// A fixed reference date so date generation is deterministic (faker.date.*
// otherwise anchors on Date.now(), which drifts between calls).
const REF_DATE = new Date('2025-01-01T00:00:00.000Z');

function byName(faker: Faker, col: Column): unknown {
  const n = col.name.toLowerCase();
  if (/email/.test(n)) return faker.internet.email();
  if (/first_?name/.test(n)) return faker.person.firstName();
  if (/last_?name/.test(n)) return faker.person.lastName();
  if (/full_?name|^name$/.test(n)) return faker.person.fullName();
  if (/phone/.test(n)) return faker.phone.number();
  if (/url|website/.test(n)) return faker.internet.url();
  if (/address|street/.test(n)) return faker.location.streetAddress();
  if (/city/.test(n)) return faker.location.city();
  if (/country/.test(n)) return faker.location.country();
  if (/zip|postal/.test(n)) return faker.location.zipCode();
  if (/slug/.test(n)) return faker.lorem.slug();
  if (/description|bio|content|body/.test(n)) return faker.lorem.paragraph();
  if (/title|subject/.test(n)) return faker.lorem.sentence();
  if (/(price|amount|cost|total|cents)/.test(n) && isIntType(col))
    return faker.number.int({ min: 100, max: 99999 });
  if (/created_at/.test(n)) return faker.date.past({ refDate: REF_DATE });
  if (/updated_at/.test(n)) return faker.date.recent({ refDate: REF_DATE });
  if (/deleted_at/.test(n))
    return faker.number.int({ min: 0, max: 9 }) < 9
      ? null
      : faker.date.recent({ refDate: REF_DATE });
  if (/^(is_|has_|can_)/.test(n) && col.type.name === 'boolean')
    return faker.number.int({ min: 0, max: 99 }) < 70;
  return undefined;
}

function byType(faker: Faker, col: Column, i: number): unknown {
  switch (col.type.name) {
    case 'uuid':
      return faker.string.uuid();
    case 'boolean':
      return faker.datatype.boolean();
    case 'smallint':
    case 'integer':
    case 'bigint':
      return faker.number.int({ min: 1, max: 10000 });
    case 'real':
    case 'double precision':
    case 'numeric':
    case 'decimal':
    case 'money':
      return Number(faker.number.float({ min: 0, max: 10000, fractionDigits: 2 }));
    case 'date':
      return faker.date.past({ refDate: REF_DATE });
    case 'timestamp':
    case 'timestamptz':
      return faker.date.past({ refDate: REF_DATE });
    case 'json':
    case 'jsonb':
      return { k: faker.lorem.word(), n: i };
    case 'inet':
      return faker.internet.ip();
    default:
      return faker.lorem.word();
  }
}

function isIntType(col: Column): boolean {
  return ['smallint', 'integer', 'bigint'].includes(col.type.name);
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

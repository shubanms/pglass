import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { faker } from '@faker-js/faker';
import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import { GENERATORS } from '../index.ts';
import { buildSeed } from '../seed.ts';

const schema = parse(
  readFileSync(resolve(process.cwd(), 'public/samples/ecommerce.pgl'), 'utf8'),
).schema;

describe('generators — golden snapshots', () => {
  for (const gen of GENERATORS) {
    if (gen.id === 'seed') continue;
    it(`${gen.label} output is stable`, async () => {
      const out = await gen.run(schema);
      expect(out).toMatchSnapshot();
    });
  }
});

describe('generators — structural guarantees', () => {
  it('TypeScript: PK columns are non-nullable, enums are unions', async () => {
    const out = (await GENERATORS.find((g) => g.id === 'typescript')!.run(schema)) as string;
    expect(out).toContain('export type OrderStatus =');
    expect(out).toMatch(/id: string;/); // users.id (pk uuid) — not `| null`
    expect(out).toContain('export interface Database {');
  });

  it('Zod: emits an Insert variant that omits defaulted columns', async () => {
    const out = (await GENERATORS.find((g) => g.id === 'zod')!.run(schema)) as string;
    expect(out).toContain('export const userInsertSchema = userSchema.omit(');
    expect(out).toContain('orderStatusSchema');
  });

  it('Prisma: enum name is not singularized; PK is required', async () => {
    const out = (await GENERATORS.find((g) => g.id === 'prisma')!.run(schema)) as string;
    expect(out).toContain('enum OrderStatus {');
    expect(out).toMatch(/id String @id/);
    expect(out).toContain('@relation(fields: [userId], references: [id]');
  });

  it('Drizzle: pgTable + references with onDelete', async () => {
    const out = (await GENERATORS.find((g) => g.id === 'drizzle')!.run(schema)) as string;
    expect(out).toContain("pgEnum('order_status'");
    expect(out).toContain('.references(() => users.id, { onDelete: ');
  });

  it('Mermaid: erDiagram with crow-foot relationships', async () => {
    const out = (await GENERATORS.find((g) => g.id === 'mermaid')!.run(schema)) as string;
    expect(out.startsWith('erDiagram')).toBe(true);
    expect(out).toMatch(/users \|\|--o\{ orders/);
  });

  it('DBML: tables, enums, and refs', async () => {
    const out = (await GENERATORS.find((g) => g.id === 'dbml')!.run(schema)) as string;
    expect(out).toContain('Table users {');
    expect(out).toContain('Enum order_status {');
    expect(out).toMatch(/Ref: orders\.user_id > users\.id/);
  });

  it('JSON Schema: valid JSON, one def per table', async () => {
    const out = (await GENERATORS.find((g) => g.id === 'json-schema')!.run(schema)) as string;
    const doc = JSON.parse(out);
    expect(doc.$schema).toContain('2020-12');
    expect(Object.keys(doc.$defs).sort()).toEqual(['order_items', 'orders', 'products', 'users']);
    expect(doc.$defs.orders.properties.status.enum).toEqual([
      'pending',
      'paid',
      'shipped',
      'cancelled',
    ]);
  });

  it('SQLAlchemy: Mapped columns + relationships', async () => {
    const out = (await GENERATORS.find((g) => g.id === 'sqlalchemy')!.run(schema)) as string;
    expect(out).toContain('class User(Base):');
    expect(out).toContain('Mapped[');
    expect(out).toContain('ForeignKey("users.id"');
  });

  it('Markdown: TOC, column tables, embedded mermaid', async () => {
    const out = (await GENERATORS.find((g) => g.id === 'markdown')!.run(schema)) as string;
    expect(out).toContain('```mermaid');
    expect(out).toContain('| Column | Type | Null |');
  });
});

describe('seed generator', () => {
  const seeded = () => {
    faker.seed(123);
    return buildSeed(schema, faker, { rows: 5 });
  };

  it('is deterministic for a fixed seed', () => {
    expect(seeded()).toBe(seeded());
  });

  it('emits FK-ordered inserts inside a transaction', () => {
    const sql = seeded();
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    // parents before children: users/products inserted before orders/order_items
    expect(sql.indexOf('INSERT INTO users')).toBeLessThan(sql.indexOf('INSERT INTO orders'));
    expect(sql.indexOf('INSERT INTO products')).toBeLessThan(
      sql.indexOf('INSERT INTO order_items'),
    );
  });

  it('omits identity columns from inserts', () => {
    const sql = seeded();
    // products.id is identity → should not appear in its column list
    const productsInsert = sql.split('INSERT INTO products')[1]?.split(';')[0] ?? '';
    expect(productsInsert).not.toMatch(/\bid\b/);
  });

  it('uses faker name-based mapping (emails look like emails)', () => {
    const sql = seeded();
    expect(sql).toMatch(/@/); // users.email → faker email
  });
});

import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import { autoLayout } from '../auto-layout.ts';

const SRC = `table users {
  id uuid [pk]
}

table orders {
  id bigint [pk]
  user_id uuid [not null, ref: > users.id]
}

table order_items {
  id bigint [pk]
  order_id bigint [not null, ref: > orders.id]
}
`;

describe('elkjs auto-layout', () => {
  it('returns a position for every table', async () => {
    const schema = parse(SRC).schema;
    const positions = await autoLayout(schema, 'layered');
    expect(positions.size).toBe(3);
    for (const t of schema.tables) {
      expect(positions.has(t.id)).toBe(true);
    }
  });

  it('spreads tables apart (no two share the same position)', async () => {
    const schema = parse(SRC).schema;
    const positions = await autoLayout(schema, 'layered');
    const seen = new Set<string>();
    for (const p of positions.values()) {
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('lays a hierarchy out left-to-right (parent left of child)', async () => {
    const schema = parse(SRC).schema;
    const positions = await autoLayout(schema, 'layered');
    const users = positions.get(schema.tables.find((t) => t.name === 'users')!.id)!;
    const orders = positions.get(schema.tables.find((t) => t.name === 'orders')!.id)!;
    expect(users.x).toBeLessThan(orders.x); // RIGHT direction
  });

  it('selection-only layout only returns positions for the selected tables', async () => {
    const schema = parse(SRC).schema;
    const onlyId = schema.tables.find((t) => t.name === 'orders')!.id;
    const positions = await autoLayout(schema, 'layered', new Set([onlyId]));
    expect(positions.size).toBe(1);
    expect(positions.has(onlyId)).toBe(true);
  });

  it('handles an empty schema', async () => {
    const positions = await autoLayout(parse('').schema, 'layered');
    expect(positions.size).toBe(0);
  });
});

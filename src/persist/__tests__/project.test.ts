import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import type { Schema } from '../../model/types.ts';
import { applyLayout, extractLayout, packProject, unpackProject } from '../project.ts';

function withVisualState(src: string): Schema {
  const s = parse(src).schema;
  // simulate canvas edits the DSL doesn't encode
  s.tables[0]!.pos = { x: 320, y: 180 };
  s.tables[0]!.size = { w: 260, h: 140 };
  s.tables[0]!.collapsed = true;
  if (s.relationships[0]) {
    s.relationships[0].waypoints = [{ x: 10, y: 20 }];
    s.relationships[0].color = '#ff0000';
  }
  return s;
}

const SRC = `table users [color: #4F46E5] {
  id uuid [pk]
}

table orders {
  id bigint [pk, increment]
  user_id uuid [not null, ref: > users.id [delete: cascade]]
}
`;

describe('.pglass project file', () => {
  it('packs to a zip containing schema.pgl / layout.json / meta.json', () => {
    const bytes = packProject(withVisualState(SRC));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    const text = new TextDecoder().decode(bytes);
    // zip local file headers include the file names
    expect(text).toContain('schema.pgl');
    expect(text).toContain('layout.json');
    expect(text).toContain('meta.json');
  });

  it('round-trips structure and visual state through pack → unpack', () => {
    const original = withVisualState(SRC);
    const restored = unpackProject(packProject(original));

    // table set is preserved (array order reflects canvas reading order)
    expect(restored.tables.map((t) => t.name).sort()).toEqual(['orders', 'users']);
    const users = restored.tables.find((t) => t.name === 'users')!;
    expect(users.pos).toEqual({ x: 320, y: 180 }); // position preserved
    expect(users.size).toEqual({ w: 260, h: 140 });
    expect(users.collapsed).toBe(true);
    expect(users.color).toBe('#4F46E5');
    // relationship visual state
    expect(restored.relationships[0]?.waypoints).toEqual([{ x: 10, y: 20 }]);
    expect(restored.relationships[0]?.color).toBe('#ff0000');
    // FK structure survives
    expect(restored.relationships).toHaveLength(1);
    expect(restored.relationships[0]?.onDelete).toBe('cascade');
  });

  it('preserves meta (extensions, raw objects) not expressible in the DSL', () => {
    const s = parse(SRC).schema;
    s.meta.extensions = ['citext', 'pgcrypto'];
    s.meta.rawObjects = [{ kind: 'view', name: 'v', sql: 'CREATE VIEW v AS SELECT 1;' }];
    const restored = unpackProject(packProject(s));
    expect(restored.meta.extensions).toEqual(['citext', 'pgcrypto']);
    expect(restored.meta.rawObjects?.[0]?.name).toBe('v');
  });

  it('applyLayout re-attaches positions to a freshly parsed schema', () => {
    const original = withVisualState(SRC);
    const layout = extractLayout(original);
    const fresh = parse(SRC).schema; // no positions
    const merged = applyLayout(fresh, layout);
    expect(merged.tables.find((t) => t.name === 'users')?.pos).toEqual({ x: 320, y: 180 });
  });

  it('tolerates a schema.pgl-only zip (missing layout/meta)', () => {
    // a plain schema with no special visual state still round-trips
    const s = parse('table t {\n  id bigint [pk]\n}\n').schema;
    const restored = unpackProject(packProject(s));
    expect(restored.tables[0]?.name).toBe('t');
  });
});

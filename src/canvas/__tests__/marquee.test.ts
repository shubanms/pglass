import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import { gridLayout } from '../../layout/grid.ts';
import { tableBox, tablesInRect } from '../geometry.ts';

const schema = gridLayout(
  parse(
    'table a {\n  id bigint [pk]\n}\n\ntable b {\n  id bigint [pk]\n}\n\ntable c {\n  id bigint [pk]\n}\n',
  ).schema,
);

describe('tablesInRect (marquee select)', () => {
  it('selects a table whose box the rect overlaps', () => {
    const a = schema.tables.find((t) => t.name === 'a')!;
    const b = tableBox(a);
    const hit = tablesInRect(schema, { x: b.x + 5, y: b.y + 5, w: 10, h: 10 });
    expect(hit).toContain(a.id);
  });

  it('normalises a rect dragged up-and-left (negative w/h)', () => {
    const a = schema.tables.find((t) => t.name === 'a')!;
    const b = tableBox(a);
    // start at bottom-right of the box, drag back to top-left
    const hit = tablesInRect(schema, {
      x: b.x + b.w + 5,
      y: b.y + b.h + 5,
      w: -(b.w + 10),
      h: -(b.h + 10),
    });
    expect(hit).toContain(a.id);
  });

  it('excludes tables the rect does not touch', () => {
    // a tiny rect far from everything
    expect(tablesInRect(schema, { x: -9999, y: -9999, w: 1, h: 1 })).toEqual([]);
  });

  it('can select multiple tables at once', () => {
    // a huge rect covers all three
    const hit = tablesInRect(schema, { x: -10000, y: -10000, w: 20000, h: 20000 });
    expect(hit.length).toBe(3);
  });
});

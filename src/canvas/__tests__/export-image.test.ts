import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import { gridLayout } from '../../layout/grid.ts';
import { type Palette, buildSvg } from '../export-image.ts';

const PAL: Palette = {
  bg: '#fff',
  bgElevated: '#fff',
  border: '#ccc',
  text: '#000',
  textMuted: '#888',
  accent: '#4f46e5',
  grid: '#eee',
};

const SCHEMA = gridLayout(
  parse(`table users {
  id bigint [pk]
  email text
}

table orders {
  id bigint [pk]
  user_id bigint [ref: > users.id]
}
`).schema,
);

describe('buildSvg', () => {
  it('emits a well-formed svg with a tight viewBox', () => {
    const svg = buildSvg(SCHEMA, PAL);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toMatch(/viewBox="[-\d. ]+"/);
  });

  it('includes every table name and column', () => {
    const svg = buildSvg(SCHEMA, PAL);
    expect(svg).toContain('users');
    expect(svg).toContain('orders');
    expect(svg).toContain('email');
    expect(svg).toContain('user_id');
  });

  it('draws an edge for the foreign key', () => {
    const svg = buildSvg(SCHEMA, PAL);
    // one <path> for the FK route
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('selection export includes only the chosen table (no cross edges)', () => {
    const onlyUsers = new Set([SCHEMA.tables.find((t) => t.name === 'users')!.id]);
    const svg = buildSvg(SCHEMA, PAL, { selection: onlyUsers });
    expect(svg).toContain('email');
    expect(svg).not.toContain('user_id'); // orders excluded
    expect(svg.match(/<path /g)).toBeNull(); // no edges within a single table
  });

  it('omits the background rect when background:false (transparent)', () => {
    const opaque = buildSvg(SCHEMA, PAL, { background: true });
    const transparent = buildSvg(SCHEMA, PAL, { background: false });
    expect(opaque.length).toBeGreaterThan(transparent.length);
  });

  it('adds a grid pattern when requested', () => {
    expect(buildSvg(SCHEMA, PAL, { includeGrid: true })).toContain('pgl-grid');
    expect(buildSvg(SCHEMA, PAL, { includeGrid: false })).not.toContain('pgl-grid');
  });

  it('escapes special characters in identifiers', () => {
    const s = gridLayout(parse('table "a<b>" {\n  id bigint [pk]\n}\n').schema);
    const svg = buildSvg(s, PAL);
    expect(svg).toContain('a&lt;b&gt;');
    expect(svg).not.toContain('a<b>');
  });
});

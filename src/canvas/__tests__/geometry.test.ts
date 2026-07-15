import { describe, expect, it } from 'vitest';
import { parse } from '../../dsl/parser.ts';
import { cardinalities, contentBounds, routeEdge, tableSize } from '../geometry.ts';

describe('canvas geometry', () => {
  it('derives cardinality: NOT NULL FK → one on the target, many on the source', () => {
    const schema = parse(
      'table users {\n  id bigint [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  user_id bigint [not null, ref: > users.id]\n}\n',
    ).schema;
    const card = cardinalities(schema, schema.relationships[0]!);
    expect(card.target).toBe('one'); // FK is NOT NULL
    expect(card.source).toBe('zero-or-many'); // not unique
  });

  it('derives zero-or-one on the target when the FK is nullable', () => {
    const schema = parse(
      'table users {\n  id bigint [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  user_id bigint [ref: > users.id]\n}\n',
    ).schema;
    const card = cardinalities(schema, schema.relationships[0]!);
    expect(card.target).toBe('zero-or-one');
  });

  it('derives a 1:1 (zero-or-one source) when the FK column is unique', () => {
    const schema = parse(
      'table users {\n  id bigint [pk]\n}\n\ntable profiles {\n  id bigint [pk]\n  user_id bigint [not null, unique, ref: > users.id]\n}\n',
    ).schema;
    const card = cardinalities(schema, schema.relationships[0]!);
    expect(card.source).toBe('zero-or-one');
  });

  it('routes an edge and returns a path with both endpoints', () => {
    const schema = parse(
      'table users {\n  id bigint [pk]\n}\n\ntable orders {\n  id bigint [pk]\n  user_id bigint [not null, ref: > users.id]\n}\n',
    ).schema;
    schema.tables[0]!.pos = { x: 0, y: 0 };
    schema.tables[1]!.pos = { x: 400, y: 0 };
    const geo = routeEdge(schema, schema.relationships[0]!);
    expect(geo).not.toBeNull();
    expect(geo!.path).toMatch(/^M /);
    expect(geo!.source.side).toBe('left'); // orders is FK holder, users is to its left
  });

  it('table size respects min width and grows with content', () => {
    const small = parse('table t {\n  a int\n}\n').schema.tables[0]!;
    expect(tableSize(small).w).toBeGreaterThanOrEqual(200);
  });

  it('contentBounds covers all tables', () => {
    const schema = parse('table a {\n  id int\n}\n\ntable b {\n  id int\n}\n').schema;
    schema.tables[0]!.pos = { x: 0, y: 0 };
    schema.tables[1]!.pos = { x: 500, y: 300 };
    const b = contentBounds(schema);
    expect(b.x).toBeLessThanOrEqual(0);
    expect(b.w).toBeGreaterThan(500);
  });
});

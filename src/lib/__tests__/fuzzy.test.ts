import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyRank } from '../fuzzy.ts';

describe('fuzzyMatch', () => {
  it('matches a subsequence', () => {
    expect(fuzzyMatch('usr', 'users')).not.toBeNull();
    expect(fuzzyMatch('oi', 'order_items')).not.toBeNull();
  });

  it('rejects when a query char is missing or out of order', () => {
    expect(fuzzyMatch('xyz', 'users')).toBeNull();
    expect(fuzzyMatch('sru', 'users')).toBeNull();
  });

  it('empty query matches everything with score 0', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
  });

  it('scores a prefix higher than a mid-string match', () => {
    const prefix = fuzzyMatch('use', 'users')!;
    const mid = fuzzyMatch('use', 'abuser')!;
    expect(prefix.score).toBeGreaterThan(mid.score);
  });

  it('scores a word-boundary match higher', () => {
    const boundary = fuzzyMatch('oi', 'order_items')!; // o…, then i at word start
    const scattered = fuzzyMatch('oi', 'foobrit')!; // wherever it lands mid-word
    expect(boundary.score).toBeGreaterThan(scattered?.score ?? Number.NEGATIVE_INFINITY);
  });

  it('reports matched positions', () => {
    expect(fuzzyMatch('ab', 'xaxbx')!.positions).toEqual([1, 3]);
  });
});

describe('fuzzyRank', () => {
  const names = ['users', 'orders', 'order_items', 'products', 'user_sessions'];

  it('ranks the closest match first', () => {
    const ranked = fuzzyRank('ord', names, (n) => n);
    expect(ranked[0]!.item).toBe('orders');
    expect(ranked.map((r) => r.item)).toContain('order_items');
    expect(ranked.map((r) => r.item)).not.toContain('products');
  });

  it('empty query preserves input order', () => {
    const ranked = fuzzyRank('', names, (n) => n);
    expect(ranked.map((r) => r.item)).toEqual(names);
  });
});

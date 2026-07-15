import { describe, expect, it } from 'vitest';
import { arityAccepts, canonicalTypeName, isBuiltinType, lookupType } from '../types.ts';

describe('postgres type catalog', () => {
  it('resolves aliases to canonical names', () => {
    expect(canonicalTypeName('int4')).toBe('integer');
    expect(canonicalTypeName('int8')).toBe('bigint');
    expect(canonicalTypeName('bool')).toBe('boolean');
    expect(canonicalTypeName('timestamp with time zone')).toBe('timestamptz');
  });

  it('recognises builtins and rejects unknowns', () => {
    expect(isBuiltinType('jsonb')).toBe(true);
    expect(isBuiltinType('CITEXT')).toBe(true);
    expect(isBuiltinType('made_up_type')).toBe(false);
  });

  it('includes common extension types as first-class', () => {
    expect(isBuiltinType('vector')).toBe(true);
    expect(isBuiltinType('geometry')).toBe(true);
    expect(isBuiltinType('ltree')).toBe(true);
  });

  it('enforces arity', () => {
    const uuid = lookupType('uuid')!;
    expect(arityAccepts(uuid.arity, 0)).toBe(true);
    expect(arityAccepts(uuid.arity, 1)).toBe(false);

    const numeric = lookupType('numeric')!;
    expect(arityAccepts(numeric.arity, 0)).toBe(true);
    expect(arityAccepts(numeric.arity, 1)).toBe(true);
    expect(arityAccepts(numeric.arity, 2)).toBe(true);

    const varchar = lookupType('varchar')!;
    expect(arityAccepts(varchar.arity, 1)).toBe(true);
    expect(arityAccepts(varchar.arity, 2)).toBe(false);
  });
});

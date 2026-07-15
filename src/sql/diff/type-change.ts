// ALTER COLUMN TYPE analysis: risk classification (§9.3) + USING generator (§9.6).
import { typeStr } from '../../dsl/printer.ts';
import type { PgType } from '../../model/types.ts';
import { lookupType } from '../types.ts';

export interface TypeChange {
  using?: string;
  risk: 'safe' | 'lock' | 'destructive' | 'lossy';
  warning?: string;
}

const NUMERIC_RANK: Record<string, number> = { smallint: 1, integer: 2, bigint: 3 };

function category(t: PgType): string {
  return lookupType(t.name)?.category ?? 'other';
}

/**
 * Analyse a column type change and return the USING clause + risk + warning.
 * `col` is the (quoted) column identifier used in the USING expression.
 */
export function analyzeTypeChange(from: PgType, to: PgType, col: string): TypeChange {
  const fromName = from.name;
  const toName = to.name;
  const toType = typeStr(to);

  // any → text
  if (toName === 'text') {
    return { using: `${col}::text`, risk: 'lock', warning: WIDEN };
  }

  // text/varchar → numeric
  if (
    (fromName === 'text' || fromName === 'varchar' || fromName === 'citext') &&
    category(to) === 'numeric'
  ) {
    return { using: `${col}::${toType}`, risk: 'lossy', warning: LOSSY };
  }

  // text → uuid
  if (fromName === 'text' && toName === 'uuid') {
    return { using: `${col}::uuid`, risk: 'lossy', warning: LOSSY };
  }
  // text → jsonb / json
  if (fromName === 'text' && (toName === 'jsonb' || toName === 'json')) {
    return { using: `${col}::${toName}`, risk: 'lossy', warning: LOSSY };
  }

  // numeric widening / narrowing within integer family
  if (NUMERIC_RANK[fromName] && NUMERIC_RANK[toName]) {
    if (NUMERIC_RANK[toName]! > NUMERIC_RANK[fromName]!) {
      return { risk: 'lock', warning: WIDEN }; // int → bigint, no USING
    }
    return { using: `${col}::${toType}`, risk: 'lossy', warning: NARROW };
  }

  // timestamp → timestamptz
  if (fromName === 'timestamp' && toName === 'timestamptz') {
    return {
      using: `${col} AT TIME ZONE 'UTC'`,
      risk: 'lock',
      warning: 'Assumes stored values are UTC. Rewrites the table.',
    };
  }

  // varchar(n) → varchar(m)
  if (fromName === 'varchar' && toName === 'varchar') {
    const n = from.args[0];
    const m = to.args[0];
    if (n !== undefined && m !== undefined && m < n) {
      return { using: `left(${col}, ${m})`, risk: 'lossy', warning: NARROW };
    }
    return { risk: 'lock', warning: WIDEN }; // widening or unbounded
  }

  // varchar → text handled above (toName==='text').  char/varchar widening:
  if ((fromName === 'varchar' || fromName === 'char') && toName === 'varchar') {
    return { risk: 'lock', warning: WIDEN };
  }

  // enum → text handled above.  text → enum
  if (fromName === 'text' && to.udtId) {
    return { using: `${col}::${toName}`, risk: 'lossy', warning: LOSSY };
  }
  // enum → text (enum is a udt)
  if (from.udtId && toName === 'text') {
    return { using: `${col}::text`, risk: 'lock', warning: WIDEN };
  }

  // same category, e.g. numeric(10,2) → numeric(12,4): treat as widening/narrowing
  if (category(from) === category(to)) {
    // numeric scale down heuristic
    const fromScale = from.args[1] ?? 0;
    const toScale = to.args[1] ?? 0;
    if (category(from) === 'numeric' && toScale < fromScale) {
      return { using: `${col}::${toType}`, risk: 'lossy', warning: NARROW };
    }
    return { risk: 'lock', warning: WIDEN };
  }

  // anything else — incompatible categories
  return {
    using: `${col}::${toType}`,
    risk: 'lossy',
    warning: 'Requires an explicit USING clause. Generated USING is a guess — review it.',
  };
}

const WIDEN = 'Rewrites the table and holds ACCESS EXCLUSIVE.';
const NARROW = 'May fail or truncate on existing rows.';
const LOSSY = 'May fail or truncate on existing rows.';

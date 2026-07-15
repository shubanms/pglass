// CONTRACT — Postgres type catalog. See PRD §6.
// This drives parsing (is a type name known?), arity checking, display badges,
// and the seed generator's faker mapping.

export type TypeArity = 0 | 1 | 2 | '0|1' | '0|1|2';

export interface TypeSpec {
  name: string; // canonical
  aliases: string[]; // e.g. int4 → integer
  category:
    | 'numeric'
    | 'string'
    | 'datetime'
    | 'boolean'
    | 'json'
    | 'uuid'
    | 'binary'
    | 'network'
    | 'geometric'
    | 'range'
    | 'fulltext'
    | 'bit'
    | 'money'
    | 'xml'
    | 'other';
  /** how many precision/scale args it accepts */
  arity: TypeArity;
  /** default args when omitted, for display */
  defaultArgs?: number[];
  /** shown as a small badge on the column row */
  short: string;
  /** faker generator key used by seed.ts */
  faker?: string;
}

// biome-ignore format: keep the catalog as a readable aligned table
const CATALOG: TypeSpec[] = [
  // numeric
  { name: 'smallint',         aliases: ['int2'],                      category: 'numeric',  arity: 0,        short: 'i16',  faker: 'number.int' },
  { name: 'integer',          aliases: ['int', 'int4'],               category: 'numeric',  arity: 0,        short: 'int',  faker: 'number.int' },
  { name: 'bigint',           aliases: ['int8'],                      category: 'numeric',  arity: 0,        short: 'i64',  faker: 'number.int' },
  { name: 'decimal',          aliases: ['numeric'],                   category: 'numeric',  arity: '0|1|2',  short: 'dec',  faker: 'number.float' },
  { name: 'numeric',          aliases: ['decimal'],                   category: 'numeric',  arity: '0|1|2',  short: 'num',  faker: 'number.float' },
  { name: 'real',             aliases: ['float4'],                    category: 'numeric',  arity: 0,        short: 'f32',  faker: 'number.float' },
  { name: 'double precision', aliases: ['float8'],                    category: 'numeric',  arity: 0,        short: 'f64',  faker: 'number.float' },
  { name: 'smallserial',      aliases: ['serial2'],                   category: 'numeric',  arity: 0,        short: 'ser' },
  { name: 'serial',           aliases: ['serial4'],                   category: 'numeric',  arity: 0,        short: 'ser' },
  { name: 'bigserial',        aliases: ['serial8'],                   category: 'numeric',  arity: 0,        short: 'ser' },
  { name: 'money',            aliases: [],                            category: 'money',    arity: 0,        short: '$' },

  // string
  { name: 'char',             aliases: ['character'],                 category: 'string',   arity: '0|1',    short: 'chr' },
  { name: 'varchar',          aliases: ['character varying'],         category: 'string',   arity: '0|1',    short: 'str',  faker: 'lorem.word' },
  { name: 'text',             aliases: [],                            category: 'string',   arity: 0,        short: 'txt',  faker: 'lorem.sentence' },
  { name: 'citext',           aliases: [],                            category: 'string',   arity: 0,        short: 'txt',  faker: 'lorem.word' },
  { name: 'name',             aliases: [],                            category: 'string',   arity: 0,        short: 'nam' },

  // datetime
  { name: 'date',             aliases: [],                            category: 'datetime', arity: 0,        short: 'date', faker: 'date.past' },
  { name: 'time',             aliases: [],                            category: 'datetime', arity: '0|1',    short: 'time' },
  { name: 'timetz',           aliases: ['time with time zone'],       category: 'datetime', arity: '0|1',    short: 'timez' },
  { name: 'timestamp',        aliases: [],                            category: 'datetime', arity: '0|1',    short: 'ts',   faker: 'date.past' },
  { name: 'timestamptz',      aliases: ['timestamp with time zone'],  category: 'datetime', arity: '0|1',    short: 'tstz', faker: 'date.past' },
  { name: 'interval',         aliases: [],                            category: 'datetime', arity: 0,        short: 'ival' },

  // boolean
  { name: 'boolean',          aliases: ['bool'],                      category: 'boolean',  arity: 0,        short: 'bool', faker: 'datatype.boolean' },

  // json
  { name: 'json',             aliases: [],                            category: 'json',     arity: 0,        short: 'json' },
  { name: 'jsonb',            aliases: [],                            category: 'json',     arity: 0,        short: 'jsnb' },

  // uuid
  { name: 'uuid',             aliases: [],                            category: 'uuid',     arity: 0,        short: 'uuid', faker: 'string.uuid' },

  // binary
  { name: 'bytea',            aliases: [],                            category: 'binary',   arity: 0,        short: 'bin' },

  // network
  { name: 'inet',             aliases: [],                            category: 'network',  arity: 0,        short: 'inet', faker: 'internet.ip' },
  { name: 'cidr',             aliases: [],                            category: 'network',  arity: 0,        short: 'cidr' },
  { name: 'macaddr',          aliases: [],                            category: 'network',  arity: 0,        short: 'mac',  faker: 'internet.mac' },
  { name: 'macaddr8',         aliases: [],                            category: 'network',  arity: 0,        short: 'mac8' },

  // geometric
  { name: 'point',            aliases: [],                            category: 'geometric', arity: 0,       short: 'pt' },
  { name: 'line',             aliases: [],                            category: 'geometric', arity: 0,       short: 'line' },
  { name: 'lseg',             aliases: [],                            category: 'geometric', arity: 0,       short: 'lseg' },
  { name: 'box',              aliases: [],                            category: 'geometric', arity: 0,       short: 'box' },
  { name: 'path',             aliases: [],                            category: 'geometric', arity: 0,       short: 'path' },
  { name: 'polygon',          aliases: [],                            category: 'geometric', arity: 0,       short: 'poly' },
  { name: 'circle',           aliases: [],                            category: 'geometric', arity: 0,       short: 'circ' },

  // range
  { name: 'int4range',        aliases: [],                            category: 'range',    arity: 0,        short: 'rng' },
  { name: 'int8range',        aliases: [],                            category: 'range',    arity: 0,        short: 'rng' },
  { name: 'numrange',         aliases: [],                            category: 'range',    arity: 0,        short: 'rng' },
  { name: 'tsrange',          aliases: [],                            category: 'range',    arity: 0,        short: 'rng' },
  { name: 'tstzrange',        aliases: [],                            category: 'range',    arity: 0,        short: 'rng' },
  { name: 'daterange',        aliases: [],                            category: 'range',    arity: 0,        short: 'rng' },
  { name: 'int4multirange',   aliases: [],                            category: 'range',    arity: 0,        short: 'mrng' },
  { name: 'int8multirange',   aliases: [],                            category: 'range',    arity: 0,        short: 'mrng' },
  { name: 'nummultirange',    aliases: [],                            category: 'range',    arity: 0,        short: 'mrng' },
  { name: 'tsmultirange',     aliases: [],                            category: 'range',    arity: 0,        short: 'mrng' },
  { name: 'tstzmultirange',   aliases: [],                            category: 'range',    arity: 0,        short: 'mrng' },
  { name: 'datemultirange',   aliases: [],                            category: 'range',    arity: 0,        short: 'mrng' },

  // fulltext
  { name: 'tsvector',         aliases: [],                            category: 'fulltext', arity: 0,        short: 'tsv' },
  { name: 'tsquery',          aliases: [],                            category: 'fulltext', arity: 0,        short: 'tsq' },

  // bit
  { name: 'bit',              aliases: [],                            category: 'bit',      arity: '0|1',    short: 'bit' },
  { name: 'varbit',           aliases: ['bit varying'],               category: 'bit',      arity: '0|1',    short: 'vbit' },

  // xml
  { name: 'xml',              aliases: [],                            category: 'xml',      arity: 0,        short: 'xml' },

  // other
  { name: 'oid',              aliases: [],                            category: 'other',    arity: 0,        short: 'oid' },
  { name: 'pg_lsn',           aliases: [],                            category: 'other',    arity: 0,        short: 'lsn' },
  { name: 'txid_snapshot',    aliases: [],                            category: 'other',    arity: 0,        short: 'txid' },
  { name: 'void',             aliases: [],                            category: 'other',    arity: 0,        short: 'void' },

  // common extension types — first-class per PRD §6
  { name: 'vector',           aliases: [],                            category: 'other',    arity: '0|1',    short: 'vec' },
  { name: 'geometry',         aliases: [],                            category: 'other',    arity: 0,        short: 'geom' },
  { name: 'geography',        aliases: [],                            category: 'other',    arity: 0,        short: 'geog' },
  { name: 'hstore',           aliases: [],                            category: 'other',    arity: 0,        short: 'hst' },
  { name: 'ltree',            aliases: [],                            category: 'other',    arity: 0,        short: 'ltre' },
];

const BY_NAME = new Map<string, TypeSpec>();
for (const spec of CATALOG) {
  BY_NAME.set(spec.name, spec);
  for (const alias of spec.aliases) {
    // Canonical names win over aliases if there's a clash (decimal/numeric).
    if (!BY_NAME.has(alias)) BY_NAME.set(alias, spec);
  }
}

export const TYPE_CATALOG: readonly TypeSpec[] = CATALOG;

/** Look up a type by canonical name or alias (case-insensitive). */
export function lookupType(name: string): TypeSpec | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** Canonicalize a type name (int4 → integer), or return as-is if unknown. */
export function canonicalTypeName(name: string): string {
  return BY_NAME.get(name.toLowerCase())?.name ?? name;
}

export function isBuiltinType(name: string): boolean {
  return BY_NAME.has(name.toLowerCase());
}

/** Is the given number of args legal for this type? */
export function arityAccepts(arity: TypeArity, argCount: number): boolean {
  switch (arity) {
    case 0:
      return argCount === 0;
    case 1:
      return argCount === 1;
    case 2:
      return argCount === 2;
    case '0|1':
      return argCount === 0 || argCount === 1;
    case '0|1|2':
      return argCount >= 0 && argCount <= 2;
  }
}

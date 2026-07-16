// The single source of truth for the Pglass data model. Every other module
// reads/writes these types. See PRD §4 — this file mirrors the CONTRACT verbatim.

// ─── IDs ────────────────────────────────────────────────────────────────
// Stable, content-independent. Survives renames. Format: "t_<nanoid8>" etc.
export type TableId = string & { readonly __brand: 'TableId' };
export type ColumnId = string & { readonly __brand: 'ColumnId' };
export type RelId = string & { readonly __brand: 'RelId' };
export type IndexId = string & { readonly __brand: 'IndexId' };
export type EnumId = string & { readonly __brand: 'EnumId' };
export type ViewId = string & { readonly __brand: 'ViewId' };
export type NoteId = string & { readonly __brand: 'NoteId' };
export type GroupId = string & { readonly __brand: 'GroupId' };

// ─── Postgres types ─────────────────────────────────────────────────────
export interface PgType {
  /** canonical lowercase base name, e.g. "varchar", "numeric", "timestamptz", "jsonb" */
  name: string;
  /** e.g. varchar(255) → [255]; numeric(10,2) → [10, 2] */
  args: number[];
  /** number of array dimensions. text[] → 1, text[][] → 2 */
  arrayDims: number;
  /** references a user-defined enum/domain/composite by id, if not a builtin */
  udtId?: EnumId;
}

// ─── Columns ────────────────────────────────────────────────────────────
export type IdentityKind = 'none' | 'always' | 'by_default';
export type GeneratedKind = { kind: 'none' } | { kind: 'stored'; expr: string };

export interface Column {
  id: ColumnId;
  name: string;
  type: PgType;
  notNull: boolean;
  /** PK membership is derived from Table.primaryKey — do NOT store it here */
  unique: boolean; // single-column UNIQUE; multi-col lives in Index
  default?: string; // raw SQL expression, unquoted by us
  identity: IdentityKind;
  generated: GeneratedKind;
  /** raw SQL boolean expression, e.g. "price > 0" */
  check?: string;
  collation?: string;
  comment?: string;
  /** for canvas display only */
  color?: string;
}

// ─── Tables ─────────────────────────────────────────────────────────────
export interface Table {
  id: TableId;
  /** postgres schema namespace, default "public" */
  namespace: string;
  name: string;
  columns: Column[];
  /** ordered column ids; empty array = no PK */
  primaryKey: ColumnId[];
  /** table-level CHECK constraints (multi-column) */
  checks: { name?: string; expr: string }[];
  comment?: string;
  /** PARTITION BY — parsed and preserved, round-trips, not visually special */
  partitionBy?: { strategy: 'range' | 'list' | 'hash'; columns: ColumnId[] };
  /** UNLOGGED / TEMPORARY */
  persistence?: 'unlogged' | 'temporary';
  /** RLS enabled flag — preserved on round-trip */
  rowLevelSecurity?: boolean;
  /** visual */
  pos: { x: number; y: number };
  size?: { w: number; h: number }; // computed if absent
  color?: string; // header accent
  collapsed?: boolean;
  groupId?: GroupId;
  /** visual: render this junction table as a single M:N edge between its parents
   *  (PRD §12.3). A UI flag — not emitted to the DSL, preserved across merges. */
  showAsMN?: boolean;
}

// ─── Relationships ──────────────────────────────────────────────────────
/**
 * Cardinality is DERIVED, not authored:
 *   many-to-one  : FK columns are not unique
 *   one-to-one   : FK columns carry a UNIQUE constraint
 *   many-to-many : detected as a JUNCTION VIEW over two FKs — never stored as a Rel
 * Store the FK exactly as Postgres models it: N columns → N columns.
 */
export type RefAction = 'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default';

export interface Relationship {
  id: RelId;
  name?: string; // constraint name; auto-generated if absent
  /** the table holding the FK columns */
  sourceTable: TableId;
  sourceColumns: ColumnId[];
  /** the referenced table */
  targetTable: TableId;
  targetColumns: ColumnId[]; // MUST be same length as sourceColumns
  onDelete: RefAction;
  onUpdate: RefAction;
  deferrable?: boolean;
  initiallyDeferred?: boolean;
  comment?: string;
  /** visual: manual waypoints override auto-routing */
  waypoints?: { x: number; y: number }[];
  color?: string;
}

// ─── Indexes ────────────────────────────────────────────────────────────
export type IndexMethod = 'btree' | 'hash' | 'gin' | 'gist' | 'brin' | 'spgist';

export type IndexKey =
  | {
      kind: 'column';
      column: ColumnId;
      opclass?: string;
      sort?: 'asc' | 'desc';
      nulls?: 'first' | 'last';
    }
  | { kind: 'expr'; expr: string };

export interface Index {
  id: IndexId;
  table: TableId;
  name?: string;
  unique: boolean;
  method: IndexMethod;
  /** each entry is either a column ref or a raw expression */
  keys: IndexKey[];
  /** INCLUDE (...) covering columns */
  include?: ColumnId[];
  /** WHERE clause — partial index */
  where?: string;
  comment?: string;
}

// ─── User-defined types ─────────────────────────────────────────────────
export interface EnumType {
  id: EnumId;
  namespace: string;
  name: string;
  values: string[];
  comment?: string;
  /** per-value notes, keyed by value */
  valueNotes?: Record<string, string>;
  pos?: { x: number; y: number }; // enums render on canvas too
  color?: string;
}

/** A (materialized) view — modelled first-class: the query body is preserved
 *  verbatim, and the view renders on the canvas with dependency edges. */
export interface View {
  id: ViewId;
  namespace: string;
  name: string;
  /** the SELECT body (everything after `AS`), preserved verbatim */
  query: string;
  materialized: boolean;
  comment?: string;
  /** visual */
  pos?: { x: number; y: number };
  color?: string;
}

// ─── Visual-only entities ───────────────────────────────────────────────
export interface StickyNote {
  id: NoteId;
  text: string; // markdown
  pos: { x: number; y: number };
  size: { w: number; h: number };
  color: string;
}

export interface TableGroup {
  id: GroupId;
  name: string;
  color: string;
  /** membership is stored on Table.groupId; this is just presentation */
  collapsed?: boolean;
}

// ─── The root ───────────────────────────────────────────────────────────
export interface Schema {
  /** bump on breaking model changes; migrate on load */
  version: 1;
  name: string;
  tables: Table[];
  relationships: Relationship[];
  indexes: Index[];
  enums: EnumType[];
  views: View[];
  notes: StickyNote[];
  groups: TableGroup[];
  /** ordered list of namespaces to render/emit; "public" always present */
  namespaces: string[];
  meta: {
    createdAt: string;
    updatedAt: string;
    /** free-form project description, markdown */
    description?: string;
    /** CREATE EXTENSION names captured on import, re-emitted on export */
    extensions?: string[];
    /** verbatim SQL objects we preserve but do not model (views, functions, …) */
    rawObjects?: { kind: string; name: string; sql: string }[];
  };
}

// ─── Diagnostics (shared by parser, validator, linter) ──────────────────
export interface Range {
  from: number;
  to: number;
} // char offsets in DSL text

export type DiagnosticTarget =
  | { kind: 'table'; id: TableId }
  | { kind: 'column'; table: TableId; id: ColumnId }
  | { kind: 'rel'; id: RelId }
  | { kind: 'index'; id: IndexId }
  | { kind: 'enum'; id: EnumId };

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  /** stable machine code, e.g. "PGL001", "LINT_NO_PK" */
  code: string;
  message: string;
  /** location in DSL text, if the diagnostic originated there */
  range?: Range;
  /** location in the model, if it originated from validation/lint */
  target?: DiagnosticTarget;
  /** optional one-click fix */
  fix?: { title: string; apply: (s: Schema) => Schema };
}

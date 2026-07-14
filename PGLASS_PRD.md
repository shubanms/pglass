# PRD: **Pglass** — PostgreSQL Schema Design Studio

> **Read this whole document before writing any code.** It is written to be executed end-to-end in one pass. Every section that says **CONTRACT** is a hard interface that later sections depend on — do not improvise those signatures. Sections marked **DEFER** are explicitly out of scope for v1; do not build them.

---

## 0. TL;DR for the implementing agent

Build a **100% client-side, static-hosted PostgreSQL schema design tool**. No backend, no server, no auth, no network calls at runtime. It deploys as static files to GitHub Pages.

The tool is a **bidirectional** editor: a text DSL (`pgl`) and a visual ER canvas are two views of one in-memory model. Editing either updates the other. The model can be imported from real `pg_dump --schema-only` output and exported to Postgres DDL, migration diffs, ORM schemas, and images.

**Success = a single-page app where I can paste a `pg_dump` of a real database, see a correct ER diagram, edit it visually, lint it, diff it against the original, and copy out the `ALTER TABLE` statements.**

---

## 1. Non-negotiable constraints

| Constraint | Consequence |
|---|---|
| Static hosting (GitHub Pages, project subpath) | `vite.config.ts` must set `base: './'`. All routes are hash-based or none at all. No SSR, no API routes. |
| Zero runtime network calls | No CDN fonts, no analytics, no telemetry, no LLM calls. Everything bundles. Fonts are self-hosted in `public/fonts`. |
| Zero backend | Persistence is IndexedDB + File System Access API + file download/upload only. |
| PostgreSQL only | Do not add MySQL/SQLite/MSSQL dialect branches anywhere. One dialect, done deeply. |
| Single user | No auth, no realtime, no CRDT, no presence. |
| Must handle a 300-table schema | Canvas must virtualize. Parser must run in a Worker. Target: parse 300 tables in <1.5s, render at 45+ fps while panning. |
| Offline-first | Ship a service worker. App must fully function with the network cable pulled. |

**If a feature cannot be built under these constraints, it is not in this product. Do not stub it, do not fake it, do not add a "coming soon" button.**

---

## 2. Technology stack — use exactly this

```
Language      TypeScript 5.6+, "strict": true, noUncheckedIndexedAccess: true
Build         Vite 6
UI            React 19
Canvas        Custom SVG renderer (NOT React Flow — see §2.1)
State         Zustand 5 + immer middleware + zundo (undo/redo)
Text editor   CodeMirror 6 (@codemirror/state, /view, /language, /autocomplete, /lint)
Parser        Hand-rolled lexer + recursive-descent parser (NO parser generator, NO chevrotain)
Layout        elkjs 0.9 (run inside a Web Worker)
Persistence   Dexie 4 (IndexedDB) + File System Access API
Styling       Tailwind CSS 4 + CSS variables for theming
Icons         lucide-react
Fake data     @faker-js/faker
Testing       Vitest + @testing-library/react
Formatting    Biome (lint + format) — not ESLint/Prettier
Deploy        GitHub Actions → GitHub Pages
```

### 2.1 Why a custom SVG renderer, not React Flow

React Flow re-renders nodes on every viewport change and its edge routing cannot do orthogonal crow's-foot routing with port anchoring. We need:
- Edges that anchor to a **specific column row**, not the table node
- Orthogonal (Manhattan) routing with obstacle avoidance
- Virtualized rendering of only the visible viewport
- Deterministic export to standalone SVG

Build the canvas as a single `<svg>` with a `<g>` transform for pan/zoom. Tables are `<g>` elements. This gives free SVG export and full routing control.

---

## 3. Repository layout — create exactly this

```
pglass/
├── .github/workflows/deploy.yml
├── public/
│   ├── fonts/                     # Inter (UI) + JetBrains Mono (code), .woff2, self-hosted
│   └── samples/
│       ├── ecommerce.pgl
│       ├── saas-multitenant.pgl
│       └── northwind.sql          # real pg_dump output, for import testing
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   │
│   ├── model/                     # ── Pure data. Zero React, zero DOM. ──
│   │   ├── types.ts               # CONTRACT §4
│   │   ├── schema.ts              # Schema class, invariants, lookups
│   │   ├── ids.ts                 # stable ID generation
│   │   ├── validate.ts            # structural validation (not linting)
│   │   └── __tests__/
│   │
│   ├── dsl/                       # ── The .pgl language ──
│   │   ├── lexer.ts
│   │   ├── parser.ts              # → { schema, diagnostics }
│   │   ├── printer.ts             # schema → .pgl text (canonical, stable)
│   │   ├── grammar.md             # human-readable spec, mirrors §5
│   │   ├── cm-language.ts         # CodeMirror StreamLanguage + highlight
│   │   ├── cm-autocomplete.ts
│   │   ├── cm-lint.ts             # bridges diagnostics → CM lint gutter
│   │   └── __tests__/
│   │
│   ├── sql/                       # ── Postgres DDL in/out ──
│   │   ├── import/
│   │   │   ├── tokenizer.ts
│   │   │   ├── ddl-parser.ts      # CREATE TABLE/TYPE/INDEX, ALTER ... ADD CONSTRAINT
│   │   │   └── pgdump-preprocess.ts  # strips SET/SELECT pg_catalog/COPY/comments
│   │   ├── export/
│   │   │   ├── ddl-writer.ts      # schema → CREATE ... (idempotent option)
│   │   │   ├── drop-writer.ts
│   │   │   └── format.ts          # consistent indentation, keyword casing
│   │   ├── diff/
│   │   │   ├── differ.ts          # CONTRACT §9
│   │   │   ├── plan.ts            # ordered, dependency-aware ALTER plan
│   │   │   └── render.ts          # plan → SQL text with safety annotations
│   │   ├── types.ts               # Postgres type catalog — CONTRACT §6
│   │   └── __tests__/
│   │
│   ├── lint/
│   │   ├── engine.ts
│   │   ├── rules/                 # one file per rule — §10
│   │   └── __tests__/
│   │
│   ├── layout/
│   │   ├── elk.worker.ts
│   │   ├── auto-layout.ts
│   │   └── routing.ts             # orthogonal edge routing + crow's foot geometry
│   │
│   ├── canvas/
│   │   ├── Canvas.tsx             # <svg> root, viewport, virtualization
│   │   ├── TableNode.tsx
│   │   ├── ColumnRow.tsx
│   │   ├── Edge.tsx
│   │   ├── EdgeMarkers.tsx        # crow's foot / one / zero-or-one SVG <defs>
│   │   ├── Minimap.tsx
│   │   ├── SelectionBox.tsx
│   │   ├── StickyNote.tsx
│   │   ├── TableGroup.tsx
│   │   ├── useViewport.ts         # pan/zoom, wheel, pinch, space-drag
│   │   ├── useSelection.ts
│   │   └── useDragCreate.ts       # drag column → column to make an FK
│   │
│   ├── generators/
│   │   ├── prisma.ts
│   │   ├── drizzle.ts
│   │   ├── sqlalchemy.ts
│   │   ├── typeorm.ts
│   │   ├── zod.ts
│   │   ├── typescript.ts          # plain interfaces
│   │   ├── mermaid.ts
│   │   ├── plantuml.ts
│   │   ├── dbml.ts                # interop with dbdiagram.io
│   │   ├── markdown.ts            # data dictionary
│   │   ├── json-schema.ts
│   │   └── seed.ts                # faker-based INSERTs, FK-topologically ordered
│   │
│   ├── export/
│   │   ├── svg.ts                 # standalone .svg with inlined fonts
│   │   ├── png.ts                 # rasterize svg → canvas → blob, 1x/2x/4x
│   │   └── pdf.ts                 # DEFER — do not build
│   │
│   ├── store/
│   │   ├── index.ts               # Zustand store — CONTRACT §7
│   │   ├── slices/
│   │   │   ├── schema.slice.ts
│   │   │   ├── viewport.slice.ts
│   │   │   ├── selection.slice.ts
│   │   │   ├── ui.slice.ts
│   │   │   └── history.slice.ts
│   │   └── sync.ts                # the text↔model reconciliation loop — §8
│   │
│   ├── persist/
│   │   ├── db.ts                  # Dexie schema
│   │   ├── autosave.ts
│   │   ├── fs-access.ts           # File System Access API wrapper + fallback
│   │   └── project.ts             # .pglass project file (zip: model + layout + meta)
│   │
│   ├── ui/
│   │   ├── AppShell.tsx
│   │   ├── TopBar.tsx
│   │   ├── LeftPanel.tsx          # schema tree / outline
│   │   ├── EditorPane.tsx         # CodeMirror
│   │   ├── RightPanel.tsx         # inspector (selected table/column props)
│   │   ├── BottomPanel.tsx        # tabs: Diagnostics | Lint | Diff | Generated
│   │   ├── CommandPalette.tsx
│   │   ├── ExportDialog.tsx
│   │   ├── DiffDialog.tsx
│   │   ├── ImportDialog.tsx
│   │   ├── SettingsDialog.tsx
│   │   ├── Shortcuts.tsx
│   │   └── components/            # Button, Dialog, Tabs, Select, Tooltip, Toast…
│   │
│   └── lib/
│       ├── graph.ts               # topo sort, cycle detection, SCC
│       ├── geometry.ts
│       ├── hotkeys.ts
│       └── download.ts
├── index.html
├── vite.config.ts
├── biome.json
├── tsconfig.json
└── README.md
```

---

## 4. CONTRACT — The data model (`src/model/types.ts`)

This is the single source of truth. Every other module reads/writes this. **Write this file first, exactly as specified.**

```ts
// ─── IDs ────────────────────────────────────────────────────────────────
// Stable, content-independent. Survives renames. Format: "t_<nanoid8>" etc.
export type TableId  = string & { readonly __brand: 'TableId' };
export type ColumnId = string & { readonly __brand: 'ColumnId' };
export type RelId    = string & { readonly __brand: 'RelId' };
export type IndexId  = string & { readonly __brand: 'IndexId' };
export type EnumId   = string & { readonly __brand: 'EnumId' };
export type NoteId   = string & { readonly __brand: 'NoteId' };
export type GroupId  = string & { readonly __brand: 'GroupId' };

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
  unique: boolean;              // single-column UNIQUE; multi-col lives in Index
  default?: string;             // raw SQL expression, unquoted by us
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
  size?: { w: number; h: number };   // computed if absent
  color?: string;                     // header accent
  collapsed?: boolean;
  groupId?: GroupId;
}

// ─── Relationships ──────────────────────────────────────────────────────
/**
 * Cardinality is DERIVED, not authored:
 *   many-to-one  : FK columns are not unique
 *   one-to-one   : FK columns carry a UNIQUE constraint
 *   many-to-many : detected as a JUNCTION VIEW over two FKs — never stored as a Rel
 * Store the FK exactly as Postgres models it: N columns → N columns.
 */
export type RefAction =
  | 'no_action' | 'restrict' | 'cascade' | 'set_null' | 'set_default';

export interface Relationship {
  id: RelId;
  name?: string;                    // constraint name; auto-generated if absent
  /** the table holding the FK columns */
  sourceTable: TableId;
  sourceColumns: ColumnId[];
  /** the referenced table */
  targetTable: TableId;
  targetColumns: ColumnId[];        // MUST be same length as sourceColumns
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

export interface Index {
  id: IndexId;
  table: TableId;
  name?: string;
  unique: boolean;
  method: IndexMethod;
  /** each entry is either a column ref or a raw expression */
  keys: (
    | { kind: 'column'; column: ColumnId; opclass?: string; sort?: 'asc' | 'desc'; nulls?: 'first' | 'last' }
    | { kind: 'expr'; expr: string }
  )[];
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
  pos?: { x: number; y: number };   // enums render on canvas too
  color?: string;
}

// ─── Visual-only entities ───────────────────────────────────────────────
export interface StickyNote {
  id: NoteId;
  text: string;                     // markdown
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
  notes: StickyNote[];
  groups: TableGroup[];
  /** ordered list of namespaces to render/emit; "public" always present */
  namespaces: string[];
  meta: {
    createdAt: string;
    updatedAt: string;
    /** free-form project description, markdown */
    description?: string;
  };
}

// ─── Diagnostics (shared by parser, validator, linter) ──────────────────
export interface Range { from: number; to: number; }   // char offsets in DSL text

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  /** stable machine code, e.g. "PGL001", "LINT_NO_PK" */
  code: string;
  message: string;
  /** location in DSL text, if the diagnostic originated there */
  range?: Range;
  /** location in the model, if it originated from validation/lint */
  target?:
    | { kind: 'table'; id: TableId }
    | { kind: 'column'; table: TableId; id: ColumnId }
    | { kind: 'rel'; id: RelId }
    | { kind: 'index'; id: IndexId }
    | { kind: 'enum'; id: EnumId };
  /** optional one-click fix */
  fix?: { title: string; apply: (s: Schema) => Schema };
}
```

### 4.1 Model invariants (enforce in `validate.ts`, run on every mutation in dev)

1. Every `ColumnId` referenced anywhere resolves to a column on the stated table.
2. `Relationship.sourceColumns.length === targetColumns.length` and `> 0`.
3. `Relationship.targetColumns` must be exactly the target's PK **or** be covered by a UNIQUE index/constraint on the target. If not → `Diagnostic` error `PGL201`, do not silently allow.
4. Column names unique within a table (case-insensitive — Postgres folds).
5. Table names unique within a namespace.
6. `Table.primaryKey` entries all belong to that table, no duplicates.
7. No relationship where source === target with identical columns (a self-FK to itself).
8. Enum values are non-empty and unique within the enum.
9. Index keys reference columns of `Index.table`.
10. `PgType.args` length must be legal for the base type (see §6 catalog).

Violations of 1, 4, 5, 6, 9 are **structural corruption** — throw. The rest are `Diagnostic`s.
---

## 5. CONTRACT — The `.pgl` DSL

The DSL is the **authoring** format. It is not SQL. It is terser than SQL and it is what round-trips losslessly with the model. Design goal: a schema written in `.pgl` should be ~40% the character count of the equivalent DDL, and diff cleanly in git.

### 5.1 Complete grammar (EBNF)

```ebnf
File          ::= Statement*
Statement     ::= Project | Namespace | Enum | Table | Ref | Index | Note | Group | Comment

Comment       ::= "//" .* NEWLINE
                | "/*" .* "*/"

Project       ::= "project" String "{" ProjectBody "}"
ProjectBody   ::= ( "description" ":" String )?

Namespace     ::= "namespace" Ident                  // sets the current namespace for
                                                      // following tables until next `namespace`
                                                      // default is `public`

Enum          ::= "enum" QualName "{" EnumValue+ "}"
EnumValue     ::= String_or_Ident ( "[" Settings "]" )?   // settings: note

Table         ::= "table" QualName ( "as" Ident )? ( "[" Settings "]" )? "{" TableBody "}"
                  // `as` gives a short alias usable in Ref statements
TableBody     ::= ( ColumnDef | TableIndexes | TableChecks | TableNoteBlock )*

ColumnDef     ::= Ident Type ( "[" Settings "]" )?

Type          ::= TypeName ( "(" Int ( "," Int )? ")" )? ( "[" "]" )*
TypeName      ::= Ident ( "." Ident )?              // enum refs may be qualified

Settings      ::= Setting ( "," Setting )*
Setting       ::= "pk" | "primary key"
                | "increment"                       // → identity: by_default + integer-ish type
                | "not null" | "null"
                | "unique"
                | "default" ":" DefaultVal
                | "note" ":" String
                | "check" ":" String                // raw SQL expr
                | "generated" ":" String            // stored generated expr
                | "identity" ":" ( "always" | "by default" )
                | "collate" ":" String
                | "color" ":" HexColor
                | "ref" ":" InlineRef                // inline single-column FK shorthand

DefaultVal    ::= String | Number | "true" | "false" | "null" | "`" RawSQL "`"
                  // backticks = raw SQL expression, e.g. `now()`, `gen_random_uuid()`

InlineRef     ::= RefOp QualName "." Ident ( "[" RefSettings "]" )?
RefOp         ::= ">"      // many-to-one  (this column → that column)
                | "<"      // one-to-many  (that column → this column)
                | "-"      // one-to-one
RefSettings   ::= ( "delete" ":" RefAction | "update" ":" RefAction
                  | "name" ":" String | "note" ":" String ) ( "," ... )*
RefAction     ::= "cascade" | "restrict" | "set null" | "set default" | "no action"

Ref           ::= "ref" Ident? ":" RefSpec ( "[" RefSettings "]" )?
RefSpec       ::= ColRefList RefOp ColRefList
ColRefList    ::= QualName "." Ident
                | QualName "." "(" Ident ( "," Ident )* ")"     // composite FK

TableIndexes  ::= "indexes" "{" IndexDef+ "}"
IndexDef      ::= IndexKeys ( "[" IndexSettings "]" )?
IndexKeys     ::= Ident
                | "(" IndexKey ( "," IndexKey )* ")"
IndexKey      ::= Ident ( "asc" | "desc" )? ( "nulls" ( "first" | "last" ) )?
                | "`" RawSQL "`"                     // expression index
IndexSettings ::= ( "unique" | "pk"
                  | "type" ":" ( "btree"|"hash"|"gin"|"gist"|"brin"|"spgist" )
                  | "name" ":" String
                  | "where" ":" String               // partial index predicate
                  | "include" ":" "(" Ident+ ")"
                  | "note" ":" String ) ( "," ... )*

TableChecks   ::= "checks" "{" CheckDef+ "}"
CheckDef      ::= String ( "[" "name" ":" String "]" )?

TableNoteBlock::= "note" ":" String
                | "note" "{" MultilineString "}"

Note          ::= "note" Ident "{" MultilineString "}"    // free-floating sticky note

Group         ::= "group" Ident ( "[" "color" ":" HexColor "]" )? "{" Ident+ "}"
                  // body is a list of table names

QualName      ::= Ident ( "." Ident )?               // namespace.table
Ident         ::= [A-Za-z_][A-Za-z0-9_]* | '"' .+ '"'
String        ::= "'" ... "'" | '"' ... '"'
MultilineString ::= "'''" ... "'''"
HexColor      ::= "#" [0-9a-fA-F]{6}
```

### 5.2 Canonical example — the printer MUST produce output in exactly this shape

```pgl
project "Acme Store" {
  description: 'Order + inventory schema'
}

enum order_status {
  pending
  paid
  shipped
  cancelled [note: 'terminal state']
}

table users [color: #4F46E5] {
  id          uuid        [pk, default: `gen_random_uuid()`]
  email       citext      [not null, unique]
  full_name   varchar(120)
  created_at  timestamptz [not null, default: `now()`]
  deleted_at  timestamptz

  indexes {
    (email)                     [unique, name: 'users_email_key']
    (created_at desc)           [where: 'deleted_at is null', name: 'users_active_recent']
    `lower(full_name)`          [type: gin]
  }

  note: 'Soft-deleted via deleted_at'
}

table orders [color: #059669] {
  id          bigint        [pk, increment]
  user_id     uuid          [not null, ref: > users.id [delete: cascade]]
  status      order_status  [not null, default: 'pending']
  total_cents integer       [not null, check: 'total_cents >= 0']
  placed_at   timestamptz   [not null, default: `now()`]

  indexes {
    (user_id, placed_at desc)
    (status) [where: "status in ('pending','paid')"]
  }
}

table order_items {
  order_id    bigint  [not null]
  product_id  bigint  [not null]
  qty         integer [not null, default: 1]
  unit_cents  integer [not null]

  indexes {
    (order_id, product_id) [pk]
  }

  checks {
    'qty > 0'                    [name: 'order_items_qty_positive']
  }
}

ref: order_items.order_id   > orders.id     [delete: cascade]
ref: order_items.product_id > products.id   [delete: restrict]

group commerce [color: #059669] {
  orders
  order_items
  products
}

note architecture {
  '''
  Money is always stored as integer cents.
  Never use float for currency.
  '''
}
```

### 5.3 Printer rules (`dsl/printer.ts`) — determinism is mandatory

The printer output must be **byte-stable** for a given model, so git diffs are meaningful and the sync loop doesn't thrash.

- Statement order: `project`, then `enum`s (alphabetical), then `table`s (in canvas reading order: sort by `pos.y` bucketed to 100px rows, then `pos.x`), then standalone `ref`s (alphabetical by source table then column), then `group`s, then `note`s.
- Column type column is **left-aligned and padded** to the longest name in that table. Settings column likewise.
- Inline `ref:` shorthand is used **only** when the FK is single-column and the source column is not already used by another FK. Otherwise emit a standalone `ref:` statement.
- Two-space indent. No tabs. Trailing newline. LF only.
- A column whose type is `bigint`/`integer`/`smallint` with `identity: by_default` prints as `increment`, never as `identity: by default`.
- Settings order within `[...]` is fixed: `pk, increment, not null, unique, default, identity, generated, check, collate, ref, color, note`.

### 5.4 Parser diagnostics — required error codes

| Code | Condition |
|---|---|
| `PGL001` | Unexpected token |
| `PGL002` | Unterminated string |
| `PGL003` | Unknown setting key |
| `PGL004` | Unknown type name (not a builtin, not a declared enum) |
| `PGL005` | Type does not accept arguments / wrong arity |
| `PGL006` | Duplicate column name in table |
| `PGL007` | Duplicate table name in namespace |
| `PGL008` | Ref target table not found |
| `PGL009` | Ref target column not found |
| `PGL010` | Composite ref column count mismatch |
| `PGL011` | Multiple `pk` settings AND an `indexes {}` pk — ambiguous |
| `PGL012` | Enum value duplicated |
| `PGL013` | `group` references unknown table |
| `PGL014` | Reserved keyword used as unquoted identifier |
| `PGL015` | `increment` on a non-integer type |
| `PGL201` | Ref target columns are not unique/PK on the target table |

**The parser MUST be error-tolerant.** On encountering an error it records the diagnostic, skips to the next statement boundary (a `}` at depth 0, or a line starting with a top-level keyword), and continues. It always returns a `Schema` — a partial one if needed. **Never throw from the parser.** The canvas must keep rendering the last-good parts while the user is mid-typo.

---

## 6. CONTRACT — Postgres type catalog (`src/sql/types.ts`)

```ts
export interface TypeSpec {
  name: string;                   // canonical
  aliases: string[];              // e.g. int4 → integer
  category: 'numeric' | 'string' | 'datetime' | 'boolean' | 'json'
          | 'uuid' | 'binary' | 'network' | 'geometric' | 'range'
          | 'fulltext' | 'bit' | 'money' | 'xml' | 'other';
  /** how many precision/scale args it accepts */
  arity: 0 | 1 | 2 | '0|1' | '0|1|2';
  /** default args when omitted, for display */
  defaultArgs?: number[];
  /** shown as a small badge on the column row */
  short: string;
  /** faker generator key used by seed.ts */
  faker?: string;
}
```

Ship this exact list (aliases in parens are accepted on import and normalized away):

**numeric**: `smallint` (int2), `integer` (int, int4), `bigint` (int8), `decimal`/`numeric` (arity 0|1|2), `real` (float4), `double precision` (float8), `smallserial` (serial2), `serial` (serial4), `bigserial` (serial8), `money`

> **serial handling**: on import, `serial` → `integer` + `identity: by_default`. On export, always emit `GENERATED BY DEFAULT AS IDENTITY`, never `serial` (serial is legacy). Note this in the export dialog.

**string**: `char`/`character` (arity 0|1), `varchar`/`character varying` (arity 0|1), `text`, `citext`, `name`
**datetime**: `date`, `time` (0|1), `timetz`/`time with time zone`, `timestamp` (0|1), `timestamptz`/`timestamp with time zone` (0|1), `interval`
**boolean**: `boolean` (bool)
**json**: `json`, `jsonb`
**uuid**: `uuid`
**binary**: `bytea`
**network**: `inet`, `cidr`, `macaddr`, `macaddr8`
**geometric**: `point`, `line`, `lseg`, `box`, `path`, `polygon`, `circle`
**range**: `int4range`, `int8range`, `numrange`, `tsrange`, `tstzrange`, `daterange`, `int4multirange`, `int8multirange`, `nummultirange`, `tsmultirange`, `tstzmultirange`, `datemultirange`
**fulltext**: `tsvector`, `tsquery`
**bit**: `bit` (0|1), `bit varying`/`varbit` (0|1)
**xml**: `xml`
**other**: `oid`, `pg_lsn`, `txid_snapshot`, `void`

Plus: any `EnumType` declared in the schema is a valid type name.

**Unknown types on import**: do not fail. Create the `PgType` with the literal name, `arrayDims` from `[]` suffixes, and emit `Diagnostic` info `SQL_UNKNOWN_TYPE`. It round-trips verbatim. (This covers PostGIS `geometry`, `vector` from pgvector, etc.)

**Add these as first-class, they're common enough**: `vector` (arity 0|1, category 'other', for pgvector), `geometry` / `geography` (arity 0, PostGIS), `hstore`, `ltree`.

---

## 7. CONTRACT — Store (`src/store/index.ts`)

Single Zustand store, sliced. `zundo` wraps only the `schema` slice for undo/redo (viewport and selection are NOT undoable).

```ts
export interface AppState {
  // ── schema slice (undoable) ──
  schema: Schema;
  /** the DSL text — the user's authored source of truth when in text mode */
  dslText: string;
  /** which side last initiated a change; drives the sync loop (§8) */
  dirtySource: 'text' | 'model' | null;

  // ── derived, recomputed on schema change (memoized selectors, not state) ──
  //   diagnostics(), lintResults(), tableById(), relsForTable(), etc.

  // ── viewport slice (not undoable) ──
  viewport: { x: number; y: number; zoom: number };
  // ── selection slice (not undoable) ──
  selection: {
    tables: Set<TableId>;
    columns: Set<ColumnId>;
    rels: Set<RelId>;
    notes: Set<NoteId>;
  };
  // ── ui slice ──
  ui: {
    leftPanel: boolean;
    rightPanel: boolean;
    bottomPanel: { open: boolean; tab: 'diagnostics'|'lint'|'diff'|'generated' };
    editorPane: 'hidden' | 'split' | 'full';
    theme: 'light' | 'dark' | 'system';
    showGrid: boolean;
    snapToGrid: boolean;
    gridSize: number;             // default 16
    showMinimap: boolean;
    edgeStyle: 'orthogonal' | 'bezier' | 'straight';
    /** hide columns that are neither PK nor FK, for a high-level view */
    compactColumns: boolean;
    /** highlight the neighborhood of the selected table, dim everything else */
    focusMode: boolean;
    visibleNamespaces: Set<string>;
  };

  // ── actions — ALL schema mutations go through these ──
  actions: {
    // text side
    setDslText(text: string): void;

    // table
    addTable(partial?: Partial<Table>): TableId;
    updateTable(id: TableId, patch: Partial<Table>): void;
    deleteTables(ids: TableId[]): void;          // cascades: removes rels + indexes
    duplicateTable(id: TableId): TableId;
    moveTables(ids: TableId[], dx: number, dy: number): void;

    // column
    addColumn(table: TableId, partial?: Partial<Column>): ColumnId;
    updateColumn(table: TableId, id: ColumnId, patch: Partial<Column>): void;
    deleteColumn(table: TableId, id: ColumnId): void;
    reorderColumn(table: TableId, id: ColumnId, toIndex: number): void;
    togglePrimaryKey(table: TableId, id: ColumnId): void;

    // relationship
    addRelationship(r: Omit<Relationship, 'id'>): RelId;
    updateRelationship(id: RelId, patch: Partial<Relationship>): void;
    deleteRelationship(id: RelId): void;

    // index, enum, note, group — same CRUD shape
    // …

    // bulk
    applySchema(next: Schema, source: 'text' | 'import' | 'model'): void;
    importSql(sql: string): { diagnostics: Diagnostic[] };
    autoLayout(algo: 'layered' | 'force' | 'radial'): Promise<void>;

    // fixes
    applyFix(d: Diagnostic): void;
  };
}
```

**Rule: no component ever mutates `state.schema` directly.** Every path goes through `actions`, so zundo captures a clean history entry and the sync loop fires exactly once.

---

## 8. CONTRACT — The bidirectional sync loop (`src/store/sync.ts`)

This is the hardest part of the app. Get it wrong and you get infinite loops, cursor jumps, or lost edits. Implement it exactly like this.

### The rule

> **The model is canonical. The text is a projection. But while the user is typing, the text is canonical.**

### State machine

```
                 user types in CodeMirror
                          │
                          ▼
              setDslText(text)  →  dirtySource = 'text'
                          │
                    debounce 200ms
                          │
                          ▼
              parse(text) in a Worker → { schema', diagnostics }
                          │
        ┌─────────────────┴──────────────────┐
        │ diagnostics has errors?             │
        ▼                                     ▼
   YES: keep OLD schema on canvas,       NO: merge schema' into schema
        show diagnostics, mark canvas         (see "merge" below)
        as "stale" (subtle dimming)           dirtySource = null
                                              DO NOT re-print text
```

```
              user drags a table / edits inspector
                          │
                          ▼
              actions.updateTable(...)  →  dirtySource = 'model'
                          │
                          ▼
              print(schema) → newText
                          │
              if newText !== dslText:
                  apply as a CodeMirror transaction that
                  PRESERVES the cursor via position mapping
                  dirtySource = null
```

### The merge step (critical)

When text parses to `schema'`, do **not** wholesale replace `state.schema` — that would destroy `pos`, `color`, `collapsed`, and all visual state, since the DSL doesn't encode positions for every entity.

Merge by **identity reconciliation**:

1. Match tables between old and new by `(namespace, name)`.
   - Matched → keep old `id`, `pos`, `size`, `color`, `collapsed`, `groupId`. Take everything else from new.
   - New table with no match → assign fresh id; `pos` = auto-place (see below).
   - Old table with no match → delete.
2. Within a matched table, match columns by `name`. Keep old `ColumnId` on match (so relationships and selection survive a type change). New name → new id.
3. **Rename detection**: if exactly one table was "deleted" and exactly one was "added" in the same parse, and their column name sets overlap ≥60%, treat it as a rename: keep the old id and position. Same heuristic for columns within a table. This is what makes renaming feel non-destructive.
4. Relationships/indexes get fresh ids each parse (they're cheap), except waypoints/color are keyed by `(sourceTable, sourceColumns, targetTable)` and reattached.
5. Auto-place for new tables: put them in the first empty grid cell to the right of the rightmost existing table, in a column, so a new `table` block appears somewhere visible rather than at (0,0) under an existing one.

### Reprint guard

After a model-initiated change, printing produces text. That text change must NOT re-trigger the text→model path. Guard by comparing against the last printed text:

```ts
let lastPrinted = '';
function onModelChange(schema: Schema) {
  const text = print(schema);
  if (text === get().dslText) return;
  lastPrinted = text;
  set({ dslText: text, dirtySource: null });
}
function onTextChange(text: string) {
  if (text === lastPrinted) return;   // echo of our own print — ignore
  set({ dslText: text, dirtySource: 'text' });
  scheduleParse();
}
```

### Cursor preservation

When the printer rewrites text under the user (e.g. they dragged a table, which reorders statements), the CodeMirror cursor must not jump. Use `ChangeSet.of()` computed from a **line-level diff** (not a full-document replace) so CodeMirror's own position mapping handles the cursor. Implement a small Myers diff over lines in `lib/diff-lines.ts`.

### Worker

Parsing runs in `dsl/parse.worker.ts`. On a 300-table document the main thread must never block. Post `{ text }`, receive `{ schema, diagnostics }`. Cancel in-flight parses when new text arrives (track a monotonic request id, ignore stale responses).
---

## 9. CONTRACT — Migration diff engine (`src/sql/diff/`)

**This is the flagship feature.** No free tool does this well. It must be correct or it is worse than useless.

### 9.1 API

```ts
export interface DiffOp {
  /** stable kind, drives ordering and rendering */
  kind:
    | 'create_schema' | 'drop_schema'
    | 'create_enum' | 'drop_enum' | 'add_enum_value' | 'rename_enum_value'
    | 'create_table' | 'drop_table' | 'rename_table'
    | 'add_column' | 'drop_column' | 'rename_column'
    | 'alter_column_type' | 'alter_column_null' | 'alter_column_default'
    | 'alter_column_identity'
    | 'add_pk' | 'drop_pk'
    | 'add_fk' | 'drop_fk'
    | 'add_unique' | 'drop_unique'
    | 'add_check' | 'drop_check'
    | 'create_index' | 'drop_index'
    | 'set_comment';
  sql: string;                       // the statement to run
  /** safety classification — drives UI colour and warnings */
  risk: 'safe' | 'lock' | 'destructive' | 'lossy';
  /** human explanation of the risk, shown inline as a -- comment */
  warning?: string;
  /** ids this op depends on having run first */
  dependsOn: string[];
  id: string;
}

export interface DiffResult {
  ops: DiffOp[];                     // topologically ordered, ready to run
  /** ops the differ could not determine safely — needs human decision */
  ambiguities: {
    message: string;
    options: { label: string; ops: DiffOp[] }[];
  }[];
  /** true if any op is destructive or lossy */
  hasDataLoss: boolean;
}

export function diff(from: Schema, to: Schema, opts: DiffOptions): DiffResult;

export interface DiffOptions {
  /** if true, generate CONCURRENTLY for index creation and split into separate txn */
  concurrentIndexes: boolean;
  /** if true, wrap in BEGIN/COMMIT (cannot combine with concurrentIndexes) */
  transactional: boolean;
  /** how to detect renames: by id (reliable, same project) or by heuristic (imported SQL) */
  renameStrategy: 'by_id' | 'heuristic' | 'never';
  /** emit DROP statements at all */
  includeDrops: boolean;
}
```

### 9.2 Ordering rules — the topological plan (`plan.ts`)

Emit in this order. Within each phase, topologically sort by dependency.

```
 1. CREATE SCHEMA                        (new namespaces)
 2. CREATE TYPE ... AS ENUM              (new enums)
 3. ALTER TYPE ... ADD VALUE             (enum extensions — see 9.4)
 4. DROP CONSTRAINT (FKs)                (any FK touching a table we're about to alter)
 5. DROP INDEX                           (indexes being removed or rebuilt)
 6. CREATE TABLE                         (new tables, WITHOUT their FKs)
 7. ALTER TABLE ... RENAME               (renames before column ops)
 8. ALTER TABLE ... ADD COLUMN
 9. ALTER TABLE ... ALTER COLUMN TYPE
10. ALTER TABLE ... ALTER COLUMN SET/DROP NOT NULL
11. ALTER TABLE ... ALTER COLUMN SET/DROP DEFAULT
12. ALTER TABLE ... DROP COLUMN
13. ADD PRIMARY KEY / UNIQUE constraints
14. CREATE INDEX
15. ADD CONSTRAINT ... FOREIGN KEY       (all FKs, new + re-added from step 4)
16. ADD CONSTRAINT ... CHECK
17. COMMENT ON ...
18. DROP TABLE                           (last — other tables may still FK it until 4 ran)
19. DROP TYPE                            (after all tables using it are gone/altered)
```

**Why step 4/15**: you cannot `ALTER COLUMN TYPE` on a column that participates in an FK without dropping the FK first. The plan must detect this and automatically emit the drop+re-add pair. Track this: for each column type change, find all `Relationship`s where that column appears in `sourceColumns` or `targetColumns`, and add those FKs to the drop set in phase 4 and the re-add set in phase 15.

### 9.3 Risk classification

| Op | Risk | Warning text |
|---|---|---|
| `ADD COLUMN` nullable, no default | `safe` | — |
| `ADD COLUMN NOT NULL DEFAULT <const>` | `safe` | (PG11+ does not rewrite) |
| `ADD COLUMN NOT NULL DEFAULT <volatile>` | `lock` | "Rewrites the whole table. Use a nullable column + backfill + SET NOT NULL instead." |
| `ADD COLUMN NOT NULL` no default | `destructive` | "Fails if the table has any rows." |
| `DROP COLUMN` | `destructive` | "Permanent data loss." |
| `DROP TABLE` | `destructive` | "Permanent data loss." |
| `ALTER COLUMN TYPE` widening (int→bigint, varchar(n)→varchar(m>n), varchar→text) | `lock` | "Rewrites the table and holds ACCESS EXCLUSIVE." |
| `ALTER COLUMN TYPE` narrowing (bigint→int, text→varchar(n), numeric scale down) | `lossy` | "May fail or truncate on existing rows." |
| `ALTER COLUMN TYPE` between incompatible categories | `lossy` | "Requires an explicit USING clause. Generated USING is a guess — review it." |
| `SET NOT NULL` | `lock` | "Full table scan to validate. Consider adding a CHECK ... NOT VALID, validating, then SET NOT NULL." |
| `DROP NOT NULL` | `safe` | — |
| `CREATE INDEX` (non-concurrent) | `lock` | "Blocks writes. Use CONCURRENTLY in production." |
| `CREATE INDEX CONCURRENTLY` | `safe` | "Cannot run inside a transaction block." |
| `ADD FOREIGN KEY` | `lock` | "Scans both tables. Consider NOT VALID + VALIDATE CONSTRAINT." |
| `ADD CHECK` | `lock` | same as above |
| `DROP CONSTRAINT` | `safe` | — |
| `ALTER TYPE ... ADD VALUE` | `safe` | "Cannot be run inside a transaction block on PG < 12." |
| `RENAME` anything | `safe` | "Breaks any application code referencing the old name." |

Render every non-`safe` op with its warning as a `--` comment directly above the statement.

### 9.4 Enum changes

Postgres cannot remove or reorder enum values. If `to` removed a value or changed the order:

- Emit an **ambiguity** with two options:
  - **A: additive only** — only `ALTER TYPE ... ADD VALUE` the new ones, leave removed values in place. Zero risk.
  - **B: recreate the type** — the full dance:
    ```sql
    ALTER TYPE order_status RENAME TO order_status__old;
    CREATE TYPE order_status AS ENUM (...);
    ALTER TABLE orders ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE orders ALTER COLUMN status TYPE order_status
      USING status::text::order_status;
    ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'pending';
    DROP TYPE order_status__old;
    ```
    Mark `lossy` — rows holding a removed value will error.
  The differ must find every table+column using the enum to generate option B correctly.

### 9.5 Rename detection

- `renameStrategy: 'by_id'` — used when diffing two versions of the *same project* (e.g. current vs last saved). Entity ids are stable, so a table with the same id and a different name is unambiguously a rename. **This is the default and it's exact.**
- `renameStrategy: 'heuristic'` — used when diffing against an *imported* SQL file (no shared ids). Score candidate pairs:
  - column name set Jaccard similarity × 0.5
  - column type sequence similarity × 0.3
  - FK neighborhood similarity × 0.2
  If the best score > 0.7 and the runner-up is < 0.5, call it a rename. Otherwise emit drop+create and surface an **ambiguity** letting the user override to a rename.
- `'never'` — always drop+create.

### 9.6 The `USING` clause generator

For `ALTER COLUMN TYPE`, generate a `USING` expression:

| from → to | USING |
|---|---|
| any → `text` | `col::text` |
| `text`/`varchar` → numeric | `col::<type>` + `lossy` warning |
| `text` → `uuid` | `col::uuid` |
| `text` → `jsonb` | `col::jsonb` |
| `integer` → `bigint` | (none needed) |
| `bigint` → `integer` | `col::integer` + `lossy` |
| `timestamp` → `timestamptz` | `col AT TIME ZONE 'UTC'` + warning "assumes stored values are UTC" |
| `varchar(n)` → `varchar(m)`, m<n | `left(col, m)` + `lossy` |
| enum → `text` | `col::text` |
| `text` → enum | `col::<enum>` + `lossy` |
| anything else | `col::<type>` + `lossy` "verify this cast" |

### 9.7 Diff UI (`DiffDialog.tsx`)

Two source pickers: **From** and **To**. Each can be:
- Current schema
- A saved snapshot (auto-snapshot on every export + manual "Save snapshot" button; store in Dexie, keep last 50)
- A pasted/uploaded `.sql` file (runs through the DDL importer)
- A pasted/uploaded `.pgl` file

Output: a three-pane view.
- **Left**: op list, grouped by phase, colour-coded by risk, each toggleable (uncheck an op to exclude it — dependent ops auto-uncheck).
- **Centre**: the generated SQL, syntax highlighted, with `--` warnings.
- **Right**: a "what changed" summary tree (`+3 tables, ~2 columns, -1 index`), and the **ambiguities** panel with radio buttons.

Buttons: Copy SQL · Download `.sql` · Download as **two files** (`up.sql` / `down.sql` — generate the reverse diff for `down`).

---

## 10. Linter (`src/lint/`)

Every rule is a module exporting `{ code, name, severity, description, check(schema): Diagnostic[] }`. Rules are individually toggleable in Settings, persisted. Ship with sensible defaults on.

### Correctness (error by default)
| Code | Rule |
|---|---|
| `L001` | Table has no primary key |
| `L002` | FK references a column that is not PK and has no unique index |
| `L003` | FK column type does not match the referenced column type |
| `L004` | Composite FK column order does not match target's unique index order |
| `L005` | Circular FK dependency with all-NOT NULL columns (unin­sertable) |
| `L006` | Column is in a PK but is nullable (contradiction) |
| `L007` | Enum is declared but never used |
| `L008` | Duplicate index (same columns, same method, same predicate) |
| `L009` | Index is a prefix of another index (redundant) |

### Performance (warning)
| Code | Rule |
|---|---|
| `L101` | FK column has no index — every `DELETE` on the parent does a seq scan |
| `L102` | Index on a low-cardinality column alone (`boolean`, small enum) |
| `L103` | Table has > 8 indexes — write amplification |
| `L104` | `varchar(n)` used where `text` would do — Postgres has no perf benefit from `varchar(n)`, and it makes future widening a table rewrite |
| `L105` | `char(n)` used — almost always wrong in Postgres (blank-padded) |
| `L106` | `timestamp` without time zone — prefer `timestamptz` |
| `L107` | `money` type used — prefer `numeric` or integer cents |
| `L108` | `float`/`real`/`double precision` on a column whose name matches `/price|amount|cost|total|balance|fee/i` |
| `L109` | `serial` on export (we normalize, but flag if it survived import) |
| `L110` | `text` PK where a natural key would be huge — informational |
| `L111` | UUID v4 PK with a btree index on a very wide table — informational note about index locality; suggest UUIDv7 / ULID |
| `L112` | Multi-column index where the leftmost column has very low selectivity |

### Design / consistency (warning)
| Code | Rule |
|---|---|
| `L201` | Naming inconsistency: table names mix `snake_case`/`camelCase`/`PascalCase` |
| `L202` | Naming inconsistency: some tables plural, some singular (detect via a simple pluralization heuristic) |
| `L203` | FK column not named `<referenced_table_singular>_id` |
| `L204` | Table missing `created_at` / `updated_at` (configurable; off by default) |
| `L205` | Column name is a Postgres reserved word (requires quoting forever) |
| `L206` | Identifier > 63 chars — Postgres silently truncates. **This is a real footgun.** Error, not warning. |
| `L207` | Table/column has no comment (off by default; on = "document everything" mode) |
| `L208` | Boolean column not prefixed `is_`/`has_`/`can_` (off by default) |
| `L209` | Junction table has extra non-key columns (informational — might want a real entity) |
| `L210` | Nullable FK — informational, "is this relationship truly optional?" |
| `L211` | Two tables with an FK in both directions (bidirectional dependency) |

### Security (warning)
| Code | Rule |
|---|---|
| `L301` | Column name matches `/password|passwd|secret|token|api_key/i` and type is `text`/`varchar` — is it hashed? |
| `L302` | Column name matches PII patterns (`ssn`, `email`, `phone`, `dob`, `address`) — informational, tag for compliance |
| `L303` | Table with a `tenant_id`/`org_id`/`account_id` column but `rowLevelSecurity` is false — multi-tenant leak risk |

Each rule that can be auto-fixed ships a `fix`. Auto-fixable: `L001` (add `id bigint [pk, increment]`), `L101` (create the index), `L104`, `L106`, `L008`/`L009` (drop the redundant index), `L205`/`L206` (rename with a suggestion).

**Lint panel UI**: grouped by severity then category, click to select+zoom the offending entity on canvas, "Fix" button where available, "Fix all of this type" bulk action.

---

## 11. Generators (`src/generators/`)

All take `(schema: Schema, opts) => string`. All must produce **compiling** output for the sample schemas. Add a golden-file test per generator against `samples/ecommerce.pgl`.

| Target | Notes |
|---|---|
| **Postgres DDL** | Options: `IF NOT EXISTS`, `DROP` prelude, one file vs. one per table, include comments, include indexes. This is the primary export. |
| **Prisma** | Map types per the pg↔Prisma table. Emit `@relation` with explicit `fields`/`references`, `@@index`, `@@unique`, `@@map` when names aren't camelCase. Emit `enum` blocks. Handle composite PKs via `@@id`. |
| **Drizzle** | `pgTable`, `pgEnum`, `relations()` blocks, `index()`/`uniqueIndex()`, `.references(() => x.y, { onDelete: 'cascade' })`. Handle the import graph (circular refs need the `relations` helper). |
| **SQLAlchemy 2.0** | `Mapped[...]`/`mapped_column()` style, not legacy. `relationship()` with `back_populates` on both sides. `__table_args__` for indexes/checks. |
| **TypeORM** | Decorators. `@Entity`, `@Column`, `@ManyToOne`/`@OneToMany` pairs, `@Index`. |
| **Zod** | One schema per table, `z.object({...})`. Enums → `z.enum([...])`. Nullable → `.nullable()`. Also emit an `Insert` variant that omits identity/generated/defaulted columns. |
| **TypeScript** | Plain `interface` + a `type` union per enum. Plus a `Database` interface keyed by table name (Kysely-compatible). |
| **Mermaid** | `erDiagram`. Correct crow's-foot syntax (`\|\|--o{`). Include column types and PK/FK markers. This is what goes in the README. |
| **PlantUML** | `@startuml` + `!define` ER macros. |
| **DBML** | For interop with dbdiagram.io — near-1:1 with our DSL, so this is a small transform. |
| **Markdown data dictionary** | Per table: description, a column table (name/type/null/default/description), the relationships in and out, the indexes. Plus a TOC and an overview ER (embedded Mermaid). This is genuinely useful and nobody free does it. |
| **JSON Schema** | Draft 2020-12, one definition per table, `$ref` for FKs. |
| **Seed data** | See below. |

### 11.1 Seed generator (`seed.ts`)

Generate `INSERT` statements with realistic data.

- Rows per table: configurable (default 10), overridable per table in the UI.
- **FK-aware**: topologically sort tables; for a FK column, pick a random already-generated PK value from the parent. If the FK is nullable, leave ~15% NULL.
- **Cycle handling**: if the FK graph has a cycle, break it by nulling one nullable edge; if no nullable edge exists, emit the inserts with FK checks deferred (`SET CONSTRAINTS ALL DEFERRED`) and warn.
- **Faker mapping by column name first, type second**:
  - `/email/i` → `faker.internet.email()`
  - `/first_?name/i` → `faker.person.firstName()`, `/last_?name/i`, `/full_?name|^name$/i`
  - `/phone/i`, `/url|website/i`, `/address|street/i`, `/city/i`, `/country/i`, `/zip|postal/i`
  - `/price|amount|cost|total|cents/i` + integer → `faker.number.int({min:100,max:99999})`
  - `/description|bio|content|body/i` → `faker.lorem.paragraph()`
  - `/title|subject/i` → `faker.lorem.sentence()`
  - `/slug/i` → slugified lorem
  - `/created_at/i` → past date; `/updated_at/i` → after created_at; `/deleted_at/i` → 90% null
  - `/is_|has_|can_/i` + boolean → weighted 70% true
  - falls back to type: uuid→`faker.string.uuid()`, enum→random member, jsonb→a small object, etc.
- Respect `CHECK` constraints where they're simple comparisons (`col > 0`, `col in (...)`) — parse trivially and constrain the generator. If unparseable, ignore.
- Respect `UNIQUE` — retry generation, and for the pathological case (unique boolean), warn.
- Output: `INSERT INTO t (cols) VALUES (...), (...), ...;` batched, wrapped in a transaction, tables in topo order.
- Also offer **CSV export per table** (for `\copy`).

---

## 12. Canvas (`src/canvas/`)

### 12.1 Rendering

Single `<svg>`. Structure:

```
<svg>
  <defs>  ← crow's foot markers, arrowheads, drop shadows, grid pattern
  <rect class="grid" />                      ← pattern-filled, only if showGrid
  <g transform="translate(x,y) scale(zoom)">
    <g class="groups">      ← TableGroup backgrounds (behind everything)
    <g class="edges">       ← Relationship paths
    <g class="tables">      ← TableNode
    <g class="enums">
    <g class="notes">
    <g class="overlay">     ← selection box, drag-create ghost edge, snap guides
  </g>
</svg>
```

**Virtualization**: compute the visible world-rect from viewport + container size. Only render tables whose bbox intersects it (plus a 200px margin). Edges render if either endpoint table is visible OR the edge's bbox intersects. Below `zoom < 0.4`, switch tables to **LOD mode**: render just a coloured rectangle with the table name, no columns. This is what makes 300 tables smooth.

### 12.2 Table node anatomy

```
┌──────────────────────────────┐  ← 4px top border in table.color
│ 🔒 orders            [⋯]     │  ← header: lock icon if RLS, name, menu
├──────────────────────────────┤
│ 🔑 id          bigint        │  ← PK: key icon, name, type (dimmed, right-aligned)
│ 🔗 user_id     uuid      ●   │  ← FK: link icon; ● = FK anchor port (right or left)
│    status      order_status  │  ← enum types render in the enum's colour
│    total_cents integer   ✓   │  ← ✓ = has a CHECK
│    placed_at   timestamptz   │
├──────────────────────────────┤
│ ⚡ 2 indexes                  │  ← collapsible footer, click to expand index list
└──────────────────────────────┘
```

- Row height 24px, header 32px, footer 20px. Width auto-fits content, min 200px, max 400px (ellipsize).
- **Column-level anchoring**: each column row has a left port and a right port at `(x, y + rowIndex*24 + 12)`. Edges attach to the *column*, not the table. Choose the port (left vs right) that minimizes edge length — recompute when either table moves.
- Hovering a column highlights it and all edges touching it, and highlights the corresponding column on the other side.
- `compactColumns` mode: render only PK + FK columns, plus a `… 7 more` row.
- Collapsed: header only.
- Selected: 2px accent outline. Multi-select via shift-click or marquee drag on empty canvas.

### 12.3 Edge rendering & crow's foot

Notation: **IE (crow's foot)**, matching what every DBA expects.

| End | Meaning | Marker |
|---|---|---|
| `\|\|` | exactly one | two perpendicular ticks |
| `\|o` | zero or one | tick + circle |
| `}\|` | one or more | crow's foot + tick |
| `}o` | zero or more | crow's foot + circle |

Derivation from the model:
- **Target side (the referenced table)**: always "one". It's `||` if every FK source column is NOT NULL, `|o` if any is nullable (the child may not have a parent).
- **Source side (the FK holder)**: it's `}o` (zero-or-more) by default. It's `|o` (zero-or-one) if the FK columns carry a UNIQUE constraint — that's a 1:1.

Draw both markers. Draw the FK constraint name on hover. Draw `ON DELETE CASCADE` as a small badge on the edge near the source, since it's the thing that surprises people.

**Routing** (`layout/routing.ts`): orthogonal by default.
- A* on a coarse grid (16px) over the world, with table bboxes (+8px padding) as obstacles.
- Cost: 1 per step, +10 per turn, +5 for running adjacent to a table edge. This yields few bends and avoids hugging boxes.
- Cache routes; invalidate only for edges whose endpoint tables moved.
- If A* exceeds a node budget (e.g. 4000), fall back to a simple 3-segment orthogonal route.
- User-placed `waypoints` pin the route through those points (A* between consecutive waypoints).
- Bezier and straight modes are simple alternatives, no obstacle avoidance.

**Self-referencing FK** (e.g. `employees.manager_id → employees.id`): draw a loop out the right side, around, and back to the left port. Never route through the table.

**Many-to-many detection**: if a table has exactly 2 FKs, its PK is exactly the union of those FK columns, and it has ≤2 other columns, render a subtle `N:M` badge and offer a canvas toggle "**Show as M:N**" which hides the junction table and draws a single dashed edge between the two parents labelled with the junction's name. Toggle is per-table, stored in the model as a UI flag. This is a genuinely nice feature nobody free has.

### 12.4 Interactions

| Action | Behaviour |
|---|---|
| Scroll | pan vertically; shift+scroll pans horizontally |
| Ctrl/Cmd + scroll | zoom to cursor |
| Pinch | zoom |
| Space + drag, or middle-drag | pan |
| Drag table | move; snaps to grid if enabled; shows alignment guides against other tables |
| Drag from a column's port | draws a ghost edge; drop on another column → creates the FK. Type-checks and warns if types mismatch, offers to change the source column's type to match. **This is the killer visual feature.** |
| Double-click table header | rename inline |
| Double-click column | edit inline (name, then tab → type with autocomplete) |
| Double-click empty canvas | create a new table there |
| Right-click | context menu (table: duplicate, delete, add column, set colour, group, collapse, jump to definition in text) |
| Delete key | delete selection (with confirm if >1 table) |
| `F` | zoom-to-fit |
| `1` | zoom 100% |
| Click table then `Shift+F` | **focus mode**: dim everything except this table and its direct neighbours |
| Alt+drag table | duplicate |

### 12.5 Auto-layout (`layout/auto-layout.ts`)

elkjs in a worker. Three algorithms exposed:
- **Layered** (`elk.layered`, direction RIGHT) — the default. Best for hierarchical schemas. Set `elk.spacing.nodeNode: 60`, `elk.layered.spacing.nodeNodeBetweenLayers: 100`.
- **Force** (`elk.force`) — for highly interconnected schemas.
- **Radial** (`elk.radial`) — puts the most-connected table at the centre.

Also: **Selection-only layout** (lay out just the selected tables, leave the rest). And **Group-aware layout** — if tables are in `TableGroup`s, use ELK's hierarchical layout with groups as compound nodes so groups stay visually contiguous.

Animate positions to their new values over 300ms (ease-out), don't teleport.

### 12.6 Minimap

Bottom-right, 200×150, shows all tables as coloured rects + the viewport rect. Click/drag to navigate. Toggleable.
---

## 13. SQL import (`src/sql/import/`)

Must ingest **real `pg_dump --schema-only` output**, not a toy subset. This is the feature that determines whether the tool is usable on day one.

### 13.1 Preprocessing (`pgdump-preprocess.ts`)

`pg_dump` output is full of noise. Strip, in order:
- `SET ...;` statements
- `SELECT pg_catalog.set_config(...)` lines
- `--` comment lines (but capture `COMMENT ON` statements — those are real)
- `\connect`, `\.`, and `COPY ... FROM stdin;` blocks (including their data until the terminating `\.`)
- `ALTER ... OWNER TO ...;`
- `GRANT` / `REVOKE`
- `CREATE EXTENSION` — **capture** these (we need to know `citext`/`pgcrypto`/`postgis`/`vector` is available; store in schema meta and re-emit on export)
- `CREATE FUNCTION` / `CREATE TRIGGER` / `CREATE VIEW` / `CREATE MATERIALIZED VIEW` / `CREATE SEQUENCE` — **capture verbatim into a `raw` bucket in schema meta**, do not parse, but **re-emit them on DDL export** so a round-trip doesn't destroy the user's functions. Show a count in the UI: "12 objects preserved but not modelled (views, functions, triggers)."

### 13.2 Statements to actually parse

- `CREATE SCHEMA`
- `CREATE TYPE x AS ENUM (...)`
- `CREATE TABLE [IF NOT EXISTS] [schema.]t ( ... ) [PARTITION BY ...] [INHERITS ...]`
  - column defs with all inline constraints
  - `PRIMARY KEY (...)`, `UNIQUE (...)`, `CHECK (...)`, `FOREIGN KEY (...) REFERENCES ...`, `EXCLUDE ...` (capture raw)
  - `GENERATED { ALWAYS | BY DEFAULT } AS IDENTITY [ ( sequence_options ) ]`
  - `GENERATED ALWAYS AS ( expr ) STORED`
  - `DEFAULT expr` — capture the raw expression, including function calls and casts
  - `COLLATE`
  - array suffixes, `[]`, `[3]`, `[][]`
- `ALTER TABLE ONLY t ADD CONSTRAINT c PRIMARY KEY (...)` — pg_dump emits PKs this way, **not** inline. Must handle.
- `ALTER TABLE ONLY t ADD CONSTRAINT c FOREIGN KEY (...) REFERENCES t2(...) [ON DELETE ...] [ON UPDATE ...] [DEFERRABLE] [INITIALLY DEFERRED]`
- `ALTER TABLE ONLY t ADD CONSTRAINT c UNIQUE (...)` / `CHECK (...)`
- `ALTER TABLE t ALTER COLUMN c SET DEFAULT ...` — pg_dump uses this for `nextval()` sequence defaults
- `ALTER TABLE t ENABLE ROW LEVEL SECURITY`
- `CREATE [UNIQUE] INDEX [CONCURRENTLY] name ON t [USING method] ( keys ) [INCLUDE (...)] [WHERE pred]`
- `COMMENT ON { TABLE | COLUMN | TYPE } x IS 'text'`
- `CREATE SEQUENCE` + `ALTER SEQUENCE ... OWNED BY t.c` + `DEFAULT nextval('seq')` → **normalize this trio into `identity: by_default`**. This is how old schemas express serial. Detect it and collapse it, otherwise every imported legacy schema looks wrong.

### 13.3 Tokenizer requirements

- Dollar-quoted strings (`$$ ... $$`, `$tag$ ... $tag$`) — must not be broken by embedded quotes/semicolons.
- Nested parens (a `CHECK (a > (b + c))` must not terminate early).
- `E'...'` escape strings, `'...''...'` doubled-quote escapes.
- Double-quoted identifiers preserving case.
- Statement splitting on `;` **only at paren depth 0 and outside any string**.

### 13.4 Import UX

- Paste into a textarea, or drop a `.sql` file, or pick a sample.
- Show a preview: "Found 42 tables, 61 FKs, 88 indexes, 4 enums. 3 objects preserved unparsed."
- Show diagnostics for anything not understood — **never silently drop**.
- Options: merge into current schema, or replace.
- After import, run auto-layout automatically (imported schemas have no positions).

---

## 14. Persistence (`src/persist/`)

### 14.1 IndexedDB (Dexie)

```ts
db.version(1).stores({
  projects:  '++id, name, updatedAt',
  snapshots: '++id, projectId, createdAt',   // for diffing against past versions
  settings:  'key',
});
```

- Autosave the current project on every schema mutation, debounced 800ms.
- Keep the last **50 snapshots** per project. Snapshot automatically on: import, SQL export, auto-layout, and any change touching >5 tables. Plus a manual button. Show them in a "History" list with timestamps and a "Diff against this" action.
- **Crash recovery**: on load, if there's an autosaved project, restore it. Show a subtle "Restored from your last session" toast.

### 14.2 File System Access API (`fs-access.ts`)

This is the feature that makes it git-friendly:
- **Open file** → `showOpenFilePicker` → get a `FileSystemFileHandle` for `schema.pgl`.
- Keep the handle in IndexedDB (handles are serializable to IDB — this is the trick that makes it persist across reloads).
- **Save** writes straight back to the same file on disk. Ctrl+S. No download-and-move dance.
- Watch for external changes: poll `getFile().lastModified` every 2s while the tab is focused; if it changed and we have no unsaved edits, hot-reload it. If we do have unsaved edits, show a conflict banner.
- **Fallback** for Firefox/Safari (no FS Access API): download on save, upload on open. Detect and switch transparently. Show a one-line note in Settings explaining why Chrome/Edge gives a better experience.

### 14.3 Project file format (`.pglass`)

A zip (use `fflate`, it's tiny):
```
schema.pgl          ← the DSL, the source of truth, human-readable
layout.json         ← positions, colours, groups, collapsed state, waypoints
meta.json           ← name, description, extensions, raw preserved SQL objects
snapshots/*.pgl     ← optional
```
So the `.pgl` inside is diffable, and if the tool ever dies, the user still has a readable file. **Never invent an opaque binary format.**

Also support plain `.pgl` (no positions — auto-layout on open) and plain `.sql` as first-class open/save targets.

---

## 15. UI shell

```
┌────────────────────────────────────────────────────────────────────┐
│ Pglass   ecommerce.pgl •      [Import] [Export] [Diff] [Layout ▾]  │ ← TopBar
├──────────┬────────────────────────────────┬────────────────────────┤
│ Outline  │                                │ Inspector              │
│          │                                │                        │
│ ▾ public │          C A N V A S           │  Table: orders         │
│   users  │                                │  ┌──────────────────┐  │
│   orders │                                │  │ Name  [orders  ] │  │
│   items  │                                │  │ Schema[public ▾] │  │
│ ▾ enums  │                                │  │ Color [#059669]  │  │
│   status │                                │  │ RLS   [ ]        │  │
│ ▾ groups │                                │  │ Note  [........] │  │
│   commerce                                │  ├──────────────────┤  │
│          ├────────────────────────────────┤  │ Columns          │  │
│          │  E D I T O R  (CodeMirror)     │  │ ⠿ id      bigint │  │
│          │  table orders {                │  │ ⠿ user_id uuid   │  │
│          │    id bigint [pk, increment]   │  │ [+ Add column]   │  │
│          │  }                             │  ├──────────────────┤  │
├──────────┴────────────────────────────────┤  │ Indexes  [+]     │  │
│ Diagnostics(0) | Lint(7) | Diff | Output  │  │ Checks   [+]     │  │
│  ⚠ L101 orders.user_id: FK has no index   │  └──────────────────┘  │
│     [Fix]                                 │                        │
└───────────────────────────────────────────┴────────────────────────┘
```

- Editor pane is **resizable and collapsible** (Cmd+\ toggles hidden/split/full).
- Clicking a table on canvas scrolls the editor to its definition, and vice versa. **Bidirectional cursor sync** — this makes the two views feel like one thing.
- Bottom panel collapses to a status strip showing counts.

### 15.1 Command palette (Cmd+K)

Fuzzy search over: every table, every column, every enum (jump to it), plus every command (`Add table`, `Auto-layout`, `Export Prisma`, `Toggle dark mode`, `Diff against last snapshot`, …). This is the primary navigation for a 300-table schema.

### 15.2 Keyboard shortcuts (all must work)

```
Cmd+K   command palette        Cmd+S   save
Cmd+Z   undo                   Cmd+Shift+Z  redo
Cmd+\   toggle editor pane     Cmd+B   toggle left panel
Cmd+/   toggle bottom panel    Cmd+E   export dialog
Cmd+D   duplicate selection    Cmd+A   select all
Cmd+F   find (in editor)       Cmd+G   auto-layout
F       zoom to fit            1       zoom 100%
T       new table              Delete  delete selection
Esc     clear selection        Shift+F focus mode on selection
```

### 15.3 Theming

Light + dark, driven by CSS custom properties. Canvas colours come from the same variables so SVG export honours the theme. Ship a "presentation" theme (high contrast, larger fonts) for screenshots.

### 15.4 Empty state

Not a blank canvas. Show: **Start from scratch** · **Import SQL** · **Paste a pg_dump** · **Open a sample** (ecommerce / SaaS multi-tenant / Northwind). The samples must be genuinely good — a new user's first 30 seconds decide everything.

---

## 16. Image export

- **SVG**: serialize the `<svg>` with computed styles inlined (walk the DOM, copy resolved styles onto elements), fonts embedded as base64 `@font-face` in a `<style>`, viewBox tight to the content bbox + 32px padding. Must open correctly in Figma and Inkscape.
- **PNG**: render that SVG into an `<canvas>` at 1×/2×/4×, `toBlob`. Options: transparent background, include/exclude grid.
- Both respect: current selection only (export just the selected tables + their edges), or whole diagram.
- **PDF: DEFER.** Not worth the bundle size. The SVG imports into anything.

---

## 17. Testing (non-negotiable — this is what makes "one shot" actually work)

| Layer | Requirement |
|---|---|
| **DSL round-trip** | Property test: for a set of ~30 hand-written `.pgl` fixtures, `print(parse(text).schema)` must equal `text` **exactly** (they're written in canonical form). And `parse(print(parse(text).schema))` deep-equals `parse(text).schema`. |
| **SQL round-trip** | For each SQL fixture: `exportDDL(importSQL(sql))` re-imported must deep-equal the first import's schema. (Not textually equal to the original — that's impossible — but semantically stable.) |
| **Real pg_dump** | `samples/northwind.sql` must import with **zero** error diagnostics. Ship 2 more real dumps as fixtures (write them by hand if needed — a partitioned table, a schema with composite FKs, enums, partial indexes, generated columns). |
| **Diff correctness** | Golden tests: `diff(A, B)` for ~25 curated pairs, each asserting the exact op list and ordering. **Include the nasty ones**: FK-blocked type change, enum value removal, table rename with FK renames, circular FK creation, PK change. |
| **Diff self-consistency** | For any pair (A,B): applying `diff(A,B)` ops to A's DDL and re-importing must yield B. Simulate by textual application where feasible; at minimum assert `diff(A, B)` then `diff(B, A)` are inverses in op-kind. |
| **Lint** | One test per rule: a schema that triggers it, a schema that doesn't. Auto-fix tests: apply the fix, assert the rule no longer fires and no new errors appear. |
| **Generators** | Golden file per generator against `ecommerce.pgl`. Committed to the repo. Regenerating them is the review artifact. |
| **Sync loop** | The one that matters: simulate `type → parse → merge → print`, assert positions are preserved, ids are stable through a rename, and the printer output doesn't oscillate (print twice, get the same thing). |
| **Perf** | Generate a 300-table synthetic schema. Assert: parse < 1.5s, auto-layout < 3s, initial render < 500ms. Fail the test if exceeded. |

Aim for real coverage on `model/`, `dsl/`, `sql/`, `lint/` — those are pure functions, they're cheap to test, and they're where every bug will be. UI tests: just smoke tests.

---

## 18. Build order — implement in exactly this sequence

Each phase must **run and be verifiable** before moving on. Do not build ahead.

> **Phase 0 — Skeleton**
> Vite + React + TS + Tailwind + Biome. Empty app shell with the three panels. GH Actions deploy workflow. **Verify: it deploys to Pages and renders.**

> **Phase 1 — Model + DSL** ← *the foundation; get this right or everything after is wrong*
> `model/types.ts` verbatim from §4. `model/validate.ts`. Lexer, parser, printer. **Verify: all round-trip tests in §17 pass.** This phase has no UI. Do not skip the tests here.

> **Phase 2 — Editor**
> CodeMirror with `pgl` syntax highlighting, autocomplete (table names, column names, types, settings keys), lint gutter wired to parser diagnostics. **Verify: type a schema, see errors underlined, see completions.**

> **Phase 3 — Canvas (read-only)**
> Render tables + edges from a `Schema`. Pan/zoom. Orthogonal routing. Crow's-foot markers. Virtualization + LOD. **Verify: load the ecommerce sample, it looks right and pans at 60fps.**

> **Phase 4 — The sync loop** ← *the second hard part*
> Wire text↔model per §8, including the merge/identity reconciliation and the reprint guard. **Verify: rename a table in text → the box keeps its position and colour. Drag a box → the text doesn't reorder chaotically and your cursor doesn't jump.**

> **Phase 5 — Canvas editing**
> Drag tables, inline rename, drag-to-create-FK, inspector panel, context menus, selection, delete. **Verify: build a 5-table schema entirely with the mouse.**

> **Phase 6 — SQL import**
> Preprocessor, tokenizer, DDL parser. **Verify: `northwind.sql` imports clean.**

> **Phase 7 — SQL export**
> DDL writer + formatter. **Verify: `exportDDL(import(northwind))` is valid SQL (eyeball it; ideally paste into a real psql).**

> **Phase 8 — Auto-layout**
> elkjs in a worker. **Verify: imported Northwind gets a readable layout in <3s.**

> **Phase 9 — Persistence**
> Dexie autosave, snapshots, File System Access, `.pglass` zip. **Verify: reload the tab and everything's there. Ctrl+S writes to disk.**

> **Phase 10 — Diff engine** ← *the flagship*
> Differ, plan, render, DiffDialog. **Verify: all 25 golden diff tests pass. Manually: change a column type on an FK'd column and confirm it emits drop-FK → alter → re-add-FK.**

> **Phase 11 — Linter**
> Engine + all rules + fixes + panel. **Verify: every rule has a passing test.**

> **Phase 12 — Generators**
> All of §11. **Verify: golden files. Prisma output must actually pass `prisma validate` — check it.**

> **Phase 13 — Export images, command palette, shortcuts, themes, samples, service worker, README.**

> **Phase 14 — Polish**
> Empty states, toasts, loading states, focus mode, minimap, groups, sticky notes, M:N collapse.

---

## 19. Acceptance criteria — the app is done when all of these are true

1. I paste 4,000 lines of `pg_dump --schema-only` output from a real production database. It imports with zero errors, auto-lays-out, and the diagram is readable within 5 seconds.
2. I rename a table in the text pane. Its box on the canvas keeps its exact position, colour, and group. All its edges stay connected.
3. I drag from `orders.user_id` to `users.id`. An FK is created, the crow's-foot renders correctly (`}o──||`), and the text pane gains `ref: > users.id [delete: no action]` on that column.
4. I change `orders.total_cents` from `integer` to `bigint` and open Diff against the last snapshot. It emits: drop the FKs touching it (none here), `ALTER TABLE orders ALTER COLUMN total_cents TYPE bigint;`, flagged `lock` with the table-rewrite warning.
5. I remove a value from an enum and diff. It gives me the two-option ambiguity, and option B is the full correct rename-recreate-cast-drop dance, touching every column that uses the enum.
6. The linter tells me my FK has no index, and one click adds it — to the model, the text, and the canvas, all three, in one undoable step.
7. I export Prisma. It passes `prisma validate` without edits.
8. I hit Cmd+S and `schema.pgl` on my disk updates. `git diff` shows a clean, minimal, human-readable change.
9. I pull my network cable and reload. Everything still works.
10. Undo works for the last 100 operations, across both text and canvas edits, without corrupting positions.
11. I export SVG and drop it into Figma. Text is text, not paths. Colours are right.
12. The whole bundle is under 1.5MB gzipped and the app is interactive in under 1.5s on a cold load.

---

## 20. Explicitly OUT of scope — do not build these

- Live database connection / introspection (impossible without a backend)
- Realtime collaboration, presence, comments, sharing links
- Auth, accounts, cloud sync
- Any dialect other than PostgreSQL
- Views / functions / triggers / procedures as *modelled* entities (they're preserved verbatim on round-trip; that's all)
- Query builder, query runner, EXPLAIN visualizer
- PDF export
- Mobile-optimized touch UI (it should not *break* on tablet, but don't design for it)
- AI features of any kind
- Telemetry

---

## 21. README requirements

The README is the marketing. It must contain: an animated GIF of drag-to-create-FK, a Mermaid ER diagram generated by the tool itself (dogfooding), the feature list, a "why not dbdiagram/drawSQL" honesty section, keyboard shortcuts, the `.pgl` grammar reference, and a one-command local setup.

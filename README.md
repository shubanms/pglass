# Pglass

A 100% client-side, static-hosted **PostgreSQL schema design studio**. No backend,
no auth, no runtime network calls. A text DSL (`.pgl`) and a visual ER canvas are
two views of one in-memory model — edit either, the other updates.

See [`PGLASS_PRD.md`](./PGLASS_PRD.md) for the full product specification.

## Status

Under active construction, built in the phases described in the PRD (§18):

- [x] **Phase 0** — Skeleton: Vite + React 19 + TS strict + Tailwind 4 + Biome, app
      shell, GitHub Pages deploy workflow.
- [x] **Phase 1** — Model + DSL: the data model (`src/model`), Postgres type catalog,
      structural validator, and a hand-rolled `.pgl` lexer / error-tolerant parser /
      deterministic printer with byte-exact round-trip tests (`src/dsl`).
- [x] **Store + sync loop** (§7, §8) — Zustand + zundo store with the bidirectional
      text↔model reconciliation (identity merge preserves positions across edits).
- [x] **Phase 2** — Editor: CodeMirror 6 with `.pgl` highlighting, context-aware
      autocomplete, and a lint gutter wired to parser diagnostics.
- [x] **Phase 3** — Read-only canvas: custom SVG renderer with pan/zoom, virtualization,
      level-of-detail, orthogonal edge routing, and crow's-foot cardinality markers.
- [x] **Phase 7** — SQL export: Postgres DDL writer (CREATE TYPE/TABLE/INDEX, ALTER ADD
      FK, COMMENT ON), serial→IDENTITY normalization, options dialog with copy/download.
- [x] **Phase 6** — SQL import: a `pg_dump --schema-only` importer — preprocessor,
      dollar-quote-aware tokenizer, and a DDL parser handling ALTER-style constraints,
      the sequence→identity trio, enums, indexes, and comments. Import dialog.
- [x] **Phase 10** — Diff engine (the flagship): `diff(from, to)` → a topologically
      ordered, risk-classified migration plan. Handles the hard cases — FK-blocked type
      changes (auto drop/re-add), enum value removal (additive vs recreate ambiguity),
      renames (by-id / heuristic), and a `USING`-clause generator. Diff dialog with
      From/To pickers, toggleable ops, and copy/download.
- [x] **Phase 12** — Generators: one pure `(schema) => string` per target —
      Postgres DDL, Prisma, Drizzle, SQLAlchemy 2.0, TypeORM, Zod, TypeScript,
      Mermaid, PlantUML, DBML, Markdown data dictionary, JSON Schema, and FK-aware
      faker seed data (dynamically imported to keep the main bundle lean). Unified
      Generate/export dialog. Golden-file tests per generator.
- [x] **Phase 11** — Linter: a rule engine with correctness (L001–L009), performance
      (L101–L108), design (L201–L211), and security (L301–L303) rules — each toggleable
      with sensible defaults — plus one-click auto-fixes (add PK, index the FK,
      varchar→text, timestamp→timestamptz, drop redundant index, enable RLS…). Tabbed
      Lint panel with Fix buttons.
- [x] **Phase 8** — Auto-layout: elkjs (layered / force / radial), selection-only
      layout, and zoom-to-fit — code-split so elkjs loads on demand. Replaces the grid
      stopgap; wired to the Layout menu.
- [x] **Phase 9** — Persistence: Dexie IndexedDB autosave (debounced) + snapshots (50
      kept) + crash recovery ("restored from your last session"), File System Access
      Open/Save (Ctrl+S writes straight to disk, with a download/upload fallback), and a
      diffable `.pglass` project file (zip of `schema.pgl` + `layout.json` + `meta.json`).
- [x] **Phase 5** — Canvas editing: drag tables to move (multi-select + snap), drag a
      column's port to another column to create a foreign key, double-click empty canvas
      to add a table, double-click a header (or use the context menu) to rename,
      right-click for a table menu (add column, duplicate, collapse, recolor, delete),
      and Delete to remove the selection. An interactive Inspector edits table name,
      color, RLS, and per-column name/type/PK/NN inline. Subtle motion throughout —
      dialog/menu/toast pop-ins, edge hover highlight, button press feedback — all
      gated behind `prefers-reduced-motion`.
- [x] **Phase 4** — Non-blocking sync loop: DSL parsing runs in a code-split Web
      Worker (`dsl/parse.worker.ts`), debounced 200ms with a monotonic request id
      so stale parses are dropped and the main thread never blocks on a large
      document. Model-initiated reprints apply a minimal **line-level diff**
      (`lib/diff-lines.ts`) rather than a full-document replace, so the editor
      caret never jumps when the canvas rewrites the text under you.
- [x] **Phase 13** — Studio polish: a **⌘K command palette** (fuzzy jump to any table
      or run any command), the full **keyboard-shortcut** set, **image export** (theme-aware
      SVG with a tight viewBox + PNG at 1×/2×/4×, whole-diagram or selection, transparent /
      grid options), a high-contrast **presentation theme**, two more genuinely-good
      **samples** (SaaS multi-tenant, Northwind), and an offline **service worker** so the
      app keeps working with the network pulled.
- [x] **Phase 15** — UI/UX revamp: a calmer, Notion-style visual system (warm
      surfaces, softer borders, a radius/shadow scale, more breathing room, light + dark);
      every panel is now **drag-resizable and collapsible** with sizes remembered across
      reloads (`ui/Resizer.tsx`, layout persisted to `localStorage`); the canvas gains
      **marquee drag-select**, a live **minimap**, zoom −/%/+ controls, a **view-options**
      popover, and previously-hidden toggles wired up — compact columns, focus-mode
      spotlight, edge style, grid/snap. Dragging from a column's FK port no longer selects
      row text.
- [x] **Phase 14** — Canvas annotations: **table groups** (a tinted frame around
      members with rename / collapse / ungroup — `canvas/GroupLayer.tsx`), **sticky notes**
      (draggable, editable, recolourable markdown cards — `canvas/StickyNoteNode.tsx`), and
      **M:N junction collapse** — a link table (2 FKs, PK = the FK union, ≤2 extra columns;
      `model/junction.ts`) shows a subtle `N:M` badge and can collapse into a single dashed
      edge between its parents. Groups and notes round-trip through the `.pgl` DSL; the M:N
      flag is visual-only and survives merges.

**All phases from the PRD build order (§18) are now complete.**

### Beyond the PRD

- [x] **Views** — `view` / materialized `view` are first-class: they round-trip through
      the `.pgl` DSL (`view name [materialized] { ''' <query> ''' }`), import from and
      export to SQL (`CREATE [MATERIALIZED] VIEW`), render as a distinct dashed node on the
      canvas with best-effort dashed dependency edges to the tables they read, appear in the
      Markdown data dictionary, and get a Views section in the sidebar. Generated columns
      (`GENERATED ALWAYS AS (…) STORED`) are now editable from the column inspector.

### The `.pgl` DSL

`.pgl` is the terse authoring format that round-trips losslessly with the model.
See [`public/samples/ecommerce.pgl`](./public/samples/ecommerce.pgl) for a worked
example and the PRD §5 for the full grammar. The parser never throws — it always
returns a (possibly partial) schema plus diagnostics — and the printer is
byte-stable so git diffs stay clean.

### Keyboard shortcuts

```
⌘K   command palette        ⌘S   save
⌘Z   undo                   ⇧⌘Z  redo
⌘\   toggle editor pane     ⌘B   toggle table list
⌘/   toggle bottom panel    ⌘E   export code
⌘D   duplicate selection    ⌘A   select all tables
⌘F   find (in editor)       ⌘G   auto-layout
F    zoom to fit            1    zoom 100%
T    new table              Delete  delete selection
Esc  clear selection        ⇧F   focus on selection
```

Everything is also reachable from the ⌘K palette. The app ships a service
worker, so after one online visit it runs fully offline.

## Local setup

```bash
npm install
npm run dev      # start the dev server
npm run test     # run the test suite
npm run build    # type-check + production build
npm run lint     # Biome lint + format check
```

## Tech stack

TypeScript 5.6 (strict) · Vite 6 · React 19 · Zustand 5 + immer + zundo ·
custom SVG canvas · hand-rolled `.pgl` parser · Biome · Vitest.
PostgreSQL only, by design.

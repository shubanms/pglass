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
- [ ] Phases 4–14 — canvas editing (drag-to-FK), elkjs auto-layout, persistence,
      diff engine, linter, generators, and polish.

### The `.pgl` DSL

`.pgl` is the terse authoring format that round-trips losslessly with the model.
See [`public/samples/ecommerce.pgl`](./public/samples/ecommerce.pgl) for a worked
example and the PRD §5 for the full grammar. The parser never throws — it always
returns a (possibly partial) schema plus diagnostics — and the printer is
byte-stable so git diffs stay clean.

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

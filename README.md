# Pglass

A 100% client-side, static-hosted **PostgreSQL schema design studio**. No backend,
no auth, no runtime network calls. A text DSL (`.pgl`) and a visual ER canvas are
two views of one in-memory model — edit either, the other updates.

See [`PGLASS_PRD.md`](./PGLASS_PRD.md) for the full product specification.

## Status

Under active construction, built in the phases described in the PRD (§18):

- [x] **Phase 0** — Skeleton: Vite + React 19 + TS strict + Tailwind 4 + Biome, app
      shell, GitHub Pages deploy workflow.
- [ ] **Phase 1** — Model + DSL: the data model, `.pgl` lexer/parser/printer, round-trip tests.
- [ ] Phases 2–14 — editor, canvas, sync loop, SQL import/export, diff engine, linter,
      generators, and polish.

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

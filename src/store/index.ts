// The single Zustand store. See PRD §7. zundo (temporal) tracks only the schema
// slice for undo/redo; viewport and selection are intentionally not undoable.
//
// The bidirectional text↔model sync loop (§8) lives here: setDslText parses and
// merges into the live model; model mutations reprint canonical text behind a
// reprint guard so the two views never thrash.
import { enableMapSet, produce } from 'immer';
import { temporal } from 'zundo';
import { create } from 'zustand';
import { parse } from '../dsl/parser.ts';
import { print } from '../dsl/printer.ts';
import { gridLayout, needsLayout } from '../layout/grid.ts';
import { newColumnId, newTableId } from '../model/ids.ts';
import { emptySchema } from '../model/schema.ts';
import type {
  Column,
  ColumnId,
  Diagnostic,
  RelId,
  Relationship,
  Schema,
  Table,
  TableId,
} from '../model/types.ts';
import { importSql } from '../sql/import/ddl-parser.ts';
import { mergeSchema } from './merge.ts';

enableMapSet();

export type BottomTab = 'diagnostics' | 'lint' | 'diff' | 'generated';
export type EditorPane = 'hidden' | 'split' | 'full';
export type Theme = 'light' | 'dark' | 'system';
export type EdgeStyle = 'orthogonal' | 'bezier' | 'straight';

export interface UiState {
  leftPanel: boolean;
  rightPanel: boolean;
  bottomPanel: { open: boolean; tab: BottomTab };
  editorPane: EditorPane;
  theme: Theme;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  showMinimap: boolean;
  edgeStyle: EdgeStyle;
  compactColumns: boolean;
  focusMode: boolean;
}

export interface Selection {
  tables: Set<TableId>;
  columns: Set<ColumnId>;
  rels: Set<RelId>;
}

export interface AppState {
  schema: Schema;
  dslText: string;
  dirtySource: 'text' | 'model' | null;
  diagnostics: Diagnostic[];
  /** true when text has errors and the canvas is showing a stale model */
  stale: boolean;

  viewport: { x: number; y: number; zoom: number };
  selection: Selection;
  ui: UiState;

  actions: Actions;
}

export interface Actions {
  setDslText(text: string): void;
  loadSchema(schema: Schema): void;

  addTable(partial?: Partial<Table>): TableId;
  updateTable(id: TableId, patch: Partial<Table>): void;
  deleteTables(ids: TableId[]): void;
  moveTables(ids: TableId[], dx: number, dy: number): void;

  addColumn(table: TableId, partial?: Partial<Column>): ColumnId;
  updateColumn(table: TableId, id: ColumnId, patch: Partial<Column>): void;
  deleteColumn(table: TableId, id: ColumnId): void;

  addRelationship(r: Omit<Relationship, 'id'>): RelId;
  deleteRelationship(id: RelId): void;

  importSqlText(sql: string): Diagnostic[];

  selectTable(id: TableId, additive?: boolean): void;
  clearSelection(): void;

  setViewport(v: Partial<{ x: number; y: number; zoom: number }>): void;
  toggleUi<K extends keyof UiState>(key: K): void;
  setUi<K extends keyof UiState>(key: K, value: UiState[K]): void;

  undo(): void;
  redo(): void;
}

const NOW = () => new Date().toISOString();

// Reprint guard (§8): remember the last text we printed so its echo through the
// editor doesn't re-trigger the text→model path.
let lastPrinted = '';

function initialSchema(): Schema {
  return emptySchema('untitled', NOW());
}

export const useStore = create<AppState>()(
  temporal(
    (set, get) => {
      /** Reprint canonical text after a model-initiated change (§8). */
      const reprint = () => {
        const text = print(get().schema);
        if (text === get().dslText) return;
        lastPrinted = text;
        set({ dslText: text, dirtySource: null });
      };

      /** After undo/redo, the schema reference changed under us — resync text. */
      const reprintAfterTimeTravel = () => {
        const text = print(get().schema);
        lastPrinted = text;
        set({ dslText: text, dirtySource: null });
      };

      /** Apply a schema mutation via immer, refresh diagnostics, reprint text. */
      const mutate = (recipe: (s: Schema) => void) => {
        const nextSchema = produce(get().schema, (draft) => {
          recipe(draft as unknown as Schema);
          (draft as Schema).meta.updatedAt = NOW();
        });
        set({ schema: nextSchema, dirtySource: 'model' });
        reprint();
      };

      return {
        schema: initialSchema(),
        dslText: '',
        dirtySource: null,
        diagnostics: [],
        stale: false,

        viewport: { x: 0, y: 0, zoom: 1 },
        selection: { tables: new Set(), columns: new Set(), rels: new Set() },
        ui: {
          leftPanel: true,
          rightPanel: true,
          bottomPanel: { open: true, tab: 'diagnostics' },
          editorPane: 'split',
          theme: 'system',
          showGrid: true,
          snapToGrid: true,
          gridSize: 16,
          showMinimap: true,
          edgeStyle: 'orthogonal',
          compactColumns: false,
          focusMode: false,
        },

        actions: {
          setDslText(text) {
            if (text === lastPrinted) return; // echo of our own print — ignore
            const { schema, diagnostics } = parse(text, NOW());
            const errors = diagnostics.filter((d) => d.severity === 'error');
            if (errors.length) {
              // keep the old model on canvas, mark stale, surface diagnostics
              set({ dslText: text, dirtySource: 'text', diagnostics, stale: true });
              return;
            }
            const merged = mergeSchema(get().schema, schema);
            set({
              dslText: text,
              schema: merged,
              diagnostics,
              dirtySource: null,
              stale: false,
            });
          },

          loadSchema(rawSchema) {
            // Imported / parsed schemas have no positions — lay them out so the
            // canvas is readable immediately (§13.4). Text is printed from the
            // pre-layout schema so positions (which the DSL doesn't encode) don't
            // affect the canonical output.
            const text = print(rawSchema);
            const schema = needsLayout(rawSchema) ? gridLayout(rawSchema) : rawSchema;
            lastPrinted = text;
            set({
              schema,
              dslText: text,
              diagnostics: [],
              dirtySource: null,
              stale: false,
            });
          },

          addTable(partial) {
            const id = newTableId();
            mutate((s) => {
              const table: Table = {
                id,
                namespace: 'public',
                name: uniqueTableName(s, partial?.name ?? 'new_table'),
                columns: [
                  {
                    id: newColumnId(),
                    name: 'id',
                    type: { name: 'bigint', args: [], arrayDims: 0 },
                    notNull: true,
                    unique: false,
                    identity: 'by_default',
                    generated: { kind: 'none' },
                  },
                ],
                primaryKey: [],
                checks: [],
                pos: partial?.pos ?? { x: 40, y: 40 },
                ...partial,
              };
              table.id = id;
              if (table.primaryKey.length === 0 && table.columns[0]) {
                table.primaryKey = [table.columns[0].id];
              }
              s.tables.push(table);
            });
            return id;
          },

          updateTable(id, patch) {
            mutate((s) => {
              const t = s.tables.find((x) => x.id === id);
              if (t) Object.assign(t, patch);
            });
          },

          deleteTables(ids) {
            const set0 = new Set(ids);
            mutate((s) => {
              s.tables = s.tables.filter((t) => !set0.has(t.id));
              s.relationships = s.relationships.filter(
                (r) => !set0.has(r.sourceTable) && !set0.has(r.targetTable),
              );
              s.indexes = s.indexes.filter((ix) => !set0.has(ix.table));
            });
            get().actions.clearSelection();
          },

          moveTables(ids, dx, dy) {
            const set0 = new Set(ids);
            mutate((s) => {
              for (const t of s.tables) {
                if (set0.has(t.id)) {
                  t.pos = { x: t.pos.x + dx, y: t.pos.y + dy };
                }
              }
            });
          },

          addColumn(table, partial) {
            const id = newColumnId();
            mutate((s) => {
              const t = s.tables.find((x) => x.id === table);
              if (!t) return;
              t.columns.push({
                name: uniqueColumnName(t, partial?.name ?? 'column'),
                type: partial?.type ?? { name: 'text', args: [], arrayDims: 0 },
                notNull: false,
                unique: false,
                identity: 'none',
                generated: { kind: 'none' },
                ...partial,
                id,
              });
            });
            return id;
          },

          updateColumn(table, id, patch) {
            mutate((s) => {
              const t = s.tables.find((x) => x.id === table);
              const c = t?.columns.find((x) => x.id === id);
              if (c) Object.assign(c, patch);
            });
          },

          deleteColumn(table, id) {
            mutate((s) => {
              const t = s.tables.find((x) => x.id === table);
              if (!t) return;
              t.columns = t.columns.filter((c) => c.id !== id);
              t.primaryKey = t.primaryKey.filter((c) => c !== id);
              s.relationships = s.relationships.filter(
                (r) => !r.sourceColumns.includes(id) && !r.targetColumns.includes(id),
              );
            });
          },

          addRelationship(r) {
            const id = `r_${Math.random().toString(36).slice(2, 10)}` as RelId;
            mutate((s) => {
              s.relationships.push({ ...r, id });
            });
            return id;
          },

          deleteRelationship(id) {
            mutate((s) => {
              s.relationships = s.relationships.filter((r) => r.id !== id);
            });
          },

          importSqlText(sql) {
            const { schema, diagnostics } = importSql(sql, NOW());
            get().actions.loadSchema(schema);
            set({ diagnostics });
            return diagnostics;
          },

          selectTable(id, additive) {
            set((state) => {
              const tables = new Set(additive ? state.selection.tables : []);
              tables.add(id);
              return { selection: { ...state.selection, tables } };
            });
          },

          clearSelection() {
            set({ selection: { tables: new Set(), columns: new Set(), rels: new Set() } });
          },

          setViewport(v) {
            set((state) => ({ viewport: { ...state.viewport, ...v } }));
          },

          toggleUi(key) {
            set((state) => ({ ui: { ...state.ui, [key]: !state.ui[key] } }));
          },

          setUi(key, value) {
            set((state) => ({ ui: { ...state.ui, [key]: value } }));
          },

          undo() {
            useStore.temporal.getState().undo();
            reprintAfterTimeTravel();
          },
          redo() {
            useStore.temporal.getState().redo();
            reprintAfterTimeTravel();
          },
        },
      };
    },
    {
      // Only the schema participates in undo history.
      partialize: (state) => ({ schema: state.schema }),
      limit: 100,
      equality: (a, b) => a.schema === b.schema,
    },
  ),
);

function uniqueTableName(s: Schema, base: string): string {
  let name = base;
  let n = 1;
  const exists = (nm: string) => s.tables.some((t) => t.name.toLowerCase() === nm.toLowerCase());
  while (exists(name)) name = `${base}_${++n}`;
  return name;
}

function uniqueColumnName(t: Table, base: string): string {
  let name = base;
  let n = 1;
  const exists = (nm: string) => t.columns.some((c) => c.name.toLowerCase() === nm.toLowerCase());
  while (exists(name)) name = `${base}_${++n}`;
  return name;
}

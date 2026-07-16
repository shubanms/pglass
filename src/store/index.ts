// The single Zustand store. See PRD §7. zundo (temporal) tracks only the schema
// slice for undo/redo; viewport and selection are intentionally not undoable.
//
// The bidirectional text↔model sync loop (§8) lives here: setDslText parses and
// merges into the live model; model mutations reprint canonical text behind a
// reprint guard so the two views never thrash.
import { enableMapSet, produce } from 'immer';
import { temporal } from 'zundo';
import { create } from 'zustand';
import { createParseScheduler } from '../dsl/parse-scheduler.ts';
import { print } from '../dsl/printer.ts';
import { type LayoutAlgo, autoLayout } from '../layout/auto-layout.ts';
import { gridLayout, needsLayout } from '../layout/grid.ts';
import { newColumnId, newGroupId, newNoteId, newTableId, newViewId } from '../model/ids.ts';
import { emptySchema } from '../model/schema.ts';
import type {
  Column,
  ColumnId,
  Diagnostic,
  GroupId,
  NoteId,
  RelId,
  Relationship,
  Schema,
  StickyNote,
  Table,
  TableGroup,
  TableId,
  View,
  ViewId,
} from '../model/types.ts';
import { importSql } from '../sql/import/ddl-parser.ts';
import { mergeSchema } from './merge.ts';

enableMapSet();

export type BottomTab = 'diagnostics' | 'lint' | 'diff' | 'generated';
export type EditorPane = 'hidden' | 'split' | 'full';
export type Theme = 'light' | 'dark' | 'system' | 'presentation';
export type EdgeStyle = 'orthogonal' | 'bezier' | 'straight';

export interface PanelLayout {
  leftWidth: number;
  rightWidth: number;
  editorWidth: number;
  bottomHeight: number;
}

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
  /** drag-resizable panel sizes in px (persisted to localStorage) */
  layout: PanelLayout;
}

export const DEFAULT_LAYOUT: PanelLayout = {
  leftWidth: 232,
  rightWidth: 300,
  editorWidth: 460,
  bottomHeight: 190,
};

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
  /** bumped to ask the canvas to zoom-to-fit (after layout / load) */
  fitNonce: number;
  /** set to ask the canvas to pan a specific table into view (palette jump) */
  reveal: { table: TableId; nonce: number } | null;
  /** bumped to ask the canvas to fit the current selection (Shift+F) */
  focusNonce: number;

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
  duplicateTable(id: TableId): TableId;
  moveTables(ids: TableId[], dx: number, dy: number): void;

  addColumn(table: TableId, partial?: Partial<Column>): ColumnId;
  updateColumn(table: TableId, id: ColumnId, patch: Partial<Column>): void;
  deleteColumn(table: TableId, id: ColumnId): void;

  addRelationship(r: Omit<Relationship, 'id'>): RelId;
  deleteRelationship(id: RelId): void;

  /** flip a junction table between full and collapsed M:N rendering */
  toggleMN(id: TableId): void;

  /** group the current selection into a new TableGroup */
  groupSelection(): void;
  ungroup(id: GroupId): void;
  updateGroup(id: GroupId, patch: Partial<TableGroup>): void;
  toggleGroupCollapsed(id: GroupId): void;
  moveGroup(id: GroupId, dx: number, dy: number): void;

  addNote(pos: { x: number; y: number }): NoteId;
  updateNote(id: NoteId, patch: Partial<StickyNote>): void;
  deleteNote(id: NoteId): void;
  moveNote(id: NoteId, dx: number, dy: number): void;

  addView(pos: { x: number; y: number }): ViewId;
  updateView(id: ViewId, patch: Partial<View>): void;
  deleteView(id: ViewId): void;
  moveView(id: ViewId, dx: number, dy: number): void;

  importSqlText(sql: string): Diagnostic[];
  applyFix(d: Diagnostic): void;
  autoLayout(algo: LayoutAlgo, selectionOnly?: boolean): Promise<void>;

  selectTable(id: TableId, additive?: boolean): void;
  setSelectedTables(ids: TableId[]): void;
  revealTable(id: TableId): void;
  selectAllTables(): void;
  duplicateSelection(): void;
  clearSelection(): void;

  setViewport(v: Partial<{ x: number; y: number; zoom: number }>): void;
  requestFit(): void;
  focusSelection(): void;
  toggleUi<K extends keyof UiState>(key: K): void;
  setUi<K extends keyof UiState>(key: K, value: UiState[K]): void;
  setLayout(patch: Partial<PanelLayout>): void;

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

// UI preferences (theme, panel sizes, view toggles) persist to localStorage —
// separate from schema autosave (Dexie). focusMode is deliberately transient.
const UI_STORAGE_KEY = 'pglass:ui';
const PERSISTED_UI_KEYS: (keyof UiState)[] = [
  'leftPanel',
  'rightPanel',
  'bottomPanel',
  'editorPane',
  'theme',
  'showGrid',
  'snapToGrid',
  'gridSize',
  'showMinimap',
  'edgeStyle',
  'compactColumns',
  'layout',
];

function loadPersistedUi(): Partial<UiState> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<UiState>;
    if (parsed.layout) parsed.layout = { ...DEFAULT_LAYOUT, ...parsed.layout };
    return parsed;
  } catch {
    return {};
  }
}

function savePersistedUi(ui: UiState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const out: Record<string, unknown> = {};
    for (const k of PERSISTED_UI_KEYS) out[k] = ui[k];
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(out));
  } catch {
    // storage full / unavailable — non-fatal
  }
}

const clampLayout = (l: PanelLayout): PanelLayout => ({
  leftWidth: Math.max(160, Math.min(440, l.leftWidth)),
  rightWidth: Math.max(220, Math.min(520, l.rightWidth)),
  editorWidth: Math.max(280, Math.min(900, l.editorWidth)),
  bottomHeight: Math.max(80, Math.min(480, l.bottomHeight)),
});

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

      /** Apply a freshly-parsed schema (from the worker/scheduler) into the live
       *  model. On errors keep the last-good model and dim the canvas (§8). */
      const applyParse = ({
        schema,
        diagnostics,
      }: { schema: Schema; diagnostics: Diagnostic[] }) => {
        if (diagnostics.some((d) => d.severity === 'error')) {
          set({ diagnostics, stale: true });
          return;
        }
        const merged = placeViews(mergeSchema(get().schema, schema));
        set({ schema: merged, diagnostics, dirtySource: null, stale: false });
      };

      const scheduler = createParseScheduler(applyParse);

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
        fitNonce: 0,
        reveal: null,
        focusNonce: 0,

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
          layout: DEFAULT_LAYOUT,
          // restore persisted preferences over the defaults above
          ...loadPersistedUi(),
        },

        actions: {
          setDslText(text) {
            if (text === lastPrinted) return; // echo of our own print — ignore
            // Keep the editor responsive: commit the text immediately, then let
            // the scheduler parse+merge off the main thread (§8). The debounce
            // and monotonic request id live in the scheduler; here we only need
            // the reprint guard so our own prints don't loop back through it.
            set({ dslText: text, dirtySource: 'text' });
            scheduler.request(text, NOW());
          },

          loadSchema(rawSchema) {
            // Imported / parsed schemas have no positions — lay them out so the
            // canvas is readable immediately (§13.4). Text is printed from the
            // pre-layout schema so positions (which the DSL doesn't encode) don't
            // affect the canonical output.
            const text = print(rawSchema);
            const schema = placeViews(needsLayout(rawSchema) ? gridLayout(rawSchema) : rawSchema);
            lastPrinted = text;
            set((st) => ({
              schema,
              dslText: text,
              diagnostics: [],
              dirtySource: null,
              stale: false,
              fitNonce: st.fitNonce + 1,
            }));
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

          duplicateTable(id) {
            const newId = newTableId();
            mutate((s) => {
              const src = s.tables.find((t) => t.id === id);
              if (!src) return;
              const colIdMap = new Map<ColumnId, ColumnId>();
              const columns = src.columns.map((c) => {
                const cid = newColumnId();
                colIdMap.set(c.id, cid);
                return { ...c, id: cid };
              });
              s.tables.push({
                ...src,
                id: newId,
                name: uniqueTableName(s, `${src.name}_copy`),
                columns,
                primaryKey: src.primaryKey.map((c) => colIdMap.get(c) ?? c),
                pos: { x: src.pos.x + 40, y: src.pos.y + 40 },
              });
            });
            return newId;
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

          toggleMN(id) {
            mutate((s) => {
              const t = s.tables.find((x) => x.id === id);
              if (t) t.showAsMN = !t.showAsMN;
            });
          },

          groupSelection() {
            const ids = get().selection.tables;
            if (ids.size === 0) return;
            const gid = newGroupId();
            const palette = ['#4F46E5', '#059669', '#dc2626', '#d97706', '#7c3aed', '#0891b2'];
            mutate((s) => {
              const n = s.groups.length;
              s.groups.push({
                id: gid,
                name: `group_${n + 1}`,
                color: palette[n % palette.length]!,
              });
              for (const t of s.tables) if (ids.has(t.id)) t.groupId = gid;
            });
          },

          ungroup(id) {
            mutate((s) => {
              s.groups = s.groups.filter((g) => g.id !== id);
              for (const t of s.tables) if (t.groupId === id) t.groupId = undefined;
            });
          },

          updateGroup(id, patch) {
            mutate((s) => {
              const g = s.groups.find((x) => x.id === id);
              if (g) Object.assign(g, patch);
            });
          },

          toggleGroupCollapsed(id) {
            mutate((s) => {
              const g = s.groups.find((x) => x.id === id);
              if (g) g.collapsed = !g.collapsed;
            });
          },

          moveGroup(id, dx, dy) {
            mutate((s) => {
              for (const t of s.tables) {
                if (t.groupId === id) t.pos = { x: t.pos.x + dx, y: t.pos.y + dy };
              }
            });
          },

          addNote(pos) {
            const id = newNoteId();
            mutate((s) => {
              s.notes.push({
                id,
                text: 'New note',
                pos,
                size: { w: 200, h: 120 },
                color: '#fde68a',
              });
            });
            return id;
          },

          updateNote(id, patch) {
            mutate((s) => {
              const n = s.notes.find((x) => x.id === id);
              if (n) Object.assign(n, patch);
            });
          },

          deleteNote(id) {
            mutate((s) => {
              s.notes = s.notes.filter((n) => n.id !== id);
            });
          },

          moveNote(id, dx, dy) {
            mutate((s) => {
              const n = s.notes.find((x) => x.id === id);
              if (n) n.pos = { x: n.pos.x + dx, y: n.pos.y + dy };
            });
          },

          addView(pos) {
            const id = newViewId();
            mutate((s) => {
              s.views.push({
                id,
                namespace: 'public',
                name: uniqueViewName(s, 'new_view'),
                query: 'select * from ',
                materialized: false,
                pos,
              });
            });
            return id;
          },

          updateView(id, patch) {
            mutate((s) => {
              const v = s.views.find((x) => x.id === id);
              if (v) Object.assign(v, patch);
            });
          },

          deleteView(id) {
            mutate((s) => {
              s.views = s.views.filter((v) => v.id !== id);
            });
          },

          moveView(id, dx, dy) {
            mutate((s) => {
              const v = s.views.find((x) => x.id === id);
              if (v) v.pos = { x: (v.pos?.x ?? 0) + dx, y: (v.pos?.y ?? 0) + dy };
            });
          },

          importSqlText(sql) {
            const { schema, diagnostics } = importSql(sql, NOW());
            get().actions.loadSchema(schema);
            set({ diagnostics });
            return diagnostics;
          },

          applyFix(d) {
            if (!d.fix) return;
            const next = d.fix.apply(get().schema);
            set({ schema: next, dirtySource: 'model' });
            reprint();
          },

          async autoLayout(algo, selectionOnly) {
            const state = get();
            const only =
              selectionOnly && state.selection.tables.size > 0 ? state.selection.tables : undefined;
            const positions = await autoLayout(state.schema, algo, only);
            if (positions.size === 0) return;
            mutate((s) => {
              for (const t of s.tables) {
                const p = positions.get(t.id);
                if (p) t.pos = p;
              }
            });
            set((st) => ({ fitNonce: st.fitNonce + 1 }));
          },

          selectTable(id, additive) {
            set((state) => {
              const tables = new Set(additive ? state.selection.tables : []);
              tables.add(id);
              return { selection: { ...state.selection, tables } };
            });
          },

          setSelectedTables(ids) {
            set((state) => ({ selection: { ...state.selection, tables: new Set(ids) } }));
          },

          revealTable(id) {
            set((state) => ({
              selection: { ...state.selection, tables: new Set([id]) },
              reveal: { table: id, nonce: (state.reveal?.nonce ?? 0) + 1 },
            }));
          },

          selectAllTables() {
            set((state) => ({
              selection: {
                ...state.selection,
                tables: new Set(state.schema.tables.map((t) => t.id)),
              },
            }));
          },

          duplicateSelection() {
            const ids = [...get().selection.tables];
            if (ids.length === 0) return;
            const created = ids.map((id) => get().actions.duplicateTable(id));
            set((state) => ({
              selection: { ...state.selection, tables: new Set(created) },
            }));
          },

          clearSelection() {
            set({ selection: { tables: new Set(), columns: new Set(), rels: new Set() } });
          },

          setViewport(v) {
            set((state) => ({ viewport: { ...state.viewport, ...v } }));
          },

          requestFit() {
            set((st) => ({ fitNonce: st.fitNonce + 1 }));
          },

          focusSelection() {
            set((st) => ({ focusNonce: st.focusNonce + 1 }));
          },

          toggleUi(key) {
            set((state) => ({ ui: { ...state.ui, [key]: !state.ui[key] } }));
            savePersistedUi(get().ui);
          },

          setUi(key, value) {
            set((state) => ({ ui: { ...state.ui, [key]: value } }));
            savePersistedUi(get().ui);
          },

          setLayout(patch) {
            set((state) => ({
              ui: { ...state.ui, layout: clampLayout({ ...state.ui.layout, ...patch }) },
            }));
            savePersistedUi(get().ui);
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

/** Assign a position to any view that lacks one (parsed/imported views carry no
 *  pos), placing them in a column to the right of the tables. Positions are
 *  visual-only and carried across reparses by the merge, like table positions. */
function placeViews(schema: Schema): Schema {
  if (schema.views.every((v) => v.pos)) return schema;
  const rightmost = schema.tables.length
    ? Math.max(...schema.tables.map((t) => t.pos.x + (t.size?.w ?? 240))) + 80
    : 40;
  let y = 40;
  const views = schema.views.map((v) => {
    if (v.pos) return v;
    const placed = { ...v, pos: { x: rightmost, y } };
    y += 180;
    return placed;
  });
  return { ...schema, views };
}

function uniqueViewName(s: Schema, base: string): string {
  let name = base;
  let n = 1;
  const exists = (nm: string) => s.views.some((v) => v.name.toLowerCase() === nm.toLowerCase());
  while (exists(name)) name = `${base}_${++n}`;
  return name;
}

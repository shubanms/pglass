import { typeStr } from '../dsl/printer.ts';
// Pure geometry for the canvas: table box sizing, column port anchors, and
// orthogonal edge routing with crow's-foot cardinality. See PRD §12.
import { columnsAreUnique } from '../model/schema.ts';
import type { ColumnId, Relationship, Schema, Table, TableId } from '../model/types.ts';

export const HEADER_H = 32;
export const ROW_H = 24;
export const MIN_W = 200;
export const MAX_W = 400;
const CHAR_W = 7.3; // approx advance for the 13px mono column font
const PADDING = 40; // icon + gutters

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function tableSize(table: Table): { w: number; h: number } {
  if (table.size) return table.size;
  let widest = table.name.length + 4;
  for (const c of table.columns) {
    widest = Math.max(widest, c.name.length + typeStr(c.type).length + 3);
  }
  const w = Math.min(MAX_W, Math.max(MIN_W, Math.round(widest * CHAR_W + PADDING)));
  const rows = table.collapsed ? 0 : table.columns.length;
  const h = HEADER_H + rows * ROW_H;
  return { w, h };
}

export function tableBox(table: Table): Box {
  const { w, h } = tableSize(table);
  return { x: table.pos.x, y: table.pos.y, w, h };
}

/** Y offset (world coords) of a column row's vertical centre. */
export function columnPortY(table: Table, columnId: ColumnId): number {
  const idx = table.columns.findIndex((c) => c.id === columnId);
  if (idx < 0 || table.collapsed) return table.pos.y + HEADER_H / 2;
  return table.pos.y + HEADER_H + idx * ROW_H + ROW_H / 2;
}

export type Side = 'left' | 'right';
export type Cardinality = 'one' | 'zero-or-one' | 'many' | 'zero-or-many';

export interface EdgeGeometry {
  path: string;
  source: { x: number; y: number; side: Side; card: Cardinality };
  target: { x: number; y: number; side: Side; card: Cardinality };
}

/** Choose the pair of ports (left/right on each table) that are closest. */
function chooseSides(src: Box, tgt: Box): { srcSide: Side; tgtSide: Side } {
  const srcRight = src.x + src.w;
  const tgtRight = tgt.x + tgt.w;
  // if target is clearly to the right, exit src-right → enter tgt-left
  if (tgt.x >= srcRight - 20) return { srcSide: 'right', tgtSide: 'left' };
  if (src.x >= tgtRight - 20) return { srcSide: 'left', tgtSide: 'right' };
  // overlapping horizontally — pick the shorter of the two sensible pairings
  const rr = Math.abs(srcRight - tgtRight);
  const ll = Math.abs(src.x - tgt.x);
  return rr <= ll ? { srcSide: 'right', tgtSide: 'right' } : { srcSide: 'left', tgtSide: 'left' };
}

function portX(box: Box, side: Side): number {
  return side === 'right' ? box.x + box.w : box.x;
}

/** A simple orthogonal (Manhattan) route between two side ports. */
function orthogonalPath(
  sx: number,
  sy: number,
  ss: Side,
  tx: number,
  ty: number,
  ts: Side,
): string {
  const stub = 18;
  const sOut = ss === 'right' ? sx + stub : sx - stub;
  const tOut = ts === 'right' ? tx + stub : tx - stub;
  const midX = (sOut + tOut) / 2;
  // horizontal stub out, vertical to target row, horizontal stub in
  if (ss === ts) {
    const ext = ss === 'right' ? Math.max(sOut, tOut) : Math.min(sOut, tOut);
    return `M ${sx} ${sy} H ${ext} V ${ty} H ${tx}`;
  }
  return `M ${sx} ${sy} H ${midX} V ${ty} H ${tx}`;
}

export function bezierPath(sx: number, sy: number, ss: Side, tx: number, ty: number): string {
  const dx = Math.max(40, Math.abs(tx - sx) / 2);
  const c1x = ss === 'right' ? sx + dx : sx - dx;
  const c2x = tx < sx ? tx + dx : tx - dx;
  return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
}

/**
 * Cardinality per PRD §12.3:
 *  - target (referenced) side is always "one": || if every FK source column is
 *    NOT NULL, |o otherwise.
 *  - source (FK holder) side is }o (zero-or-more), or |o (zero-or-one) if the FK
 *    columns carry a UNIQUE constraint (1:1).
 */
export function cardinalities(
  schema: Schema,
  rel: Relationship,
): { source: Cardinality; target: Cardinality } {
  const srcTable = schema.tables.find((t) => t.id === rel.sourceTable);
  const allNotNull =
    !!srcTable &&
    rel.sourceColumns.every((id) => srcTable.columns.find((c) => c.id === id)?.notNull);
  const unique = !!srcTable && columnsAreUnique(schema, srcTable, rel.sourceColumns);
  return {
    source: unique ? 'zero-or-one' : 'zero-or-many',
    target: allNotNull ? 'one' : 'zero-or-one',
  };
}

export function routeEdge(
  schema: Schema,
  rel: Relationship,
  style: 'orthogonal' | 'bezier' | 'straight' = 'orthogonal',
): EdgeGeometry | null {
  const src = schema.tables.find((t) => t.id === rel.sourceTable);
  const tgt = schema.tables.find((t) => t.id === rel.targetTable);
  if (!src || !tgt) return null;

  const srcBox = tableBox(src);
  const tgtBox = tableBox(tgt);
  const card = cardinalities(schema, rel);

  // self-referencing FK: loop out the right and back (PRD §12.3)
  if (src.id === tgt.id) {
    const y1 = columnPortY(src, rel.sourceColumns[0] ?? src.columns[0]!.id);
    const y2 = columnPortY(tgt, rel.targetColumns[0] ?? tgt.columns[0]!.id);
    const x = srcBox.x + srcBox.w;
    const out = x + 40;
    return {
      path: `M ${x} ${y1} H ${out} V ${y2} H ${x}`,
      source: { x, y: y1, side: 'right', card: card.source },
      target: { x, y: y2, side: 'right', card: card.target },
    };
  }

  const { srcSide, tgtSide } = chooseSides(srcBox, tgtBox);
  const sx = portX(srcBox, srcSide);
  const sy = columnPortY(src, rel.sourceColumns[0] ?? src.columns[0]!.id);
  const tx = portX(tgtBox, tgtSide);
  const ty = columnPortY(tgt, rel.targetColumns[0] ?? tgt.columns[0]!.id);

  let path: string;
  if (style === 'straight') path = `M ${sx} ${sy} L ${tx} ${ty}`;
  else if (style === 'bezier') path = bezierPath(sx, sy, srcSide, tx, ty);
  else path = orthogonalPath(sx, sy, srcSide, tx, ty, tgtSide);

  return {
    path,
    source: { x: sx, y: sy, side: srcSide, card: card.source },
    target: { x: tx, y: ty, side: tgtSide, card: card.target },
  };
}

/** World-space bounding box of all tables + enums, for zoom-to-fit / export. */
export function contentBounds(schema: Schema, margin = 40): Box {
  if (schema.tables.length === 0) return { x: 0, y: 0, w: 400, h: 300 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const t of schema.tables) {
    const b = tableBox(t);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return {
    x: minX - margin,
    y: minY - margin,
    w: maxX - minX + margin * 2,
    h: maxY - minY + margin * 2,
  };
}

export function tablesInView(schema: Schema, view: Box, margin = 200): Table[] {
  const vx = view.x - margin;
  const vy = view.y - margin;
  const vr = view.x + view.w + margin;
  const vb = view.y + view.h + margin;
  return schema.tables.filter((t) => {
    const b = tableBox(t);
    return b.x < vr && b.x + b.w > vx && b.y < vb && b.y + b.h > vy;
  });
}

export type { TableId };

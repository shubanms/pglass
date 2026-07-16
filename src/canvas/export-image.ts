// Image export (PRD §16). Renders the diagram to a standalone SVG string built
// straight from the schema + geometry — NOT the live (virtualised) DOM — so the
// export always contains every table, off-screen or not, and is independent of
// zoom/pan. Colours are resolved from the active theme's CSS variables so the
// export honours light / dark / presentation. PNG is that SVG rasterised onto a
// <canvas> at 1×/2×/4×.
import { typeStr } from '../dsl/printer.ts';
import { fkColumnIds } from '../model/schema.ts';
import type { Relationship, Schema, Table, TableId } from '../model/types.ts';
import { type Cardinality, HEADER_H, ROW_H, type Side, routeEdge, tableBox } from './geometry.ts';

export interface ImageOptions {
  /** export just these tables (+ edges between them); undefined = whole diagram */
  selection?: Set<TableId>;
  includeGrid?: boolean;
  /** false → transparent background (PNG); SVG always fills unless transparent */
  background?: boolean;
  padding?: number;
}

export interface Palette {
  bg: string;
  bgElevated: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  grid: string;
}

const FALLBACK: Palette = {
  bg: '#fafafa',
  bgElevated: '#ffffff',
  border: '#e4e4e7',
  text: '#18181b',
  textMuted: '#71717a',
  accent: '#4f46e5',
  grid: '#ececec',
};

/** Read the live theme's colours off the document root. */
export function resolvePalette(): Palette {
  if (typeof getComputedStyle === 'undefined') return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    bg: v('--canvas-bg', FALLBACK.bg),
    bgElevated: v('--bg-elevated', FALLBACK.bgElevated),
    border: v('--border', FALLBACK.border),
    text: v('--text', FALLBACK.text),
    textMuted: v('--text-muted', FALLBACK.textMuted),
    accent: v('--accent', FALLBACK.accent),
    grid: v('--canvas-grid', FALLBACK.grid),
  };
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Crow's-foot glyph (string form of markers.tsx) at an endpoint. */
function crowFoot(
  x: number,
  y: number,
  side: Side,
  card: Cardinality,
  color: string,
  bg: string,
): string {
  const dir = side === 'right' ? 1 : -1;
  const at = (o: number) => x + dir * o;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" fill="none"/>`;
  const tick = (o: number) => line(at(o), y - 6, at(o), y + 6);
  const circle = (o: number) =>
    `<circle cx="${at(o)}" cy="${y}" r="4" stroke="${color}" stroke-width="1.5" fill="${bg}"/>`;
  const foot = () => line(at(13), y, x, y - 7) + line(at(13), y, x, y + 7) + line(at(13), y, x, y);
  switch (card) {
    case 'one':
      return tick(6) + tick(11);
    case 'zero-or-one':
      return tick(11) + circle(5);
    default:
      return foot() + circle(17);
  }
}

/** Pure SVG builder — testable without a DOM. */
export function buildSvg(schema: Schema, palette: Palette, opts: ImageOptions = {}): string {
  const pad = opts.padding ?? 32;
  const tables: Table[] = opts.selection
    ? schema.tables.filter((t) => opts.selection!.has(t.id))
    : schema.tables;

  // tight content bounds over the exported tables
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const t of tables) {
    const b = tableBox(t);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 400;
    maxY = 300;
  }
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  const shown = new Set(tables.map((t) => t.id));
  const rels: Relationship[] = schema.relationships.filter(
    (r) => shown.has(r.sourceTable) && shown.has(r.targetTable),
  );

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}" font-family="Inter, system-ui, sans-serif">`,
  );
  parts.push(
    `<style>text{-webkit-font-smoothing:antialiased}.mono{font-family:'JetBrains Mono',ui-monospace,monospace}</style>`,
  );

  if (opts.background !== false) {
    parts.push(`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${palette.bg}"/>`);
  }
  if (opts.includeGrid) {
    parts.push(
      `<defs><pattern id="pgl-grid" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="${palette.grid}" stroke-width="1"/></pattern></defs><rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="url(#pgl-grid)"/>`,
    );
  }

  // edges first (under the tables)
  for (const rel of rels) {
    const g = routeEdge(schema, rel, 'orthogonal');
    if (!g) continue;
    parts.push(
      `<path d="${g.path}" fill="none" stroke="${palette.textMuted}" stroke-width="1.5"/>`,
    );
    parts.push(
      crowFoot(g.source.x, g.source.y, g.source.side, g.source.card, palette.textMuted, palette.bg),
    );
    parts.push(
      crowFoot(g.target.x, g.target.y, g.target.side, g.target.card, palette.textMuted, palette.bg),
    );
  }

  // tables
  for (const t of tables) {
    const b = tableBox(t);
    const accent = t.color ?? palette.accent;
    const pk = new Set(t.primaryKey);
    const fk = fkColumnIds(schema, t.id);
    parts.push(`<g transform="translate(${b.x} ${b.y})">`);
    parts.push(
      `<rect width="${b.w}" height="${b.h}" rx="6" fill="${palette.bgElevated}" stroke="${palette.border}" stroke-width="1"/>`,
    );
    parts.push(`<rect width="${b.w}" height="4" rx="2" fill="${accent}"/>`);
    parts.push(
      `<text x="12" y="${4 + HEADER_H / 2 + 1}" font-size="13" font-weight="600" fill="${palette.text}">${esc(t.name)}</text>`,
    );
    if (!t.collapsed) {
      t.columns.forEach((c, i) => {
        const y = HEADER_H + i * ROW_H + ROW_H / 2 + 4;
        const badge = pk.has(c.id) ? '🔑 ' : fk.has(c.id) ? '↗ ' : '';
        parts.push(
          `<text x="12" y="${y}" font-size="12" fill="${palette.text}">${esc(badge + c.name)}</text>`,
        );
        parts.push(
          `<text class="mono" x="${b.w - 12}" y="${y}" font-size="11" text-anchor="end" fill="${palette.textMuted}">${esc(typeStr(c.type))}</text>`,
        );
      });
    }
    parts.push('</g>');
  }

  parts.push('</svg>');
  return parts.join('');
}

/** Whole-diagram (or selection) SVG using the live theme. */
export function exportSvg(schema: Schema, opts: ImageOptions = {}): string {
  return buildSvg(schema, resolvePalette(), opts);
}

/** Rasterise an SVG string to a PNG blob at the given scale. Browser-only. */
export function svgToPng(svg: string, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no 2d context'));
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        'image/png',
      );
    };
    img.onerror = () => reject(new Error('SVG render failed'));
    img.src = url;
  });
}

export function downloadBlob(data: Blob | string, filename: string, mime = 'image/svg+xml') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Crow's-foot (IE notation) cardinality markers, drawn at an edge endpoint.
// Ports sit on the left/right side of a table, so markers open horizontally.
import type { Cardinality, Side } from './geometry.ts';

/** Render the cardinality glyph at endpoint (x,y). `side` is the table side the
 *  line attaches to; the glyph extends outward (away from the table). */
export function CrowFoot({
  x,
  y,
  side,
  card,
  color,
}: {
  x: number;
  y: number;
  side: Side;
  card: Cardinality;
  color: string;
}) {
  const dir = side === 'right' ? 1 : -1; // outward direction
  const at = (o: number) => x + dir * o;
  const els: React.ReactNode[] = [];
  const stroke = { stroke: color, strokeWidth: 1.5, fill: 'none' as const };

  const tick = (o: number, key: string) => (
    <line key={key} x1={at(o)} y1={y - 6} x2={at(o)} y2={y + 6} {...stroke} />
  );
  const circle = (o: number, key: string) => (
    <circle
      key={key}
      cx={at(o)}
      cy={y}
      r={4}
      stroke={color}
      strokeWidth={1.5}
      fill="var(--canvas-bg)"
    />
  );
  const foot = (key: string) => (
    <g key={key} {...stroke}>
      <line x1={at(13)} y1={y} x2={x} y2={y - 7} />
      <line x1={at(13)} y1={y} x2={x} y2={y + 7} />
      <line x1={at(13)} y1={y} x2={x} y2={y} />
    </g>
  );

  switch (card) {
    case 'one':
      els.push(tick(6, 't1'), tick(11, 't2'));
      break;
    case 'zero-or-one':
      els.push(tick(11, 't1'), circle(5, 'c1'));
      break;
    case 'many':
    case 'zero-or-many':
      els.push(foot('f'), circle(17, 'c1'));
      break;
  }
  return <g>{els}</g>;
}

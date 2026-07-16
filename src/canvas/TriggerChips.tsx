// Trigger chips (Phase 17): small pills anchored just beneath their owning
// table, one per trigger. Triggers belong to a table, so rather than float
// them independently we stack them under the table box and let them ride along
// when the table is dragged. Editing happens through the DSL text.
import { Zap } from 'lucide-react';
import type { Table, Trigger } from '../model/types.ts';
import { useStore } from '../store/index.ts';
import { tableBox } from './geometry.ts';

const CHIP_H = 20;
const CHIP_GAP = 4;
const CHIP_W = 210;

const TIMING_ABBR: Record<Trigger['timing'], string> = {
  before: 'BEFORE',
  after: 'AFTER',
  'instead of': 'INSTEAD OF',
};

export function TriggerChips({
  table,
  triggers,
  compact,
  offset,
}: {
  table: Table;
  triggers: Trigger[];
  compact: boolean;
  offset?: { x: number; y: number };
}) {
  const deleteTrigger = useStore((s) => s.actions.deleteTrigger);
  if (triggers.length === 0) return null;
  const box = tableBox(table, compact);
  const ox = box.x + (offset?.x ?? 0);
  const oy = box.y + box.h + (offset?.y ?? 0) + 8;

  return (
    <g transform={`translate(${ox} ${oy})`}>
      {triggers.map((tg, i) => {
        const y = i * (CHIP_H + CHIP_GAP);
        const accent = tg.color ?? '#d97706';
        const label = `${TIMING_ABBR[tg.timing]} ${tg.events.join('/').toUpperCase()}`;
        return (
          <g key={tg.id}>
            {/* short connector to the table above the first chip */}
            {i === 0 && (
              <line
                x1={16}
                y1={-8}
                x2={16}
                y2={0}
                stroke={accent}
                strokeWidth={1}
                strokeDasharray="2 2"
                opacity={0.6}
              />
            )}
            <foreignObject x={0} y={y} width={CHIP_W} height={CHIP_H}>
              <div
                className="group flex h-full items-center gap-1 truncate rounded-full border px-2 text-[10px] font-medium"
                style={{
                  borderColor: accent,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text)',
                }}
                title={`${tg.name} — ${tg.timing} ${tg.events.join(', ')} for each ${tg.level}, executes ${tg.functionName}()`}
              >
                <Zap size={10} style={{ color: accent, flexShrink: 0 }} />
                <span className="truncate font-semibold">{tg.name}</span>
                <span className="truncate" style={{ color: 'var(--text-muted)' }}>
                  {label}
                </span>
                <button
                  type="button"
                  aria-label="Delete trigger"
                  className="ml-auto shrink-0 opacity-0 group-hover:opacity-100"
                  onClick={() => deleteTrigger(tg.id)}
                  style={{ color: '#dc2626' }}
                >
                  ×
                </button>
              </div>
            </foreignObject>
          </g>
        );
      })}
    </g>
  );
}

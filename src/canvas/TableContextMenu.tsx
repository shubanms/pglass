// Right-click context menu for a table (PRD §12.4).
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Group,
  Pencil,
  Plus,
  Split,
  Trash2,
} from 'lucide-react';
import { useEffect } from 'react';
import { detectJunction } from '../model/junction.ts';
import type { TableId } from '../model/types.ts';
import { useStore } from '../store/index.ts';

const SWATCHES = ['#4F46E5', '#059669', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777'];

export function TableContextMenu({
  x,
  y,
  tableId,
  onClose,
  onRename,
}: {
  x: number;
  y: number;
  tableId: TableId;
  onClose: () => void;
  onRename: () => void;
}) {
  const actions = useStore((s) => s.actions);
  const schema = useStore((s) => s.schema);
  const table = useStore((s) => s.schema.tables.find((t) => t.id === tableId));
  const selectionSize = useStore((s) => s.selection.tables.size);
  const isJunction = table ? detectJunction(schema, table) !== null : false;

  useEffect(() => {
    const onDown = () => onClose();
    // close on the next click anywhere
    window.addEventListener('pointerdown', onDown, { once: true });
    return () => window.removeEventListener('pointerdown', onDown);
  }, [onClose]);

  if (!table) return null;

  const item = (icon: React.ReactNode, label: string, fn: () => void) => (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => {
        fn();
        onClose();
      }}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:opacity-80"
      style={{ color: 'var(--text)' }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div
      className="pgl-menu absolute z-50 w-52 overflow-hidden rounded-md border py-1 shadow-xl"
      style={{ left: x, top: y, borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {item(<Pencil size={14} />, 'Rename', onRename)}
      {item(<Plus size={14} />, 'Add column', () => actions.addColumn(tableId))}
      {item(<Copy size={14} />, 'Duplicate', () => actions.duplicateTable(tableId))}
      {item(
        table.collapsed ? <ChevronsUpDown size={14} /> : <ChevronsDownUp size={14} />,
        table.collapsed ? 'Expand' : 'Collapse',
        () => actions.updateTable(tableId, { collapsed: !table.collapsed }),
      )}
      {selectionSize > 1 &&
        item(<Group size={14} />, `Group ${selectionSize} tables`, () => actions.groupSelection())}
      {isJunction &&
        item(<Split size={14} />, table.showAsMN ? 'Show junction table' : 'Show as M:N', () =>
          actions.toggleMN(tableId),
        )}
      <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
      <div className="flex items-center gap-1.5 px-3 py-1.5">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Colour ${c}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              actions.updateTable(tableId, { color: c });
              onClose();
            }}
            className="h-4 w-4 rounded-full ring-1 ring-black/10 transition-transform hover:scale-125"
            style={{ background: c }}
          />
        ))}
      </div>
      <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
      {item(<Trash2 size={14} />, 'Delete', () => actions.deleteTables([tableId]))}
    </div>
  );
}

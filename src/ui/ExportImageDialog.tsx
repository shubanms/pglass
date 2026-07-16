// Image export dialog (PRD §16): SVG or PNG, whole diagram or selection, with
// transparent-background and grid options.
import { useState } from 'react';
import { downloadBlob, exportSvg, svgToPng } from '../canvas/export-image.ts';
import { useStore } from '../store/index.ts';
import { Dialog } from './Dialog.tsx';

export function ExportImageDialog({ onClose }: { onClose: () => void }) {
  const schema = useStore((s) => s.schema);
  const selection = useStore((s) => s.selection.tables);
  const [format, setFormat] = useState<'svg' | 'png'>('svg');
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [grid, setGrid] = useState(false);
  const [selectionOnly, setSelectionOnly] = useState(selection.size > 0);
  const [busy, setBusy] = useState(false);

  const base = (schema.name || 'schema').replace(/\s+/g, '_').toLowerCase();
  const opts = {
    selection: selectionOnly && selection.size > 0 ? selection : undefined,
    includeGrid: grid,
    background: !transparent,
  };

  const doExport = async () => {
    setBusy(true);
    try {
      const svg = exportSvg(schema, opts);
      if (format === 'svg') {
        downloadBlob(svg, `${base}.svg`, 'image/svg+xml');
      } else {
        const blob = await svgToPng(svg, scale);
        downloadBlob(blob, `${base}@${scale}x.png`, 'image/png');
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ children }: { children: React.ReactNode }) => (
    <div className="flex items-center justify-between py-1.5">{children}</div>
  );

  return (
    <Dialog title="Export image" onClose={onClose}>
      <div className="space-y-1 text-sm" style={{ color: 'var(--text)' }}>
        <Row>
          <span style={{ color: 'var(--text-muted)' }}>Format</span>
          <div className="flex gap-1">
            {(['svg', 'png'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormat(f)}
                className="rounded border px-3 py-1 text-xs uppercase"
                style={{
                  borderColor: 'var(--border)',
                  background: format === f ? 'var(--accent)' : 'transparent',
                  color: format === f ? '#fff' : 'var(--text)',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </Row>

        {format === 'png' && (
          <Row>
            <span style={{ color: 'var(--text-muted)' }}>Resolution</span>
            <div className="flex gap-1">
              {[1, 2, 4].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScale(s)}
                  className="rounded border px-3 py-1 text-xs"
                  style={{
                    borderColor: 'var(--border)',
                    background: scale === s ? 'var(--accent)' : 'transparent',
                    color: scale === s ? '#fff' : 'var(--text)',
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          </Row>
        )}

        <Row>
          <span style={{ color: 'var(--text-muted)' }}>Transparent background</span>
          <input
            type="checkbox"
            checked={transparent}
            onChange={(e) => setTransparent(e.target.checked)}
          />
        </Row>
        <Row>
          <span style={{ color: 'var(--text-muted)' }}>Include grid</span>
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />
        </Row>
        <Row>
          <span style={{ color: 'var(--text-muted)' }}>
            Selection only {selection.size > 0 ? `(${selection.size})` : ''}
          </span>
          <input
            type="checkbox"
            checked={selectionOnly}
            disabled={selection.size === 0}
            onChange={(e) => setSelectionOnly(e.target.checked)}
          />
        </Row>

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={doExport}
            disabled={busy}
            className="rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {busy ? 'Rendering…' : `Download ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

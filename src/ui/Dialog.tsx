import { X } from 'lucide-react';
import { useEffect } from 'react';

export function Dialog({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="pgl-overlay fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onPointerDown={onClose}
    >
      <div
        className={`pgl-dialog flex max-h-[85vh] w-full flex-col overflow-hidden rounded-lg border shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
        style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between border-b px-4 py-2.5"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="font-semibold" style={{ color: 'var(--text)' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

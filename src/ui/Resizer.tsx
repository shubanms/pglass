// A thin draggable divider between panels (Phase 15). Reports the pointer delta
// in px; the parent clamps it and writes the panel size to the store. Uses the
// same window-listener + pointer-capture pattern as the canvas gestures.
import { useCallback, useRef, useState } from 'react';

export function Resizer({
  orientation,
  onStart,
  onDelta,
  onCommit,
  'aria-label': ariaLabel,
}: {
  orientation: 'vertical' | 'horizontal';
  /** fired at pointer-down so the parent can capture the base size */
  onStart?: () => void;
  /** signed px delta since the drag started (right/down positive) */
  onDelta: (delta: number) => void;
  onCommit?: () => void;
  'aria-label'?: string;
}) {
  const [active, setActive] = useState(false);
  const start = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      start.current = orientation === 'vertical' ? e.clientX : e.clientY;
      setActive(true);
      onStart?.();
      const move = (ev: PointerEvent) => {
        const pos = orientation === 'vertical' ? ev.clientX : ev.clientY;
        onDelta(pos - start.current);
      };
      const up = () => {
        setActive(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
        onCommit?.();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      document.body.style.cursor = orientation === 'vertical' ? 'col-resize' : 'row-resize';
    },
    [orientation, onStart, onDelta, onCommit],
  );

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation={orientation}
      data-active={active}
      className={`pgl-resizer ${orientation === 'vertical' ? 'pgl-resizer-v' : 'pgl-resizer-h'}`}
      onPointerDown={onPointerDown}
      onDoubleClick={onCommit}
    />
  );
}

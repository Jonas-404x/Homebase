import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Einfaches modales Fenster: Esc oder Klick daneben schließt, Fokus landet im Fenster. */
export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Aktuelles onClose merken, damit der Effekt nur beim Öffnen läuft (sonst springt der Fokus bei jedem Rendern zurück).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div ref={ref} className={wide ? 'dialog dialog-wide' : 'dialog'} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>
        <div className="dialog-header">
          <h2 id={id}>{title}</h2>
          <button type="button" className="button icon-button" aria-label="Schließen" data-close onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

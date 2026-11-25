import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import type { PrefsPatch, SystemInfo } from '@mainframe/shared';
import { errorText } from '../../api/client.ts';
import { usePrefs } from '../../api/prefs.tsx';

export interface SettingsContextValue {
  /** Kurze Rückmeldung oben im Bereich („Gespeichert“) oder ein Fehler. */
  flash(text: string, ok?: boolean): void;
  info: SystemInfo | null;
  onLoggedOut(): void;
}

export const SettingsContext = createContext<SettingsContextValue>({ flash: () => {}, info: null, onLoggedOut: () => {} });
export const useSettings = () => useContext(SettingsContext);

/** Speichert eine Einstellung sofort und meldet „Gespeichert“. */
export function useSave() {
  const { update } = usePrefs();
  const { flash } = useSettings();
  return async (patch: PrefsPatch) => {
    try {
      await update(patch);
      flash('Gespeichert');
    } catch (err) {
      flash(errorText(err), false);
    }
  };
}

export const SERVER_ONLY = 'Nur auf dem Server';

/** Eine Zeile: Beschriftung (mit Hinweis) links, Bedienelement rechts. Auf dem Handy untereinander. */
export function Row({ label, hint, children, id, disabledReason, stacked }: { label: string; hint?: ReactNode; children?: ReactNode; id?: string; disabledReason?: string; stacked?: boolean }) {
  const cls = ['setting-row', disabledReason && 'setting-row-disabled', stacked && 'setting-row-stacked'].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <div className="setting-text">
        <label className="setting-label" htmlFor={id}>
          {label}
        </label>
        {hint && <div className="hint">{hint}</div>}
        {disabledReason && <span className="badge">{disabledReason}</span>}
      </div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

/** Gruppe von Zeilen mit Überschrift, wie eine Tabelle in den Systemeinstellungen. */
export function Group({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="setting-group">
      {title && <h3 className="setting-group-title">{title}</h3>}
      <div className="card setting-card">{children}</div>
      {footer && <p className="hint setting-footer">{footer}</p>}
    </section>
  );
}

/** Auswahl aus wenigen Möglichkeiten als segmentierte Schaltfläche (Radio-Gruppe). */
export function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const name = useId();
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={String(o.value)} className={o.value === value ? 'segment segment-on' : 'segment'}>
          <input type="radio" name={name} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Textfeld, das beim Verlassen oder mit Enter speichert. */
export function TextSetting({ id, value, onSave, maxLength }: { id: string; value: string; onSave: (v: string) => void; maxLength?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() && draft.trim() !== value) onSave(draft.trim());
    setDraft(null);
  };
  return (
    <input
      id={id}
      className="input"
      value={draft ?? value}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** Ein-/Aus-Schalter wie in iOS. */
export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className="switch" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span className="switch-knob" />
    </button>
  );
}

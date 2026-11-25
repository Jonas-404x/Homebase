import { AlertTriangle, ChevronRight, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import type { ReactNode } from 'react';
import { Sparkline, type ChartPoint } from './Sparkline.tsx';

export type StatStatus = 'ok' | 'warn' | 'danger';

/**
 * Eine Kennzahl. Die Karte hat beim Laden schon ihre endgültige Form (Ladebalken, Platzhalter),
 * damit beim Eintreffen der Werte nichts springt.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  load,
  meter = load !== undefined,
  chart,
  chartLabel,
  chartMax,
  chartWindowMs = 3_600_000,
  status = 'ok',
  loading = false,
  error,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value?: string | null;
  detail?: ReactNode;
  /** 0–100, füllt den Balken. */
  load?: number;
  /** Ob die Karte einen Balken hat (auch beim Laden, wenn `load` noch fehlt). */
  meter?: boolean;
  /** Verlauf; `undefined` = Karte ohne Kurve. */
  chart?: ChartPoint[];
  chartWindowMs?: number;
  chartLabel?: string;
  chartMax?: number;
  status?: StatStatus;
  loading?: boolean;
  /** Text statt Wert, wenn keine Daten kommen. */
  error?: string | null;
  /** Detailansicht; die ganze Karte wird klickbar. */
  href?: string;
}) {
  const busy = loading && !error;
  return (
    <div className={`card stat stat-${status}${href ? ' stat-clickable' : ''}`} data-testid="stat-card" aria-busy={busy ? 'true' : 'false'}>
      <div className="stat-head">
        <div className="stat-label">
          <Icon aria-hidden="true" size={18} />
          <span>{label}</span>
        </div>
        {href && (
          <Link to={href} className="stat-link" aria-label={`${label}: Details`}>
            <ChevronRight aria-hidden="true" size={18} />
          </Link>
        )}
        {!busy && status !== 'ok' && (
          <span className={`stat-flag stat-flag-${status}`}>
            <AlertTriangle aria-hidden="true" size={14} />
            {status === 'warn' ? 'Hoch' : 'Kritisch'}
          </span>
        )}
      </div>
      <div className="stat-value">
        {error ? <span className="stat-error">{error}</span> : busy ? <span className="skeleton skeleton-value" /> : <span className="fade-in">{value}</span>}
      </div>
      {meter && (
        <div className="meter" aria-hidden="true">
          {busy || error ? <div className={busy ? 'meter-indeterminate' : ''} /> : <div className={`meter-fill meter-${status}`} style={{ width: `${Math.min(100, load ?? 0)}%` }} />}
        </div>
      )}
      {chart !== undefined && (busy ? <div className="sparkline skeleton" aria-hidden="true" /> : <Sparkline points={chart} windowMs={chartWindowMs} max={chartMax} label={chartLabel ?? `${label}-Verlauf`} />)}
      <div className="stat-detail secondary">{busy ? <span className="skeleton skeleton-line" /> : (detail ?? ' ')}</div>
    </div>
  );
}

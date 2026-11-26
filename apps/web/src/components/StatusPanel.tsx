import { ChevronDown, CircleAlert, CircleCheck, Info, Stethoscope, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { InstalledApp, StatusItem, StatusReport } from '@mainframe/shared';
import { api } from '../api/client.ts';
import { DiagnoseDialog } from './DiagnoseDialog.tsx';

const POLL_MS = 15_000;

const ICON = { problem: CircleAlert, warn: TriangleAlert, info: Info } as const;
const LEVEL_TEXT = { problem: 'Problem', warn: 'Warnung', info: 'Hinweis' } as const;

/** Oben auf der Übersicht: läuft alles, und wo muss ich mich kümmern? */
export function StatusPanel({ apps, refreshKey = 0 }: { apps: InstalledApp[] | null; refreshKey?: number }) {
  const [report, setReport] = useState<StatusReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [diagnose, setDiagnose] = useState<{ target: string; title: string } | null>(null);
  const [showHints, setShowHints] = useState(false);

  // Nur die neueste Anfrage darf den Stand setzen; ältere, langsamere Antworten werden verworfen.
  const generation = useRef(0);
  const load = useCallback(async () => {
    const mine = ++generation.current;
    try {
      const next = await api<StatusReport>('/api/status');
      if (mine !== generation.current) return;
      setReport(next);
      setFailed(false);
    } catch {
      if (mine !== generation.current) return;
      // Keinen alten Stand stehen lassen: "Alles läuft" von vor Minuten wäre irreführend.
      setReport(null);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  const openDiagnose = (item: StatusItem) =>
    setDiagnose({
      target: item.diagnose!,
      title: item.diagnose === 'system' ? 'Diagnose: ganzes System' : `Diagnose: ${apps?.find((a) => a.id === item.diagnose)?.name ?? 'App'}`,
    });

  const level = report?.level ?? 'ok';
  // Hinweise (grau) brauchen nichts von dir: zugeklappt, damit die Werte darunter sichtbar bleiben.
  const important = report?.items.filter((i) => i.level !== 'info') ?? [];
  const hints = report?.items.filter((i) => i.level === 'info') ?? [];
  const shown = showHints ? [...important, ...hints] : important;
  const HeadIcon = level === 'ok' ? CircleCheck : level === 'warn' ? TriangleAlert : CircleAlert;

  return (
    <section className={`card status-panel status-${level}`} aria-labelledby="status-title" aria-busy={!report && !failed}>
      <div className="status-head">
        {report ? <HeadIcon className="status-head-icon" aria-hidden="true" size={24} /> : <span className="skeleton status-head-icon" />}
        <h2 id="status-title" className="status-summary">
          {report ? report.summary : failed ? 'Status gerade nicht abrufbar' : 'Prüft …'}
        </h2>
        <button type="button" className="button" onClick={() => setDiagnose({ target: 'system', title: 'Diagnose: ganzes System' })}>
          <Stethoscope aria-hidden="true" size={18} />
          Alles prüfen
        </button>
      </div>
      {shown.length > 0 && (
        <ul className="status-items">
          {shown.map((item) => {
            const Icon = ICON[item.level];
            return (
              <li key={item.id} className={`status-item status-item-${item.level}`}>
                <Icon className="status-item-icon" aria-label={LEVEL_TEXT[item.level]} size={18} />
                <div className="status-item-text">
                  <strong>{item.title}</strong>
                  <p className="secondary">{item.detail}</p>
                </div>
                <div className="status-item-actions">
                  {item.diagnose && item.level !== 'info' && (
                    <button type="button" className="button" onClick={() => openDiagnose(item)}>
                      Diagnose
                    </button>
                  )}
                  {item.to && (
                    <Link className="button" to={item.to}>
                      Ansehen
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {hints.length > 0 && (
        <button type="button" className="status-hints-toggle" aria-expanded={showHints} onClick={() => setShowHints((v) => !v)}>
          <ChevronDown aria-hidden="true" size={16} className={showHints ? 'chevron-open' : undefined} />
          {showHints ? 'Hinweise ausblenden' : hints.length === 1 ? '1 Hinweis' : `${hints.length} Hinweise`}
        </button>
      )}
      {diagnose && (
        <DiagnoseDialog
          target={diagnose.target}
          title={diagnose.title}
          onClose={() => {
            setDiagnose(null);
            void load();
          }}
        />
      )}
    </section>
  );
}

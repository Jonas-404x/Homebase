import { CircleCheck, CircleMinus, CircleX, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { DiagnoseAction, DiagnoseReport, DiagnoseStep } from '@mainframe/shared';
import { errorText, post } from '../api/client.ts';
import { Dialog } from './Dialog.tsx';

function StepIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) return <CircleCheck className="diag-icon diag-ok" aria-label="In Ordnung" size={20} />;
  if (ok === false) return <CircleX className="diag-icon diag-bad" aria-label="Problem" size={20} />;
  return <CircleMinus className="diag-icon diag-skip" aria-label="Übersprungen" size={20} />;
}

/**
 * Führt eine Diagnose aus und zeigt jeden Schritt mit Ergebnis, Erklärung und – wenn möglich – einem Knopf zum Beheben.
 * target: App-ID oder "system".
 */
export function DiagnoseDialog({ target, title, onClose }: { target: string; title: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [report, setReport] = useState<DiagnoseReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(true);
  const [acting, setActing] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    setError(null);
    try {
      setReport(await post<DiagnoseReport>(target === 'system' ? '/api/diagnose' : `/api/apps/${encodeURIComponent(target)}/diagnose`));
    } catch (err) {
      setError(errorText(err));
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }, [target]);

  useEffect(() => void run(), [run]);

  async function act(action: DiagnoseAction) {
    if (action.kind === 'link') {
      onClose();
      navigate(action.to);
      return;
    }
    setActing(true);
    setError(null);
    try {
      await post(`/api/apps/${encodeURIComponent(action.appId)}/restart`);
      await run();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setActing(false);
    }
  }

  const problems = report?.steps.filter((s) => s.ok === false).length ?? 0;
  const busy = running || acting;
  // Denselben Knopf (z. B. "Neu starten") nur beim ersten Schritt zeigen, der ihn anbietet.
  const seen = new Set<string>();
  const actionOf = (s: DiagnoseStep) => {
    if (!s.action || s.ok !== false) return null;
    const key = JSON.stringify(s.action);
    if (seen.has(key)) return null;
    seen.add(key);
    return s.action;
  };

  return (
    <Dialog title={title} onClose={onClose} wide>
      <div className="stack">
        <p className="diag-summary" role="status" aria-live="polite">
          {running ? (
            <>
              <LoaderCircle className="spin" aria-hidden="true" size={18} />
              {acting ? 'Startet neu und prüft …' : 'Prüft …'}
            </>
          ) : report ? (
            problems === 0 ? (
              'Alles in Ordnung.'
            ) : problems === 1 ? (
              '1 Problem gefunden.'
            ) : (
              `${problems} Probleme gefunden.`
            )
          ) : null}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {report && (
          <ol className="diag-steps" aria-busy={running}>
            {report.steps.map((s) => {
              const action = actionOf(s);
              return (
                <li key={s.id} className={s.ok === false ? 'diag-step diag-step-bad' : 'diag-step'}>
                  <StepIcon ok={s.ok} />
                  <div className="diag-text">
                    <strong>{s.label}</strong>
                    <p className="secondary">{s.detail}</p>
                    {s.fix && <p>{s.fix}</p>}
                    {action && (
                      <button type="button" className="button" disabled={busy} onClick={() => void act(action)}>
                        {action.kind === 'restart-app' ? 'Neu starten' : action.label}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" disabled={acting} onClick={() => void run()}>
            Noch mal prüfen
          </button>
          <button type="button" className="button button-primary" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </Dialog>
  );
}

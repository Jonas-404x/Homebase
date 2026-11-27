import { AlertCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AiSettingsView } from '@mainframe/shared';
import { api, errorText, post } from '../../api/client.ts';
import { Group, Row, Switch, TextSetting, useSettings } from './Row.tsx';

const KEY_URL = 'https://aistudio.google.com/apikey';

function timeText(at: number | null): string | null {
  if (at === null) return null;
  return new Date(at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Einstellungen → KI. Der Schlüssel geht nur hinein: Der Server meldet nur „gesetzt“ oder „nicht gesetzt“,
 * und das Eingabefeld wird nach dem Speichern sofort geleert.
 */
export function AiPane() {
  const { flash } = useSettings();
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);

  const load = useCallback(() => {
    api<AiSettingsView>('/api/ai/settings')
      .then((v) => {
        setView(v);
        setError(null);
      })
      .catch((err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  async function patch(body: Partial<Pick<AiSettingsView, 'model' | 'sendLogs' | 'dailyLimit'>> & { enabled?: boolean }) {
    try {
      setView(await api<AiSettingsView>('/api/ai/settings', { method: 'PATCH', body: JSON.stringify(body) }));
      flash('Gespeichert');
    } catch (err) {
      flash(errorText(err), false);
    }
  }

  async function saveKey() {
    const key = keyDraft.trim();
    if (!key) return;
    setBusy(true);
    try {
      await api('/api/ai/key', { method: 'PUT', body: JSON.stringify({ key }) });
      flash('Schlüssel gespeichert');
      load();
    } catch (err) {
      flash(errorText(err), false);
    } finally {
      // Auch bei einem Fehler nicht stehen lassen: der Schlüssel soll nicht im Feld herumliegen.
      setKeyDraft('');
      setBusy(false);
    }
  }

  async function removeKey() {
    setBusy(true);
    try {
      await api('/api/ai/key', { method: 'DELETE' });
      flash('Schlüssel entfernt');
      setTest(null);
      load();
    } catch (err) {
      flash(errorText(err), false);
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setTest(null);
    try {
      setTest(await post<{ ok: boolean; message: string }>('/api/ai/test'));
      load();
    } catch (err) {
      setTest({ ok: false, message: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="notice" role="alert">
        <AlertCircle aria-hidden="true" size={20} />
        <p>{error}</p>
      </div>
    );
  }
  if (!view) return <span className="skeleton skeleton-line" />;

  const switchedOn = view.enabledSetting ?? true;
  const unlimited = view.dailyLimit === null;
  const lastOk = timeText(view.lastOkAt);
  const lastErr = timeText(view.lastErrorAt);

  return (
    <div className="stack-l">
      <Group
        title="Schlüssel"
        footer={
          <>
            Einen kostenlosen Schlüssel bekommst du bei{' '}
            <a href={KEY_URL} target="_blank" rel="noreferrer">
              Google AI Studio
            </a>
            . Dort mit deinem Google-Konto anmelden und „API-Schlüssel erstellen“ wählen. Wichtig: kein Rechnungskonto verknüpfen, dann bleibt es kostenlos.
          </>
        }
      >
        {view.hasKey ? (
          <Row label="API-Schlüssel" hint="Schlüssel ist gesetzt">
            <button type="button" className="button" disabled={busy} onClick={() => void removeKey()}>
              Schlüssel entfernen
            </button>
          </Row>
        ) : (
          <Row label="API-Schlüssel" id="ai-key" hint="Bleibt nur auf deinem Server und wird nie wieder angezeigt." stacked>
            <form
              className="inline-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveKey();
              }}
            >
              <input
                id="ai-key"
                className="input mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
              />
              <button type="submit" className="button button-primary" disabled={busy || !keyDraft.trim()}>
                Schlüssel speichern
              </button>
            </form>
          </Row>
        )}
      </Group>

      <Group title="Hinweise">
        <Row label="KI-Hinweise" hint={view.hasKey ? 'Die KI schreibt Texte in der Statusübersicht. Ohne sie gelten die festen Texte.' : 'Geht erst mit einem Schlüssel.'}>
          <Switch label="KI-Hinweise" checked={view.hasKey && switchedOn} onChange={(v) => void patch({ enabled: v })} />
        </Row>
        <Row label="Logzeilen mitschicken" hint="Damit die KI vermuten kann, warum eine App abstürzt. IPs, Gerätenamen und Schlüssel werden vorher entfernt.">
          <Switch label="Logzeilen mitschicken" checked={view.sendLogs} onChange={(v) => void patch({ sendLogs: v })} />
        </Row>
        <Row label="Modell" id="ai-model" hint="Nur ändern, wenn Google das Modell umbenennt.">
          <TextSetting id="ai-model" value={view.model} maxLength={80} onSave={(v) => void patch({ model: v })} />
        </Row>
      </Group>

      <Group title="Anfragen" footer={unlimited ? 'Nur sicher, solange dein Google-Projekt kein Rechnungskonto hat.' : undefined}>
        <Row label="Ohne Grenze" hint={unlimited ? `Heute: ${view.usedToday} Anfragen` : `Heute: ${view.usedToday} von ${view.dailyLimit} Anfragen`}>
          <Switch label="Ohne Grenze" checked={unlimited} onChange={(v) => void patch({ dailyLimit: v ? null : 50 })} />
        </Row>
        {!unlimited && (
          <Row label="Höchstens pro Tag" id="ai-limit">
            <TextSetting
              id="ai-limit"
              value={String(view.dailyLimit)}
              maxLength={4}
              onSave={(v) => {
                const n = Number(v);
                if (Number.isInteger(n) && n >= 1 && n <= 1000) void patch({ dailyLimit: n });
                else flash('Bitte eine Zahl von 1 bis 1000.', false);
              }}
            />
          </Row>
        )}
      </Group>

      <Group>
        <Row label="Verbindung" hint={view.lastError ? `Zuletzt: ${view.lastError}${lastErr ? ` (${lastErr})` : ''}` : lastOk ? `Letzte Antwort: ${lastOk}` : 'Noch keine Antwort.'}>
          <button type="button" className="button" disabled={busy || !view.hasKey} onClick={() => void runTest()}>
            Jetzt testen
          </button>
        </Row>
        {test && (
          <p className={test.ok ? 'hint test-result' : 'hint test-result test-result-error'} role="status">
            {test.message}
          </p>
        )}
      </Group>
    </div>
  );
}

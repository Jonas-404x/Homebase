import { CheckCircle2, Laptop, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { defaultPrefs } from '@mainframe/shared';
import { api, errorText, post } from '../../api/client.ts';
import { usePrefs } from '../../api/prefs.tsx';
import { dateTime } from '../../format.ts';
import { ConfirmWithPassword } from './ConfirmWithPassword.tsx';
import { Choice, Group, Row, useSave, useSettings } from './Row.tsx';

interface Device {
  id: string;
  device: string;
  ip: string;
  createdAt: number;
  lastSeen: number;
  current: boolean;
}
interface LogEntry {
  at: number;
  ok: boolean;
  username: string;
  ip: string;
  device: string;
}

function PasswordForm() {
  const { flash } = useSettings();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/api/auth/password', { current, next });
      setCurrent('');
      setNext('');
      flash('Passwort geändert. Andere Geräte wurden abgemeldet.');
    } catch (err) {
      flash(errorText(err), false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="setting-form" onSubmit={submit}>
      <label className="field">
        <span>Aktuelles Passwort</span>
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label className="field">
        <span>Neues Passwort</span>
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
      </label>
      <div>
        <button className="button" type="submit" disabled={busy || !current || !next}>
          Passwort ändern
        </button>
      </div>
    </form>
  );
}

export function Account() {
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const save = useSave();
  const { flash, onLoggedOut } = useSettings();
  const [username, setUsername] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [log, setLog] = useState<LogEntry[] | null>(null);

  const load = useCallback(() => {
    api<{ username?: string }>('/api/auth/state')
      .then((s) => setUsername(s.username ?? null))
      .catch(() => {});
    api<Device[]>('/api/auth/sessions')
      .then(setDevices)
      .catch(() => setDevices([]));
    api<LogEntry[]>('/api/auth/login-log')
      .then(setLog)
      .catch(() => setLog([]));
  }, []);
  useEffect(load, [load]);

  async function revoke(d: Device) {
    try {
      await api(`/api/auth/sessions/${d.id}`, { method: 'DELETE' });
      if (d.current) return onLoggedOut();
      flash(`${d.device} abgemeldet`);
      load();
    } catch (err) {
      flash(errorText(err), false);
    }
  }

  async function revokeOthers() {
    try {
      await post('/api/auth/sessions/others/logout');
      flash('Alle anderen Geräte abgemeldet');
      load();
    } catch (err) {
      flash(errorText(err), false);
    }
  }

  async function logout() {
    await post('/api/auth/logout').catch(() => {});
    onLoggedOut();
  }

  const others = (devices ?? []).filter((d) => !d.current).length;

  return (
    <div className="stack-l">
      <Group title="Anmeldung">
        <Row label="Benutzername" id="set-username" hint="Zum Ändern brauchst du dein Passwort.">
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (draftName?.trim() && draftName.trim() !== username) setRenaming(true);
            }}
          >
            <input id="set-username" className="input" value={draftName ?? username ?? ''} autoComplete="username" onChange={(e) => setDraftName(e.target.value)} />
            <button type="submit" className="button" disabled={!draftName?.trim() || draftName.trim() === username}>
              Ändern …
            </button>
          </form>
        </Row>
        <Row label="Passwort ändern" hint="Danach werden alle anderen Geräte abgemeldet." />
        <PasswordForm />
        <Row label="Angemeldet bleiben" hint="Gilt für neue Anmeldungen mit „Angemeldet bleiben“.">
          <Choice
            label="Angemeldet bleiben"
            value={prefs.sessionDays}
            options={[{ value: 7, label: '7 Tage' }, { value: 30, label: '30 Tage' }, { value: 90, label: '90 Tage' }]}
            onChange={(v) => void save({ sessionDays: v })}
          />
        </Row>
      </Group>

      <Group title="Angemeldete Geräte">
        {devices === null ? (
          <div className="setting-row">
            <span className="skeleton skeleton-line" />
          </div>
        ) : (
          <ul className="device-list">
            {devices.map((d) => (
              <li key={d.id} className="setting-row">
                <span className="device">
                  <Laptop aria-hidden="true" size={18} />
                  <span>
                    <span className="setting-label">{d.device}</span>
                    {d.current && <span className="badge badge-ok">Dieses Gerät</span>}
                    <span className="hint device-meta">
                      {d.ip} · zuletzt {dateTime(d.lastSeen, prefs.timeZone)}
                    </span>
                  </span>
                </span>
                <button type="button" className="button" onClick={() => void revoke(d)} aria-label={`Abmelden: ${d.device}`}>
                  Abmelden
                </button>
              </li>
            ))}
          </ul>
        )}
        {others > 0 && (
          <div className="setting-row">
            <span className="hint">{others === 1 ? '1 weiteres Gerät' : `${others} weitere Geräte`}</span>
            <button type="button" className="button" onClick={() => void revokeOthers()}>
              Alle anderen abmelden
            </button>
          </div>
        )}
      </Group>

      <Group title="Anmelde-Protokoll" footer="Die letzten 50 Versuche. Fehlversuche von fremden Adressen sind ein Grund, das Passwort zu ändern.">
        {log === null ? (
          <div className="setting-row">
            <span className="skeleton skeleton-line" />
          </div>
        ) : log.length === 0 ? (
          <div className="setting-row hint">Noch keine Anmeldungen.</div>
        ) : (
          <ul className="login-log">
            {log.map((e, i) => (
              <li key={i} className="setting-row">
                <span className="device">
                  {e.ok ? <CheckCircle2 className="success" aria-hidden="true" size={18} /> : <XCircle className="error" aria-hidden="true" size={18} />}
                  <span>
                    <span className="setting-label">{e.ok ? 'Angemeldet' : 'Fehlgeschlagen'}</span>
                    <span className="hint device-meta">
                      {e.device} · {e.ip}
                      {e.username ? ` · „${e.username}“` : ''}
                    </span>
                  </span>
                </span>
                <span className="hint">{dateTime(e.at, prefs.timeZone)}</span>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group>
        <Row label="Auf diesem Gerät abmelden">
          <button type="button" className="button" onClick={() => void logout()}>
            Hier abmelden
          </button>
        </Row>
      </Group>

      {renaming && (
        <ConfirmWithPassword
          title="Benutzername ändern"
          confirmLabel="Ändern"
          onClose={() => setRenaming(false)}
          onConfirm={async (password) => {
            const name = (draftName ?? '').trim();
            await post('/api/auth/username', { password, username: name });
            setUsername(name);
            setDraftName(null);
            flash('Gespeichert');
          }}
        >
          Neuer Benutzername: „{(draftName ?? '').trim()}“. Melde dich künftig damit an.
        </ConfirmWithPassword>
      )}
    </div>
  );
}

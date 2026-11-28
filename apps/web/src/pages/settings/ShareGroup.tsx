import { useEffect, useState, type FormEvent } from 'react';
import type { ShareStatus } from '@mainframe/shared';
import { api, errorText, post } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { size } from '../../format.ts';
import { ConfirmWithPassword } from './ConfirmWithPassword.tsx';
import { Group, Row, SERVER_ONLY } from './Row.tsx';

const mapCommand = (s: ShareStatus) => `net use M: ${s.unc} /user:${s.user} /persistent:yes`;

/** Assistent: Erklärung und Passwort, danach der Befehl für den PC. Auch zum Ändern des Passworts. */
function ShareWizard({ change, onDone, onClose }: { change: boolean; onDone: (s: ShareStatus) => void; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ShareStatus | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);
  const ready = pw.length >= 8 && pw === again;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const s = await post<ShareStatus>('/api/share/enable', { password: pw });
      // Das Passwort nicht länger als nötig im Speicher halten.
      setPw('');
      setAgain('');
      setDone(s);
      onDone(s);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Ohne https gibt es oft keine Zwischenablage.
      setCopied(false);
    }
  }

  if (done) {
    return (
      <Dialog title={change ? 'Passwort geändert' : 'Freigabe ist an'} onClose={onClose}>
        <div className="stack">
          <p className="secondary">Am PC in der Eingabeaufforderung eingeben. Windows fragt dann nach dem Passwort.</p>
          {done.unc && <code className="mono monitor-link">{mapCommand(done)}</code>}
          <p className="hint">Oder im Explorer: Dieser PC › Netzlaufwerk verbinden › {done.unc ?? 'Adresse des Servers'}, Benutzer {done.user}.</p>
          {copied === false && (
            <p className="hint" role="status">
              Kopieren geht hier nicht. Bitte den Befehl abschreiben.
            </p>
          )}
          <div className="dialog-actions">
            {done.unc && (
              <button type="button" className="button" onClick={() => void copy(mapCommand(done))}>
                {copied ? 'Kopiert' : 'Befehl kopieren'}
              </button>
            )}
            <button type="button" className="button button-primary" onClick={onClose}>
              Fertig
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={change ? 'Passwort der Freigabe ändern' : 'Netzwerkfreigabe einrichten'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {!change && (
          <p className="secondary">Im Heimnetz wird nur der Ordner /mnt/hdd/Mainframe sichtbar. Alles andere auf der Festplatte bleibt privat.</p>
        )}
        <label className="field">
          <span>Freigabe-Passwort</span>
          <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="field">
          <span>Wiederholen</span>
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        <p className="hint">Mindestens 8 Zeichen. Nur für das Laufwerk, nicht dein Mainframe-Passwort.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Abbrechen
          </button>
          <button type="submit" className="button button-primary" disabled={!ready || busy}>
            {change ? 'Ändern' : 'Einschalten'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Bereich „Netzwerkfreigabe“ unter Einstellungen › Netzwerk. */
export function ShareGroup() {
  const [s, setS] = useState<ShareStatus | null>(null);
  const [twoFactor, setTwoFactor] = useState(false);
  const [wizard, setWizard] = useState<'new' | 'change' | null>(null);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    api<ShareStatus>('/api/share')
      .then(setS)
      .catch(() => {});
    api<{ enabled: boolean }>('/api/auth/2fa')
      .then((r) => setTwoFactor(r.enabled))
      .catch(() => {});
  }, []);

  const label = 'Netzwerkfreigabe';
  const intro = 'Der Ordner Mainframe auf der Festplatte als Laufwerk im Windows-Explorer. Deine Backups bleiben unsichtbar.';
  let body;
  if (!s) {
    body = <Row label={label} hint="…" />;
  } else if (!s.available) {
    body = <Row label={label} hint={intro} disabledReason={s.reason === 'samba_missing' ? 'Samba fehlt – Setup-Skript ausführen' : SERVER_ONLY} />;
  } else if (!s.enabled) {
    body = (
      <Row label={label} hint={s.diskMounted ? intro : 'Die Festplatte ist nicht angeschlossen.'}>
        <button type="button" className="button" disabled={!s.diskMounted} onClick={() => setWizard('new')}>
          Einrichten…
        </button>
      </Row>
    );
  } else {
    body = (
      <>
        <Row label="Status" hint={s.diskMounted ? 'An' : 'An, aber die Festplatte ist nicht angeschlossen.'} />
        <Row label="Adresse" hint={<span className="mono">{s.unc ?? '…'}</span>} />
        {s.freeBytes !== null && s.totalBytes !== null && <Row label="Frei" hint={`${size(s.freeBytes)} von ${size(s.totalBytes)}`} />}
        <Row label="Passwort" hint={`Benutzer ${s.user}`}>
          <button type="button" className="button" onClick={() => setWizard('change')}>
            Passwort ändern…
          </button>
        </Row>
        <Row label="Ausschalten" hint="Nur mit deinem Mainframe-Passwort.">
          <button type="button" className="button button-destructive" onClick={() => setDisabling(true)}>
            Ausschalten…
          </button>
        </Row>
      </>
    );
  }

  return (
    <Group title={label} footer={s?.enabled ? 'Nur aus dem Heimnetz erreichbar, mit Benutzer und Passwort.' : undefined}>
      {body}
      {wizard && <ShareWizard change={wizard === 'change'} onDone={setS} onClose={() => setWizard(null)} />}
      {disabling && (
        <ConfirmWithPassword
          title="Netzwerkfreigabe ausschalten?"
          confirmLabel="Ausschalten"
          destructive
          withCode={twoFactor}
          onClose={() => setDisabling(false)}
          onConfirm={async (password, code) => {
            setS(await post<ShareStatus>('/api/share/disable', twoFactor ? { password, code } : { password }));
          }}
        >
          Der PC verliert das Laufwerk. Die Dateien bleiben auf der Festplatte.
        </ConfirmWithPassword>
      )}
    </Group>
  );
}

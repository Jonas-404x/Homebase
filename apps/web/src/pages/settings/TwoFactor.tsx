import QRCode from 'qrcode';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText, post } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';
import { Group, Row, useSettings } from './Row.tsx';

type Step = { at: 'password' } | { at: 'scan'; secret: string; uri: string } | { at: 'codes'; codes: string[] };

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

/** Einrichtung in drei Schritten: Passwort, QR-Code scannen und Code bestätigen, Wiederherstellungs-Codes sichern. */
function SetupDialog({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const [step, setStep] = useState<Step>({ at: 'password' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const uri = step.at === 'scan' ? step.uri : null;
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => alive && setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [uri]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const start = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await post<{ secret: string; uri: string }>('/api/auth/2fa/setup', { password });
      setPassword('');
      setStep({ at: 'scan', ...r });
    });
  };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await post<{ recoveryCodes: string[] }>('/api/auth/2fa/enable', { code: code.trim() });
      setStep({ at: 'codes', codes: r.recoveryCodes });
    });
  };
  const copy = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setError('Kopieren ging nicht. Schreib die Codes bitte ab.');
    }
  };

  if (step.at === 'codes')
    return (
      <Dialog title="Wiederherstellungs-Codes" onClose={onEnabled}>
        <div className="stack">
          <p>Die Zwei-Faktor-Anmeldung ist an. Heb diese Codes gut auf, zum Beispiel ausgedruckt oder im Passwort-Manager. Jeder Code klappt genau einmal, falls dein Handy weg ist.</p>
          <ul className="recovery-codes mono">
            {step.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="hint">Die Codes werden nur jetzt angezeigt.</p>
          <ErrorLine error={error} />
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => void copy(step.codes)}>
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
            <button type="button" className="button button-primary" onClick={onEnabled}>
              Fertig
            </button>
          </div>
        </div>
      </Dialog>
    );

  return (
    <Dialog title="Zwei-Faktor-Anmeldung einrichten" onClose={busy ? () => {} : onClose}>
      {step.at === 'password' ? (
        <form className="stack" onSubmit={start}>
          <p>Du brauchst eine Authenticator-App auf dem Handy, zum Beispiel die Passwörter-App vom iPhone, Google Authenticator oder 2FAS.</p>
          <label className="field">
            <span>Passwort</span>
            <input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <ErrorLine error={error} />
          <div className="dialog-actions">
            <button type="submit" className="button button-primary" disabled={busy || !password}>
              {busy ? 'Prüft …' : 'Weiter'}
            </button>
          </div>
        </form>
      ) : (
        <form className="stack" onSubmit={confirm}>
          <p>Scanne den QR-Code mit deiner Authenticator-App. Klappt das nicht, gib den Schlüssel von Hand ein.</p>
          <div className="qr-row">
            {qr ? <img className="qr" src={qr} alt="QR-Code für die Authenticator-App" width={148} height={148} /> : <div className="qr skeleton" aria-hidden="true" />}
            <code className="mono totp-secret">{step.secret}</code>
          </div>
          <label className="field">
            <span>Code aus der App</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} disabled={busy} onChange={(e) => setCode(e.target.value)} autoFocus />
          </label>
          <ErrorLine error={error} />
          <div className="dialog-actions">
            <button type="submit" className="button button-primary" disabled={busy || code.trim().length < 6}>
              {busy ? 'Schaltet ein …' : 'Einschalten'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function DisableDialog({ onClose, onDisabled }: { onClose: () => void; onDisabled: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/2fa/disable', { password, code: code.trim() });
      onDisabled();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title="Zwei-Faktor-Anmeldung ausschalten" onClose={busy ? () => {} : onClose}>
      <form className="stack" onSubmit={submit}>
        <p>Danach reicht wieder das Passwort allein zum Anmelden.</p>
        <fieldset className="stack" disabled={busy}>
          <label className="field">
            <span>Passwort</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Code aus der App</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={9} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
        </fieldset>
        <ErrorLine error={error} />
        <div className="dialog-actions">
          <button type="submit" className="button button-danger" disabled={busy || !password || code.trim().length < 6}>
            {busy ? 'Schaltet aus …' : 'Ausschalten'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function TwoFactor() {
  const { flash } = useSettings();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [dialog, setDialog] = useState<'setup' | 'disable' | null>(null);

  useEffect(() => {
    api<{ enabled: boolean }>('/api/auth/2fa')
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false));
  }, []);

  return (
    <Group title="Zwei-Faktor-Anmeldung" footer="Beim Anmelden fragt Mainframe dann zusätzlich nach einem Code aus der Authenticator-App. Wer nur dein Passwort kennt, kommt nicht rein.">
      <Row
        label="Zwei-Faktor-Anmeldung"
        hint={
          enabled === null ? (
            '…'
          ) : enabled ? (
            <span className="badge badge-ok">
              <ShieldCheck aria-hidden="true" size={14} />
              Eingeschaltet
            </span>
          ) : (
            'Aus'
          )
        }
      >
        {enabled !== null && (
          <button type="button" className="button" onClick={() => setDialog(enabled ? 'disable' : 'setup')}>
            {enabled ? 'Ausschalten …' : 'Einrichten …'}
          </button>
        )}
      </Row>
      {dialog === 'setup' && (
        <SetupDialog
          onClose={() => setDialog(null)}
          onEnabled={() => {
            setDialog(null);
            setEnabled(true);
            flash('Zwei-Faktor-Anmeldung eingeschaltet');
          }}
        />
      )}
      {dialog === 'disable' && (
        <DisableDialog
          onClose={() => setDialog(null)}
          onDisabled={() => {
            setDialog(null);
            setEnabled(false);
            flash('Zwei-Faktor-Anmeldung ausgeschaltet');
          }}
        />
      )}
    </Group>
  );
}

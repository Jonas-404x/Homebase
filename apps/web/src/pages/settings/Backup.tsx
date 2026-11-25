import { Download, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, post } from '../../api/client.ts';
import { ConfirmWithPassword } from './ConfirmWithPassword.tsx';
import { Group, Row, useSettings } from './Row.tsx';

export function Backup() {
  const { flash, onLoggedOut } = useSettings();
  const file = useRef<HTMLInputElement>(null);
  const [importData, setImportData] = useState<{ name: string; data: unknown } | null>(null);
  const [reset, setReset] = useState(false);
  const [twoFactor, setTwoFactor] = useState(false);
  useEffect(() => {
    api<{ enabled: boolean }>('/api/auth/2fa')
      .then((r) => setTwoFactor(r.enabled))
      .catch(() => {});
  }, []);

  async function pick(f: File | undefined) {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || typeof data !== 'object' || !('prefs' in data)) throw new Error();
      setImportData({ name: f.name, data });
    } catch {
      flash('Das ist keine Mainframe-Sicherung.', false);
    } finally {
      if (file.current) file.current.value = '';
    }
  }

  return (
    <div className="stack-l">
      <Group footer="Enthält Einstellungen und Benutzername, aber keine Passwörter. Apps und ihre Daten sichert das automatische Backup (kommt später).">
        <Row label="Einstellungen exportieren" hint="Als Datei herunterladen.">
          <a className="button" href="/api/system/export" download="mainframe-einstellungen.json">
            <Download aria-hidden="true" size={16} />
            Herunterladen
          </a>
        </Row>
        <Row label="Einstellungen importieren" hint="Eine exportierte Datei wieder einspielen.">
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void pick(e.target.files?.[0])} aria-label="Sicherungsdatei" />
          <button type="button" className="button" onClick={() => file.current?.click()}>
            <Upload aria-hidden="true" size={16} />
            Datei wählen …
          </button>
        </Row>
      </Group>

      <Group title="Gefahrenzone" footer="Löscht Benutzername, Passwort, alle Einstellungen, Anmeldungen und das Protokoll. Installierte Apps bleiben. Danach richtest du Mainframe neu ein.">
        <Row label="Zurücksetzen">
          <button type="button" className="button button-destructive" onClick={() => setReset(true)}>
            Zurücksetzen …
          </button>
        </Row>
      </Group>

      {importData && (
        <ConfirmWithPassword
          title="Einstellungen importieren"
          confirmLabel="Importieren"
          onClose={() => setImportData(null)}
          onConfirm={async (password) => {
            await post('/api/system/import', { password, data: importData.data });
            flash('Importiert');
          }}
        >
          Die Einstellungen aus „{importData.name}“ ersetzen die jetzigen.
        </ConfirmWithPassword>
      )}
      {reset && (
        <ConfirmWithPassword
          title="Mainframe zurücksetzen?"
          confirmLabel="Endgültig zurücksetzen"
          destructive
          withCode={twoFactor}
          onClose={() => setReset(false)}
          onConfirm={async (password, code) => {
            await post('/api/system/reset', twoFactor ? { password, code } : { password });
            onLoggedOut();
          }}
        >
          Das lässt sich nicht rückgängig machen. Alle Geräte werden abgemeldet, und du richtest Mainframe neu ein. Installierte Apps bleiben.
        </ConfirmWithPassword>
      )}
    </div>
  );
}

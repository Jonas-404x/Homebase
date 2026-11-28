import { useState, type FormEvent } from 'react';
import type { MinecraftInfo } from '@mainframe/shared';
import { api, errorText } from '../../api/client.ts';
import { Dialog } from '../Dialog.tsx';
import { MemoryField, PerfModsField, TypePicker, VersionField, type ServerType } from './fields.tsx';

/** Typ, Version, RAM und Spar-Mods ändern. Die Welt bleibt, der Container wird neu erzeugt. */
export function SettingsDialog({ info, onClose, onSaved }: { info: MinecraftInfo; onClose: () => void; onSaved: () => void }) {
  const [serverType, setServerType] = useState<ServerType>(info.serverType);
  const [version, setVersion] = useState(info.version);
  const [memory, setMemory] = useState(info.memory);
  const [perfMods, setPerfMods] = useState(info.perfMods);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeChanged = serverType !== info.serverType;
  const versionChanged = version !== info.version;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/minecraft/settings', {
        method: 'PUT',
        body: JSON.stringify({ serverType, version, memory, perfMods: serverType === 'FABRIC' && perfMods }),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title="Server-Einstellungen" onClose={busy ? () => {} : onClose}>
      <form className="stack" onSubmit={submit}>
        <fieldset className="stack" disabled={busy}>
          <TypePicker value={serverType} onChange={setServerType} />
          <div className="mc-row">
            <VersionField value={version} onChange={setVersion} minVersion={info.version} />
            <MemoryField value={memory} onChange={setMemory} />
          </div>
          {serverType === 'FABRIC' && <PerfModsField checked={perfMods} onChange={setPerfMods} />}
        </fieldset>
        {(typeChanged || versionChanged) && (
          <div className="notice notice-warn">
            <p className="small">
              Deine Welt bleibt erhalten. Eigene {serverType === 'PAPER' ? 'Plugins' : 'Mods'} müssen aber zur neuen
              {typeChanged ? ' Server-Art' : ' Version'} passen, sonst startet der Server nicht.
              {typeChanged && info.serverType === 'PAPER' && ' Nether und End legt Paper in eigenen Ordnern ab: mit Fabric fangen die beiden neu an.'}
            </p>
          </div>
        )}
        {busy && (
          <p className="secondary" role="status">
            Wird übernommen … der Server startet dafür neu.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            Speichern
          </button>
        </div>
      </form>
    </Dialog>
  );
}

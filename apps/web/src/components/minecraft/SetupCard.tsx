import { useState, type FormEvent } from 'react';
import { errorText, post } from '../../api/client.ts';
import { DEFAULT_VERSION, MemoryField, PerfModsField, TypePicker, VersionField, type ServerType } from './fields.tsx';

/** Erstes Einrichten: Typ, Version, RAM, Spar-Mods und die EULA (die hakt Jonas selbst an). */
export function SetupCard({ onDone }: { onDone: () => void }) {
  const [serverType, setServerType] = useState<ServerType>('FABRIC');
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [memory, setMemory] = useState('4G');
  const [perfMods, setPerfMods] = useState(true);
  const [eula, setEula] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/apps/minecraft/install', { values: { serverType, version, memory, perfMods: serverType === 'FABRIC' && perfMods, eula } });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack mc-setup" onSubmit={submit}>
      <div>
        <h2>Server einrichten</h2>
        <p className="secondary">Ein Java-Server auf deinem Mainframe. Alles hier kannst du später noch ändern.</p>
      </div>
      <fieldset className="stack" disabled={busy}>
        <TypePicker value={serverType} onChange={setServerType} />
        <div className="mc-row">
          <VersionField value={version} onChange={setVersion} />
          <MemoryField value={memory} onChange={setMemory} />
        </div>
        {serverType === 'FABRIC' && <PerfModsField checked={perfMods} onChange={setPerfMods} />}
        <label className="check">
          <input type="checkbox" checked={eula} onChange={(e) => setEula(e.target.checked)} />
          <span>
            Ich akzeptiere die{' '}
            <a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer">
              Minecraft-EULA
            </a>
          </span>
        </label>
      </fieldset>
      {busy && (
        <p className="secondary" role="status">
          Lädt Minecraft herunter … das dauert beim ersten Mal ein paar Minuten.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="button button-primary" disabled={!eula || busy}>
          Server einrichten
        </button>
      </div>
    </form>
  );
}

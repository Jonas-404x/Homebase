import { RotateCw, Trash2, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { MinecraftMod } from '@mainframe/shared';
import { api, errorText } from '../../api/client.ts';
import { size } from '../../format.ts';

/** Eigene .jar-Dateien: reinziehen oder auswählen, Liste mit Löschen. Aktiv nach einem Neustart. */
export function ModsCard({ modDir, onRestart }: { modDir: 'mods' | 'plugins'; onRestart: () => Promise<void> }) {
  const [mods, setMods] = useState<MinecraftMod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const noun = modDir === 'plugins' ? 'Plugins' : 'Mods';

  const reload = useCallback(async () => {
    try {
      setMods(await api<MinecraftMod[]>('/api/minecraft/mods'));
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => void reload(), [reload, modDir]);

  async function upload(files: File[]) {
    setError(null);
    const jars = files.filter((f) => f.name.toLowerCase().endsWith('.jar'));
    if (jars.length < files.length) setError('Nur .jar-Dateien gehen hier rein.');
    for (const f of jars) {
      setUploading(f.name);
      try {
        await api(`/api/minecraft/mods/${encodeURIComponent(f.name)}`, { method: 'PUT', body: f, headers: { 'content-type': 'application/octet-stream' } });
        setChanged(true);
      } catch (err) {
        setError(`${f.name}: ${errorText(err)}`);
      }
    }
    setUploading(null);
    await reload();
  }

  async function remove(name: string) {
    setError(null);
    try {
      await api(`/api/minecraft/mods/${encodeURIComponent(name)}`, { method: 'DELETE' });
      setChanged(true);
      setMods((m) => m?.filter((x) => x.name !== name) ?? null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void upload([...(e.dataTransfer?.files ?? [])]);
  };

  return (
    <section className="card stack" aria-labelledby="mc-mods-title">
      <div className="section-head">
        <h2 id="mc-mods-title">{noun}</h2>
        <span className="secondary small">Ordner {modDir}/</span>
      </div>
      <div
        className="mc-drop"
        data-testid="mod-drop"
        data-over={over}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Upload aria-hidden="true" size={22} />
        <span>{uploading ? `Lädt ${uploading} hoch …` : `.jar-Dateien hierher ziehen`}</span>
        <button type="button" className="button" onClick={() => input.current?.click()} disabled={uploading !== null}>
          Datei auswählen
        </button>
        <input
          ref={input}
          type="file"
          accept=".jar"
          multiple
          hidden
          aria-label={`${noun} auswählen`}
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      {changed && (
        <div className="mc-restart-hint" role="status">
          <span>Wird beim nächsten Neustart aktiv.</span>
          <button
            type="button"
            className="button"
            onClick={async () => {
              await onRestart();
              setChanged(false);
            }}
          >
            <RotateCw aria-hidden="true" size={16} />
            Jetzt neu starten
          </button>
        </div>
      )}
      {mods && mods.length === 0 && <p className="secondary small">Noch keine eigenen {noun}.</p>}
      {mods && mods.length > 0 && (
        <ul className="mc-mods">
          {mods.map((m) => (
            <li key={m.name}>
              <span className="mc-mod-name">{m.name}</span>
              <span className="secondary small mono">{size(m.size)}</span>
              <button type="button" className="button icon-button button-danger" aria-label={`${m.name} löschen`} title="Löschen" onClick={() => void remove(m.name)}>
                <Trash2 aria-hidden="true" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

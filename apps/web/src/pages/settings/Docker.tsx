import { AlertCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { defaultPrefs, type DockerUsage } from '@mainframe/shared';
import { api, errorText, post } from '../../api/client.ts';
import { usePrefs } from '../../api/prefs.tsx';
import { Dialog } from '../../components/Dialog.tsx';
import { count, size } from '../../format.ts';
import { Group, Row, useSettings } from './Row.tsx';

const KINDS: { key: keyof DockerUsage; label: string }[] = [
  { key: 'images', label: 'Images' },
  { key: 'containers', label: 'Container' },
  { key: 'volumes', label: 'Volumes' },
  { key: 'buildCache', label: 'Build-Cache' },
];

export function Docker() {
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const { flash } = useSettings();
  const [data, setData] = useState<{ version: string; usage: DockerUsage } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ version: string; usage: DockerUsage }>('/api/system/docker/usage')
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  // Aufräumen entfernt nicht benutzte Images und den Build-Cache, nicht Container oder Volumes.
  const reclaimable = data ? data.usage.images.reclaimableBytes + data.usage.buildCache.reclaimableBytes : 0;

  async function prune() {
    setBusy(true);
    try {
      const r = await post<{ reclaimedBytes: number }>('/api/system/docker/prune');
      flash(`${size(r.reclaimedBytes, prefs.sizeUnits)} frei geworden`);
      setConfirm(false);
      load();
    } catch (err) {
      flash(errorText(err), false);
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

  return (
    <div className="stack-l">
      <Group>
        <Row label="Docker-Version" hint={data ? <span className="mono">{data.version}</span> : <span className="skeleton skeleton-line" />} />
      </Group>
      <Group title="Speicherverbrauch">
        <table className="usage-table">
          <thead>
            <tr>
              <th scope="col">Art</th>
              <th scope="col">Anzahl</th>
              <th scope="col">Größe</th>
              <th scope="col">Frei machbar</th>
            </tr>
          </thead>
          <tbody>
            {KINDS.map((k) => {
              const u = data?.usage[k.key];
              return (
                <tr key={k.key}>
                  <th scope="row">{k.label}</th>
                  <td>{u ? count(u.count) : '…'}</td>
                  <td>{u ? size(u.bytes, prefs.sizeUnits) : '…'}</td>
                  <td>{u ? size(u.reclaimableBytes, prefs.sizeUnits) : '…'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Group>
      <Group footer="Entfernt nicht benutzte Images und den Build-Cache. Installierte Apps und ihre Daten bleiben.">
        <Row label="Aufräumen" hint={data ? `Etwa ${size(reclaimable, prefs.sizeUnits)} können frei werden.` : undefined}>
          <button type="button" className="button" disabled={!data} onClick={() => setConfirm(true)}>
            Aufräumen …
          </button>
        </Row>
      </Group>
      {confirm && (
        <Dialog title="Docker aufräumen?" onClose={() => setConfirm(false)}>
          <div className="stack">
            <p>
              Etwa <strong>{size(reclaimable, prefs.sizeUnits)}</strong> werden frei. Nicht benutzte Images und der Build-Cache werden gelöscht; sie werden bei Bedarf neu
              heruntergeladen. Installierte Apps und ihre Daten bleiben.
            </p>
            <div className="dialog-actions">
              <button type="button" className="button" onClick={() => setConfirm(false)}>
                Abbrechen
              </button>
              <button type="button" className="button button-primary" disabled={busy} onClick={() => void prune()}>
                Aufräumen
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

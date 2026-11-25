import { Pencil, Radar, Wifi } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { DeviceInfo } from '@mainframe/shared';
import { api, errorText, post } from '../../api/client.ts';
import { Dialog } from '../../components/Dialog.tsx';

const title = (d: DeviceInfo) => d.name || d.hostname || d.vendor || 'Unbekanntes Gerät';

function EditDevice({ device, onClose, onSaved }: { device: DeviceInfo; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(device.name);
  const [note, setNote] = useState(device.note);
  const [known, setKnown] = useState(device.known);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/devices/${encodeURIComponent(device.mac)}`, { method: 'PATCH', body: JSON.stringify({ name, note, known }) });
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <Dialog title={title(device)} onClose={busy ? () => {} : onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="secondary mono">
          {device.ip} · {device.mac}
        </p>
        <fieldset className="stack" disabled={busy}>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={40} placeholder={device.hostname ?? device.vendor ?? ''} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Notiz</span>
            <textarea value={note} maxLength={200} rows={3} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="check">
            <input type="checkbox" checked={known} onChange={(e) => setKnown(e.target.checked)} />
            <span>Bekanntes Gerät</span>
          </label>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Speichern
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function DevicesPane() {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DeviceInfo | null>(null);

  const load = useCallback(
    () =>
      api<{ devices: DeviceInfo[]; scanning: boolean }>('/api/devices')
        .then((r) => {
          setDevices(r.devices);
          setScanning(r.scanning);
        })
        .catch((e) => setError(errorText(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const scan = async () => {
    setScanning(true);
    setError(null);
    try {
      setDevices(await post<DeviceInfo[]>('/api/devices/scan'));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setScanning(false);
    }
  };

  const unknown = (devices ?? []).filter((d) => !d.known).length;

  return (
    <div className="stack-l">
      <div className="section-head">
        <p className="secondary">
          {devices === null ? 'Geräte werden geladen …' : `${devices.length} Geräte bekannt${unknown > 0 ? `, ${unknown} davon neu` : ''}.`}
        </p>
        <button type="button" className="button button-primary" disabled={scanning} onClick={() => void scan()}>
          <Radar aria-hidden="true" size={18} />
          {scanning ? 'Scannt …' : 'Jetzt scannen'}
        </button>
      </div>
      {scanning && <div className="meter meter-indeterminate" role="progressbar" aria-label="Scan läuft" />}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {devices !== null && devices.length === 0 && !scanning && (
        <div className="card notice notice-info">
          <Wifi aria-hidden="true" size={20} />
          <p>Noch kein Scan. „Jetzt scannen“ sucht alle Geräte in deinem WLAN.</p>
        </div>
      )}
      {devices && devices.length > 0 && (
        <ul className="list device-list">
          {devices.map((d) => (
            <li key={d.mac} className="card device-row">
              <div className="device-main">
                <div className="device-title">
                  <strong>{title(d)}</strong>
                  {!d.known && <span className="badge badge-warn">Neu</span>}
                </div>
                <span className="hint">{d.randomMac ? 'Zufällige Adresse (Handy/Tablet)' : (d.vendor ?? 'Hersteller unbekannt')}</span>
                {d.note && <span className="hint">{d.note}</span>}
              </div>
              <div className="device-addr">
                <span className="mono">{d.ip}</span>
                <span className="mono hint">{d.mac}</span>
              </div>
              <span className={d.online ? 'presence presence-on' : 'presence'}>{d.online ? 'Online' : 'Offline'}</span>
              <button type="button" className="button icon-button" aria-label={`${title(d)} bearbeiten`} onClick={() => setEditing(d)}>
                <Pencil aria-hidden="true" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Am Windows-PC findet der Scan nicht jedes Gerät (schlafende Handys antworten oft nicht). Auf dem Server läuft er vollständig.</p>
      {editing && (
        <EditDevice
          device={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

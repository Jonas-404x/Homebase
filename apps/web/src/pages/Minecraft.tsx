import { Check, Copy, Pickaxe, Play, RotateCw, Settings2, Square } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { InstalledApp, MinecraftInfo } from '@mainframe/shared';
import { api, errorText, post } from '../api/client.ts';
import { useApps } from '../api/useApps.ts';
import { Console } from '../components/minecraft/Console.tsx';
import { ModsCard } from '../components/minecraft/ModsCard.tsx';
import { SettingsDialog } from '../components/minecraft/SettingsDialog.tsx';
import { SetupCard } from '../components/minecraft/SetupCard.tsx';
import { StatusBadge } from './Apps.tsx';
import '../components/minecraft/minecraft.css';

const TYPE_LABEL = { FABRIC: 'Fabric', PAPER: 'Paper' } as const;

/** Minecraft-Tab: ohne Server das Einrichten, sonst das Server-Panel. */
export function Minecraft() {
  const { apps, reload } = useApps();
  const app = apps?.find((a) => a.id === 'minecraft');
  return (
    <section className="page">
      <div className="detail-head">
        <span className="settings-item-icon" aria-hidden="true">
          <Pickaxe size={18} />
        </span>
        <h1>Minecraft</h1>
        {app && <StatusBadge state={app.state} />}
      </div>
      {apps === null ? null : app ? <ServerView app={app} reload={reload} /> : <SetupCard onDone={() => void reload()} />}
    </section>
  );
}

function ServerView({ app, reload }: { app: InstalledApp; reload: () => Promise<void> }) {
  const [info, setInfo] = useState<MinecraftInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState(false);
  // Zählt bei jedem neuen Container-Lauf hoch, damit die Konsole den neuen Log-Strom abonniert.
  const [logEpoch, setLogEpoch] = useState(0);

  const loadInfo = useCallback(() => {
    api<MinecraftInfo>('/api/minecraft/info').then(setInfo, (e) => setError(errorText(e)));
  }, []);
  useEffect(loadInfo, [loadInfo]);

  const running = app.state === 'running' || app.state === 'restarting';

  async function act(action: 'start' | 'stop' | 'restart') {
    setBusy(true);
    setError(null);
    try {
      await post(`/api/apps/minecraft/${action}`);
      if (action !== 'stop') setLogEpoch((n) => n + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      void reload();
    }
  }

  async function copy() {
    if (!info?.address) return;
    try {
      await navigator.clipboard.writeText(info.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Kopieren ging nicht. Markier die Adresse und kopier sie von Hand.');
    }
  }

  return (
    <>
      <div className="toolbar" role="toolbar" aria-label="Server steuern">
        {running ? (
          <button type="button" className="button" disabled={busy} onClick={() => act('stop')}>
            <Square aria-hidden="true" size={16} />
            Stoppen
          </button>
        ) : (
          <button type="button" className="button button-primary" disabled={busy || app.state === 'installing'} onClick={() => act('start')}>
            <Play aria-hidden="true" size={16} />
            Starten
          </button>
        )}
        <button type="button" className="button" disabled={busy || app.state === 'installing'} onClick={() => act('restart')}>
          <RotateCw aria-hidden="true" size={16} />
          Neu starten
        </button>
        <button type="button" className="button" disabled={!info || app.state === 'installing'} onClick={() => setSettings(true)}>
          <Settings2 aria-hidden="true" size={16} />
          Einstellungen
        </button>
      </div>
      {(error || app.error) && (
        <p className="error" role="alert">
          {error ?? app.error}
        </p>
      )}

      {info && (
        <section className="card mc-connect" aria-label="Verbinden">
          <div className="mc-connect-main">
            <span className="hint">Im Heimnetz verbinden</span>
            <span className="mc-address mono">{info.address ?? `Port ${info.port}`}</span>
            <span className="secondary small">
              {TYPE_LABEL[info.serverType]} {info.version} · {info.memory.replace('G', ' GB')} RAM
            </span>
          </div>
          {info.address && (
            <button type="button" className="button" onClick={() => void copy()} aria-label="Adresse kopieren">
              {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </button>
          )}
          {info.skippedMods.length > 0 && (
            <p className="hint mc-connect-note">Für {info.version} gibt es noch nicht: {info.skippedMods.join(', ')}. Kommt beim nächsten Ändern dazu, sobald es sie gibt.</p>
          )}
        </section>
      )}

      <Console state={app.state} epoch={logEpoch} />
      {info && <ModsCard modDir={info.modDir} onRestart={() => act('restart')} />}

      {settings && info && (
        <SettingsDialog
          info={info}
          onClose={() => setSettings(false)}
          onSaved={() => {
            setSettings(false);
            setLogEpoch((n) => n + 1);
            loadInfo();
            void reload();
          }}
        />
      )}
    </>
  );
}

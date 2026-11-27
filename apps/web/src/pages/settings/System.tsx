import { AlertTriangle, Info, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { defaultPrefs, type MainframeEvent } from '@mainframe/shared';
import { api } from '../../api/client.ts';
import { useLive } from '../../api/live.tsx';
import { usePrefs } from '../../api/prefs.tsx';
import { dateTime, uptime } from '../../format.ts';
import { MonitorKeyRow } from './MonitorKeyRow.tsx';
import { Group, Row, SERVER_ONLY, useSettings } from './Row.tsx';

const LEVEL_ICON = { info: Info, warn: AlertTriangle, error: XCircle };
const LEVEL_NAME = { info: 'Info', warn: 'Warnung', error: 'Fehler' };

export function System() {
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const { info } = useSettings();
  const [events, setEvents] = useState<MainframeEvent[] | null>(null);

  useEffect(() => {
    api<MainframeEvent[]>('/api/system/events')
      .then(setEvents)
      .catch(() => setEvents([]));
  }, []);
  useLive('event', useCallback((m) => setEvents((e) => [m.data, ...(e ?? [])].slice(0, 500)), []));

  const power = info?.isServer ? 'Kommt mit dem Server-Umzug' : SERVER_ONLY;

  return (
    <div className="stack-l">
      <Group>
        <Row label="Mainframe-Version" hint={info ? <span className="mono">{info.version}</span> : '…'} />
        <Row label="Läuft seit" hint={info ? uptime(info.mainframeUptimeSec) : '…'} />
        <Row label="Datenordner" hint={info ? <span className="mono">{info.dataRoot}</span> : '…'} />
        <Row label="Node.js" hint={info ? <span className="mono">{info.node}</span> : '…'} />
      </Group>

      <Group title="Ereignisse" footer="Seit dem letzten Start von Mainframe. Neue Einträge erscheinen sofort.">
        {events === null ? (
          <div className="setting-row">
            <span className="skeleton skeleton-line" />
          </div>
        ) : events.length === 0 ? (
          <div className="setting-row hint">Noch nichts passiert.</div>
        ) : (
          <ul className="event-log" aria-live="polite">
            {events.slice(0, 100).map((e, i) => {
              const Icon = LEVEL_ICON[e.level];
              return (
                <li key={`${e.at}-${i}`} className={`event event-${e.level}`}>
                  <Icon aria-label={LEVEL_NAME[e.level]} size={16} />
                  <span className="event-text">{e.text}</span>
                  <time className="hint">{dateTime(e.at, prefs.timeZone)}</time>
                </li>
              );
            })}
          </ul>
        )}
      </Group>

      <Group title="Gerät">
        <MonitorKeyRow />
        <Row label="Neu starten" hint="Startet den ganzen Server neu." disabledReason={power}>
          <button type="button" className="button" disabled>
            Neu starten
          </button>
        </Row>
        <Row label="Herunterfahren" hint="Schaltet den Server aus. Einschalten dann per Wake-on-LAN." disabledReason={power}>
          <button type="button" className="button button-destructive" disabled>
            Herunterfahren
          </button>
        </Row>
      </Group>
    </div>
  );
}

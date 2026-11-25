import { defaultPrefs } from '@mainframe/shared';
import { usePrefs } from '../../api/prefs.tsx';
import { Choice, Group, Row, TextSetting, useSave } from './Row.tsx';

const COMMON_ZONES = ['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'Europe/Paris', 'Europe/Madrid', 'Europe/Rome', 'America/New_York', 'Asia/Tokyo', 'UTC'];

function zones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : COMMON_ZONES;
  return all.includes(current) ? all : [current, ...all];
}

export function General() {
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const save = useSave();
  return (
    <div className="stack-l">
      <Group footer="Erscheint oben in der Navigation und als Titel im Browser-Tab.">
        <Row label="Gerätename" id="set-device-name">
          <TextSetting id="set-device-name" value={prefs.deviceName} maxLength={40} onSave={(v) => void save({ deviceName: v })} />
        </Row>
      </Group>
      <Group>
        <Row label="Startseite" hint="Was nach dem Anmelden zuerst kommt.">
          <Choice label="Startseite" value={prefs.startPage} options={[{ value: '/', label: 'Übersicht' }, { value: '/apps', label: 'Apps' }]} onChange={(v) => void save({ startPage: v })} />
        </Row>
        <Row label="Zeitzone" id="set-tz" hint="Für Uhrzeiten in Protokollen und Ereignissen.">
          <select id="set-tz" className="input" value={prefs.timeZone} onChange={(e) => void save({ timeZone: e.target.value })}>
            {zones(prefs.timeZone).map((z) => (
              <option key={z} value={z}>
                {z.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Row>
      </Group>
    </div>
  );
}

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { defaultPrefs, type CardId, type Prefs } from '@mainframe/shared';
import { usePrefs } from '../../api/prefs.tsx';
import { RANGES } from '../Details.tsx';
import { Choice, Group, Row, Switch, useSave, useSettings } from './Row.tsx';

const CARD_NAMES: Record<CardId, string> = {
  cpu: 'Prozessor',
  memory: 'Arbeitsspeicher',
  disk: 'Speicher',
  temperature: 'Temperatur',
  network: 'Netzwerk',
  uptime: 'Läuft seit',
  adguard: 'AdGuard Home',
};

type ThresholdKey = keyof Prefs['thresholds'];
const THRESHOLDS: { key: ThresholdKey; label: string; unit: string }[] = [
  { key: 'memory', label: 'Arbeitsspeicher', unit: '%' },
  { key: 'disk', label: 'Speicher', unit: '%' },
  { key: 'temperature', label: 'Temperatur', unit: '°C' },
];

function ThresholdInput({ k, label, unit, prefs }: { k: ThresholdKey; label: string; unit: string; prefs: Prefs }) {
  const save = useSave();
  const { flash } = useSettings();
  const [draft, setDraft] = useState<string | null>(null);
  const id = `set-threshold-${k}`;
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (!Number.isInteger(n) || n < 50 || n > 100) return flash('Bitte eine ganze Zahl zwischen 50 und 100.', false);
    if (n !== prefs.thresholds[k]) void save({ thresholds: { ...prefs.thresholds, [k]: n } });
  };
  return (
    <Row label={label} id={id}>
      <span className="input-unit">
        <input
          id={id}
          className="input input-number"
          type="number"
          inputMode="numeric"
          min={50}
          max={100}
          value={draft ?? prefs.thresholds[k]}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span aria-hidden="true">{unit}</span>
      </span>
    </Row>
  );
}

export function OverviewPane() {
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const save = useSave();
  const cards = prefs.cards;

  const move = (i: number, dir: -1 | 1) => {
    const next = [...cards];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    void save({ cards: next });
  };

  return (
    <div className="stack-l">
      <Group title="Karten" footer="Reihenfolge mit den Pfeilen ändern. Ausgeschaltete Karten verschwinden aus der Übersicht.">
        <ol className="card-order">
          {cards.map((c, i) => (
            <li key={c.id} className="setting-row">
              <span className="setting-label">{CARD_NAMES[c.id]}</span>
              <span className="setting-control card-order-controls">
                <button type="button" className="button icon-button" aria-label={`${CARD_NAMES[c.id]} nach oben`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ChevronUp aria-hidden="true" size={18} />
                </button>
                <button type="button" className="button icon-button" aria-label={`${CARD_NAMES[c.id]} nach unten`} disabled={i === cards.length - 1} onClick={() => move(i, 1)}>
                  <ChevronDown aria-hidden="true" size={18} />
                </button>
                <Switch label={`${CARD_NAMES[c.id]} anzeigen`} checked={c.visible} onChange={(v) => void save({ cards: cards.map((x) => (x.id === c.id ? { ...x, visible: v } : x)) })} />
              </span>
            </li>
          ))}
        </ol>
      </Group>
      <Group title="Warnschwellen" footer="Ab diesem Wert zeigt die Karte „Hoch“, 5 darüber „Kritisch“.">
        {THRESHOLDS.map((t) => (
          <ThresholdInput key={t.key} k={t.key} label={t.label} unit={t.unit} prefs={prefs} />
        ))}
      </Group>
      <Group>
        <Row label="Verlauf" hint="Zeitraum der kleinen Kurven auf den Karten.">
          <Choice
            label="Verlauf"
            value={prefs.historyMinutes}
            options={[{ value: 1, label: '1 Min.' }, { value: 15, label: '15 Min.' }, { value: 60, label: '1 Std.' }, { value: 360, label: '6 Std.' }]}
            onChange={(v) => void save({ historyMinutes: v })}
          />
        </Row>
        <Row label="Detailansicht" hint="Zeitraum der großen Kurve, wenn man auf eine Karte klickt. Dort lässt er sich auch direkt umstellen." stacked>
          <Choice label="Detailansicht" value={prefs.detailMinutes} options={RANGES} onChange={(v) => void save({ detailMinutes: v })} />
        </Row>
      </Group>
    </div>
  );
}

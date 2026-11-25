import { Check } from 'lucide-react';
import { ACCENTS, defaultPrefs, type Accent } from '@mainframe/shared';
import { usePrefs } from '../../api/prefs.tsx';
import { Choice, Group, Row, useSave } from './Row.tsx';

const ACCENT_NAMES: Record<Accent, string> = { blue: 'Blau', teal: 'Türkis', violet: 'Violett', pink: 'Pink', orange: 'Orange', green: 'Grün' };

export function Appearance() {
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const save = useSave();
  return (
    <div className="stack-l">
      <Group footer="Färbt Knöpfe, Links, die aktive Navigation und die Verlaufskurven.">
        <Row label="Akzentfarbe">
          <div className="swatches" role="radiogroup" aria-label="Akzentfarbe">
            {ACCENTS.map((a) => (
              <label key={a} className="swatch-option" title={ACCENT_NAMES[a]}>
                <input type="radio" name="accent" checked={prefs.accent === a} onChange={() => void save({ accent: a })} aria-label={ACCENT_NAMES[a]} />
                <span className="swatch" data-accent={a} aria-hidden="true">
                  {prefs.accent === a && <Check size={16} />}
                </span>
                <span className="swatch-name">{ACCENT_NAMES[a]}</span>
              </label>
            ))}
          </div>
        </Row>
        <Row label="Dichte" hint="Kompakt zeigt mehr auf einmal.">
          <Choice label="Dichte" value={prefs.density} options={[{ value: 'normal', label: 'Normal' }, { value: 'compact', label: 'Kompakt' }]} onChange={(v) => void save({ density: v })} />
        </Row>
      </Group>
      <Group title="Werte">
        <Row label="Aktualisierung" hint="Wie oft die Live-Werte neu kommen.">
          <Choice
            label="Aktualisierung"
            value={prefs.liveIntervalSec}
            options={[{ value: 1, label: '1 s' }, { value: 2, label: '2 s' }, { value: 5, label: '5 s' }]}
            onChange={(v) => void save({ liveIntervalSec: v })}
          />
        </Row>
        <Row label="Speichergrößen" hint="GB rechnet in 1000ern (wie Festplatten-Hersteller), GiB in 1024ern (wie Windows).">
          <Choice label="Speichergrößen" value={prefs.sizeUnits} options={[{ value: 'si', label: 'GB' }, { value: 'iec', label: 'GiB' }]} onChange={(v) => void save({ sizeUnits: v })} />
        </Row>
        <Row label="Netzwerk-Einheit" hint="Mbit/s ist die Einheit, in der Internet-Tarife angegeben werden.">
          <Choice label="Netzwerk-Einheit" value={prefs.netUnits} options={[{ value: 'bytes', label: 'MB/s' }, { value: 'bits', label: 'Mbit/s' }]} onChange={(v) => void save({ netUnits: v })} />
        </Row>
      </Group>
    </div>
  );
}

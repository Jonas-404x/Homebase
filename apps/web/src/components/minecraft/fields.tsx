import { useEffect, useState } from 'react';
import { api } from '../../api/client.ts';

export type ServerType = 'FABRIC' | 'PAPER';
export const MEMORY_CHOICES = ['2G', '3G', '4G', '5G', '6G'] as const;
export const DEFAULT_VERSION = '26.3';

const TYPES: { value: ServerType; title: string; text: string }[] = [
  { value: 'FABRIC', title: 'Fabric', text: 'Für Mods wie Lithium. Das, was du bisher kennst.' },
  { value: 'PAPER', title: 'Paper', text: 'Für Plugins wie EssentialsX. Sehr schnell, aber keine Fabric-Mods.' },
];

/** Paper oder Fabric als zwei große Auswahlkarten. */
export function TypePicker({ value, onChange }: { value: ServerType; onChange: (t: ServerType) => void }) {
  return (
    <fieldset className="mc-types">
      <legend className="setting-label">Server-Typ</legend>
      {TYPES.map((t) => (
        <label key={t.value} className="mc-type" data-selected={value === t.value}>
          <input type="radio" name="serverType" value={t.value} checked={value === t.value} onChange={() => onChange(t.value)} aria-label={t.title} />
          <strong>{t.title}</strong>
          <span className="hint">{t.text}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Release-Versionen von Mojang; ohne Liste ein Textfeld. */
export function VersionField({ value, onChange, minVersion }: { value: string; onChange: (v: string) => void; minVersion?: string }) {
  const [list, setList] = useState<string[] | null | 'failed'>(null);
  useEffect(() => {
    api<string[]>('/api/minecraft/versions').then(setList, () => setList('failed'));
  }, []);
  if (list === 'failed') {
    return (
      <label className="field">
        <span>Version</span>
        <input type="text" className="mono" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  // Ältere Versionen als die aktuelle würden die Welt kaputt machen: gar nicht erst anbieten.
  const cut = minVersion && list ? list.indexOf(minVersion) : -1;
  const options = list ? (cut >= 0 ? list.slice(0, cut + 1) : list) : [value];
  return (
    <label className="field">
      <span>Version</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((v, i) => (
          <option key={v} value={v}>
            {i === 0 && list ? `${v} (neueste)` : v}
          </option>
        ))}
      </select>
    </label>
  );
}

export function MemoryField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>RAM für Minecraft</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {MEMORY_CHOICES.map((m) => (
          <option key={m} value={m}>
            {m.replace('G', ' GB')}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PerfModsField({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check check-top">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Spar-Mods vorinstallieren
        <span className="hint block">Fabric API, Lithium, FerriteCore und Krypton: weniger RAM, mehr Leistung.</span>
      </span>
    </label>
  );
}

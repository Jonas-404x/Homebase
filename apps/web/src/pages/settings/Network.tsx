import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { defaultPrefs } from '@mainframe/shared';
import { usePrefs } from '../../api/prefs.tsx';
import { Choice, Group, Row, useSave, useSettings } from './Row.tsx';
import { ShareGroup } from './ShareGroup.tsx';

/** Tailscale vergibt Adressen aus 100.64.0.0/10. */
export const isTailscale = (ip: string) => {
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b! >= 64 && b! <= 127;
};

function Qr({ url }: { url: string | null }) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      .then((svg) => alive && setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div className="qr-row">
      {qr ? <img className="qr" src={qr} alt={`QR-Code für ${url}`} width={148} height={148} /> : <div className="qr skeleton" aria-hidden="true" />}
      {url && (
        <a className="mono" href={url}>
          {url}
        </a>
      )}
    </div>
  );
}

export function NetworkPane() {
  const { info } = useSettings();
  const prefs = usePrefs().prefs ?? defaultPrefs;
  const save = useSave();
  const lan = info?.addresses.find((a) => !isTailscale(a.ip))?.ip;
  const ts = info?.addresses.find((a) => isTailscale(a.ip))?.ip;
  const url = info && lan ? `http://${lan}:${info.port}` : null;
  const tsUrl = info && ts ? `http://${ts}:${info.port}` : null;

  return (
    <div className="stack-l">
      <Group title="Adressen">
        <Row label="Gerät" hint={info ? info.hostname : '…'} />
        {(info?.addresses ?? []).map((a) => (
          <Row key={a.iface + a.ip} label={a.iface} hint={<span className="mono">{a.ip}</span>} />
        ))}
        <Row label="Port" hint={<span className="mono">{info?.port ?? '…'}</span>} />
      </Group>
      <Group title="Am Handy öffnen" footer="Mit der Kamera scannen. Handy und Mainframe müssen im selben WLAN sein. In Safari dann „Teilen › Zum Home-Bildschirm“ für das Mainframe-Logo.">
        <Qr url={url} />
      </Group>
      <Group
        title="Von unterwegs"
        footer={
          tsUrl
            ? 'Funktioniert überall (Schule, mobile Daten), solange am Handy die Tailscale-App verbunden ist. Nur deine eigenen Geräte kommen rein.'
            : 'Mit der kostenlosen App Tailscale auf PC und Handy erreichst du Mainframe von überall, ohne etwas am Router freizugeben.'
        }
      >
        {tsUrl ? (
          <>
            <Row label="Fernzugriff" hint="Aktiv über Tailscale" />
            <Qr url={tsUrl} />
          </>
        ) : (
          <Row label="Fernzugriff" hint="Von unterwegs über Tailscale, ohne Ports am Router zu öffnen." disabledReason="Tailscale ist noch nicht eingerichtet" />
        )}
      </Group>
      <Group title="Überwachung" footer="Gilt für den Bereich Dienste. Ein Speedtest lädt jedes Mal rund 30 MB.">
        <Row label="Prüfintervall" hint="Wie oft Apps und Links auf Erreichbarkeit geprüft werden.">
          <Choice
            label="Prüfintervall"
            value={prefs.checkIntervalSec}
            options={[{ value: 30, label: '30 Sek.' }, { value: 60, label: '1 Min.' }, { value: 300, label: '5 Min.' }]}
            onChange={(v) => void save({ checkIntervalSec: v })}
          />
        </Row>
        <Row label="Automatischer Scan" hint="Sucht neue Geräte im WLAN und meldet sie.">
          <Choice
            label="Automatischer Scan"
            value={prefs.scanMinutes}
            options={[{ value: 0, label: 'Aus' }, { value: 15, label: '15 Min.' }, { value: 60, label: '1 Std.' }, { value: 360, label: '6 Std.' }]}
            onChange={(v) => void save({ scanMinutes: v })}
          />
        </Row>
        <Row label="Speedtest" hint="Misst die Internet-Geschwindigkeit von selbst.">
          <Choice
            label="Speedtest"
            value={prefs.speedtestHours}
            options={[{ value: 0, label: 'Aus' }, { value: 6, label: 'alle 6 Std.' }, { value: 24, label: 'täglich' }]}
            onChange={(v) => void save({ speedtestHours: v })}
          />
        </Row>
      </Group>
      <ShareGroup />
    </div>
  );
}

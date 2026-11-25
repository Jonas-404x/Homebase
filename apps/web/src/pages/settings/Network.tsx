import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Group, Row, SERVER_ONLY, useSettings } from './Row.tsx';

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
  const lan = info?.addresses.find((a) => !isTailscale(a.ip))?.ip;
  const ts = info?.addresses.find((a) => isTailscale(a.ip))?.ip;
  const url = info && lan ? `http://${lan}:${info.port}` : null;
  const tsUrl = info && ts ? `http://${ts}:${info.port}` : null;
  const later = info?.isServer ? 'Kommt mit dem Server-Umzug' : SERVER_ONLY;

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
      <Group title="Später">
        <Row label="Netzwerkfreigabe" hint="Den Speicher des Servers im Windows-Explorer als Laufwerk sehen." disabledReason={later} />
      </Group>
    </div>
  );
}

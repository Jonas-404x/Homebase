import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Group, Row, SERVER_ONLY, useSettings } from './Row.tsx';

export function NetworkPane() {
  const { info } = useSettings();
  const first = info?.addresses[0]?.ip;
  const url = info && first ? `http://${first}:${info.port}` : null;
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
        <div className="qr-row">
          {qr ? <img className="qr" src={qr} alt={`QR-Code für ${url}`} width={148} height={148} /> : <div className="qr skeleton" aria-hidden="true" />}
          {url && (
            <a className="mono" href={url}>
              {url}
            </a>
          )}
        </div>
      </Group>
      <Group title="Später">
        <Row label="Fernzugriff" hint="Von unterwegs über Tailscale, ohne Ports am Router zu öffnen." disabledReason={later} />
        <Row label="Netzwerkfreigabe" hint="Den Speicher des Servers im Windows-Explorer als Laufwerk sehen." disabledReason={later} />
      </Group>
    </div>
  );
}

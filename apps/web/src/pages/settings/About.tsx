import { ExternalLink } from 'lucide-react';
import { Group, Row, useSettings } from './Row.tsx';

const REPO = 'https://github.com/Jonas-404x/Mainframe';

export function About() {
  const { info } = useSettings();
  return (
    <div className="stack-l">
      <div className="about">
        <img src="/apple-touch-icon.png" alt="" width={72} height={72} className="about-logo" />
        <div>
          <div className="about-name">Mainframe</div>
          <div className="hint">Version {info?.version ?? '…'} · Cockpit für den Heimserver</div>
        </div>
      </div>
      <Group>
        <Row label="Quellcode auf GitHub">
          <a className="button" href={REPO} target="_blank" rel="noopener noreferrer">
            Öffnen
            <ExternalLink aria-hidden="true" size={16} />
          </a>
        </Row>
        <Row label="Änderungen" hint="Was in welcher Version neu ist.">
          <a className="button" href={`${REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">
            Anzeigen
            <ExternalLink aria-hidden="true" size={16} />
          </a>
        </Row>
      </Group>
    </div>
  );
}

import { Archive, Globe, Pickaxe, Puzzle, Terminal, Users } from 'lucide-react';

const PLANNED = [
  { icon: Terminal, title: 'Live-Konsole', text: 'Server-Log in Echtzeit und Befehle direkt eingeben, mit Verlauf über die Pfeiltasten.' },
  { icon: Users, title: 'Spieler', text: 'Wer gerade online ist, mit Skin, Spielzeit und Knöpfen für OP, Kick und Bann.' },
  { icon: Globe, title: 'Für Freunde erreichbar', text: 'Eine öffentliche Adresse über playit.gg, ohne Ports am Router zu öffnen.' },
  { icon: Archive, title: 'Welten und Backups', text: 'Welten hochladen, wechseln und automatisch sichern.' },
  { icon: Puzzle, title: 'Plugins', text: 'Plugins mit einem Klick installieren und aktualisieren.' },
];

/** Platzhalter bis Teil 5: zeigt, was hier kommt (Jonas wollte den Tab schon sehen). */
export function Minecraft() {
  return (
    <section className="page">
      <div className="detail-head">
        <span className="settings-item-icon" aria-hidden="true">
          <Pickaxe size={18} />
        </span>
        <h1>Minecraft</h1>
        <span className="badge badge-warn">Kommt bald</span>
      </div>
      <p className="secondary">
        Der eigene Minecraft-Server kommt mit einem späteren Update, sobald der Server-PC läuft. Das ist geplant:
      </p>
      <ul className="planned">
        {PLANNED.map((p) => (
          <li key={p.title} className="card planned-item">
            <p.icon aria-hidden="true" size={22} />
            <div>
              <div className="setting-label">{p.title}</div>
              <div className="hint">{p.text}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

import { CornerDownLeft } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { AppState } from '@mainframe/shared';
import { errorText, post } from '../../api/client.ts';
import { useLive, useLiveSocket } from '../../api/live.tsx';

export const MAX_CONSOLE_LINES = 1000;
const HISTORY_KEY = 'mf.mc.history';
const MAX_HISTORY = 50;

const loadHistory = (): string[] => {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(h) ? h.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** Live-Log des Servers plus Befehlszeile (Verlauf mit Pfeil hoch/runter, im Browser gemerkt). */
export function Console({ state }: { state: AppState }) {
  const socket = useLiveSocket();
  const [lines, setLines] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>(loadHistory());
  const pos = useRef(-1);
  const box = useRef<HTMLPreElement>(null);
  const follow = useRef(true);

  const add = useCallback((more: string[]) => {
    setLines((prev) => [...prev, ...more].slice(-MAX_CONSOLE_LINES));
  }, []);

  // Nach Start/Neustart gibt es einen neuen Log-Strom: neu abonnieren (der Server schickt die letzten Zeilen mit).
  const live = state === 'running' || state === 'restarting';
  useEffect(() => {
    if (!live) return;
    setLines([]);
    socket.send({ type: 'subscribe-logs', appId: 'minecraft' });
    return () => socket.send({ type: 'unsubscribe-logs', appId: 'minecraft' });
  }, [socket, live]);

  useLive(
    'log',
    useCallback((m) => m.appId === 'minecraft' && add([m.line]), [add]),
  );

  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd || busy) return;
    history.current = [cmd, ...history.current.filter((h) => h !== cmd)].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.current));
    pos.current = -1;
    setCommand('');
    setBusy(true);
    add([`› ${cmd}`]);
    try {
      const { output } = await post<{ output: string }>('/api/minecraft/command', { command: cmd });
      if (output) add(output.split(/\r?\n/));
    } catch (err) {
      add([`! ${errorText(err)}`]);
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const h = history.current;
    pos.current = e.key === 'ArrowUp' ? Math.min(pos.current + 1, h.length - 1) : Math.max(pos.current - 1, -1);
    setCommand(pos.current >= 0 ? (h[pos.current] ?? '') : '');
  }

  return (
    <section className="card stack mc-console" aria-labelledby="mc-console-title">
      <h2 id="mc-console-title">Konsole</h2>
      <pre
        ref={box}
        className="log mono"
        data-testid="console-lines"
        tabIndex={0}
        aria-label="Server-Log"
        onScroll={() => {
          const el = box.current;
          if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {lines.length === 0 ? (live ? 'Warte auf Ausgaben …' : 'Der Server ist aus. Starte ihn, dann siehst du hier, was er tut.') : lines.join('\n')}
      </pre>
      <form className="mc-command" onSubmit={send}>
        <span className="mono mc-prompt" aria-hidden="true">/</span>
        <input
          className="mono"
          aria-label="Befehl"
          placeholder={live ? 'Befehl, z. B. op DeinName' : 'Server ist aus'}
          autoComplete="off"
          spellCheck={false}
          maxLength={1000}
          value={command}
          disabled={!live}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="submit" className="button icon-button" aria-label="Befehl senden" title="Senden" disabled={!live || busy || !command.trim()}>
          <CornerDownLeft aria-hidden="true" size={18} />
        </button>
      </form>
    </section>
  );
}

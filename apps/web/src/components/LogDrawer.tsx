import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLive, useLiveSocket } from '../api/live.tsx';
import { Dialog } from './Dialog.tsx';

export const MAX_LOG_LINES = 2000;

/** Live-Logs einer App. Folgt automatisch nach unten, außer man scrollt hoch. */
export function LogDrawer({ appId, appName, onClose }: { appId: string; appName: string; onClose: () => void }) {
  const socket = useLiveSocket();
  const [lines, setLines] = useState<string[]>([]);
  const box = useRef<HTMLPreElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    socket.send({ type: 'subscribe-logs', appId });
    return () => socket.send({ type: 'unsubscribe-logs', appId });
  }, [socket, appId]);

  useLive(
    'log',
    useCallback(
      (m) => {
        if (m.appId !== appId) return;
        setLines((prev) => {
          const next = prev.length >= MAX_LOG_LINES ? prev.slice(prev.length - MAX_LOG_LINES + 1) : prev.slice();
          next.push(m.line);
          return next;
        });
      },
      [appId],
    ),
  );

  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = box.current;
    if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <Dialog title={`Logs: ${appName}`} onClose={onClose} wide>
      <pre ref={box} className="log mono" data-testid="log-lines" onScroll={onScroll} tabIndex={0} aria-label={`Logs von ${appName}`}>
        {lines.length === 0 ? '' : lines.join('\n') + '\n'}
      </pre>
      {lines.length === 0 && <p className="secondary">Warte auf Ausgaben …</p>}
    </Dialog>
  );
}

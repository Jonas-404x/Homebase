import type { FastifyInstance } from 'fastify';
import type { DeviceInfo } from '@mainframe/shared';
import type { Db } from '../db.ts';
import { MainframeError } from '../errors.ts';
import type { PrefsStore } from '../prefs/store.ts';
import type { EventLog } from '../system/events.ts';
import { createScanner, isRandomMac, type ScanDeps } from './scanner.ts';
import { createDeviceStore } from './store.ts';

const ipKey = (ip: string) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);

/** Geräte im Heimnetz: Scan per Knopf und automatisch, mit eigenem Namen und Notiz. */
export function registerDeviceRoutes(app: FastifyInstance, opts: { db: Db; prefs: PrefsStore; events?: EventLog; deps: ScanDeps; intervalMs?: number }): { list: () => DeviceInfo[] } {
  const store = createDeviceStore(opts.db);
  const scanner = createScanner({ store, events: opts.events, deps: opts.deps });

  const list = (): DeviceInfo[] => {
    // Alle Geräte eines Scans bekommen denselben Zeitstempel: online ist, wer beim letzten Scan da war.
    // Das steht in der Datenbank und gilt deshalb auch nach einem Neustart.
    const all = store.list();
    const last = Math.max(0, ...all.map((d) => d.lastSeen));
    return all
      .map((d) => ({ ...d, randomMac: isRandomMac(d.mac), online: last > 0 && d.lastSeen === last }))
      .sort((a, b) => ipKey(a.ip) - ipKey(b.ip));
  };

  app.get('/api/devices', async () => ({ devices: list(), scanning: scanner.running() }));
  app.post('/api/devices/scan', async () => {
    await scanner.scan();
    return list();
  });

  app.patch<{ Params: { mac: string }; Body: { name?: unknown; note?: unknown; known?: unknown } }>('/api/devices/:mac', async (req, reply) => {
    const b = req.body ?? {};
    const bad = (msg: string) => new MainframeError('invalid_input', msg, 400);
    if (b.name !== undefined && (typeof b.name !== 'string' || b.name.trim().length > 40)) throw bad('Name: höchstens 40 Zeichen.');
    if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 200)) throw bad('Notiz: höchstens 200 Zeichen.');
    if (b.known !== undefined && typeof b.known !== 'boolean') throw bad('„Bekannt“ ist ja oder nein.');
    const ok = store.update(req.params.mac.toLowerCase(), {
      ...(typeof b.name === 'string' ? { name: b.name.trim() } : {}),
      ...(typeof b.note === 'string' ? { note: b.note.trim() } : {}),
      ...(typeof b.known === 'boolean' ? { known: b.known } : {}),
    });
    if (!ok) throw new MainframeError('not_found', 'Dieses Gerät kennt Mainframe nicht.', 404);
    return reply.code(204).send();
  });

  // Automatischer Scan, Takt aus den Einstellungen (0 = nur per Knopf).
  const interval = () => opts.intervalMs ?? opts.prefs.get().scanMinutes * 60_000;
  let timer: NodeJS.Timeout | null = null;
  const start = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (interval() <= 0) return;
    timer = setInterval(() => void scanner.scan().catch(() => {}), interval());
    timer.unref();
  };
  start();
  // Erster Scan kurz nach dem Start, damit die Liste nicht leer ist.
  const first = interval() > 0 ? setTimeout(() => void scanner.scan().catch(() => {}), 15_000) : null;
  first?.unref();
  opts.prefs.onChange(start);
  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    if (first) clearTimeout(first);
  });
  return { list };
}

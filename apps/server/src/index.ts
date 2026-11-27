import fs from 'node:fs';
import path from 'node:path';
import { registerAdguardHook, registerAdguardRoutes } from './adguard/routes.ts';
import { buildApp } from './app.ts';
import { createComposeRunner } from './apps/compose-runner.ts';
import { createDockerStatus } from './apps/docker-status.ts';
import { createAppEngine } from './apps/engine.ts';
import { createStateStore } from './apps/state-store.ts';
import { loadCatalog } from './catalog/loader.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createKioskStore } from './kiosk/store.ts';

const config = loadConfig();
fs.mkdirSync(config.dataRoot, { recursive: true });
const db = openDb(path.join(config.dataRoot, 'mainframe.db'));

const engine = createAppEngine({
  config,
  catalog: await loadCatalog(config.catalogDir),
  compose: createComposeRunner(),
  docker: createDockerStatus(),
  store: createStateStore(config.dataRoot),
});

registerAdguardHook(engine);
// Schlüssel für den Server-Monitor: einmal anlegen, dann bleibt er (siehe docs/server-monitor.md).
const kiosk = createKioskStore(db, config.dataRoot, (m) => console.warn(m));
kiosk.ensureKey();
const app = await buildApp({ config, db, engine, kiosk, plugins: [(a) => registerAdguardRoutes(a, engine)] });

setInterval(() => db.deleteExpiredSessions(Date.now()), 60 * 60 * 1000).unref();

await app.listen({ port: config.port, host: '0.0.0.0' });
app.events.add('info', 'Mainframe gestartet');
console.log(`Mainframe läuft auf http://localhost:${config.port} (Daten: ${config.dataRoot})`);

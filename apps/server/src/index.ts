import fs from 'node:fs';
import path from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';

const config = loadConfig();
fs.mkdirSync(config.dataRoot, { recursive: true });
const db = openDb(path.join(config.dataRoot, 'homebase.db'));
const app = await buildApp({ config, db });

setInterval(() => db.deleteExpiredSessions(Date.now()), 60 * 60 * 1000).unref();

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Homebase läuft auf http://localhost:${config.port} (Daten: ${config.dataRoot})`);

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { MinecraftInfo } from '@mainframe/shared';
import type { AppEngine } from '../apps/engine.ts';
import { MainframeError } from '../errors.ts';
import { lanSubnet } from '../network/scanner.ts';
import { createMinecraftPrepare, fetchReleases, MINECRAFT_ID } from './logic.ts';
import { deleteMod, listMods, saveMod } from './mods.ts';

export interface MinecraftDeps {
  fetchImpl?: typeof fetch;
  /** Eigene Adresse im Heimnetz (Tests). */
  lanAddress?: () => string | null;
}

const MAX_UPLOAD = 100 * 1024 * 1024;

/** Versionsliste höchstens einmal pro Stunde bei Mojang holen. */
function cachedReleases(fetchImpl: typeof fetch) {
  let cache: { at: number; list: string[] } | null = null;
  return async () => {
    if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache.list;
    const list = await fetchReleases(fetchImpl);
    cache = { at: Date.now(), list };
    return list;
  };
}

/** Setzt den prepare-Hook und gibt die Routen als Plugin für buildApp zurück. */
export function registerMinecraft(engine: AppEngine, deps: MinecraftDeps = {}): (app: FastifyInstance) => void {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const releases = cachedReleases(fetchImpl);
  engine.hooks.set(MINECRAFT_ID, { ...engine.hooks.get(MINECRAFT_ID), prepare: createMinecraftPrepare({ fetchImpl, releases }) });
  const lanAddress = deps.lanAddress ?? (() => lanSubnet()?.self ?? null);

  return (app) => {
    const values = () => engine.values(MINECRAFT_ID);
    const modDir = (v: Record<string, string>) => (v.serverType === 'PAPER' ? 'plugins' : 'mods');
    const modPath = async () => path.join(engine.appDataDir(MINECRAFT_ID), modDir(await values()));

    app.get('/api/minecraft/versions', async () => releases());

    app.get('/api/minecraft/info', async (): Promise<MinecraftInfo> => {
      const v = await values();
      const ip = lanAddress();
      return {
        address: ip ? `${ip}:${v.game}` : null,
        port: Number(v.game),
        serverType: v.serverType === 'PAPER' ? 'PAPER' : 'FABRIC',
        version: v.version ?? '',
        memory: v.memory ?? '',
        perfMods: v.perfMods === 'true',
        skippedMods: (v.modrinthSkipped ?? '').split(',').filter(Boolean),
        modDir: modDir(v),
      };
    });

    app.post<{ Body: { command?: unknown } }>('/api/minecraft/command', async (req) => {
      const raw = req.body?.command;
      const command = typeof raw === 'string' ? raw.trim().replace(/^\//, '') : '';
      if (!command) throw new MainframeError('invalid_input', 'Gib einen Befehl ein.', 400);
      if (command.length > 1000 || /[\r\n]/.test(command)) {
        throw new MainframeError('invalid_input', 'Der Befehl ist zu lang oder hat Zeilenumbrüche.', 400);
      }
      const me = (await engine.list()).find((a) => a.id === MINECRAFT_ID);
      if (!me) throw new MainframeError('not_installed', 'Der Minecraft-Server ist nicht eingerichtet.', 404);
      if (me.state !== 'running') throw new MainframeError('not_running', 'Der Server läuft gerade nicht.', 409);
      let output: string;
      try {
        output = await engine.exec(MINECRAFT_ID, 'minecraft', ['rcon-cli', command]);
      } catch (err) {
        if (err instanceof MainframeError) throw err;
        // RCON ist erst da, wenn der Server fertig geladen hat.
        throw new MainframeError('not_ready', 'Der Server startet noch. Versuch es gleich nochmal.', 409);
      }
      app.events?.add('info', `Minecraft: /${command.slice(0, 80)}`);
      return { output: output.trim() };
    });

    app.get('/api/minecraft/mods', async () => listMods(await modPath()));

    // Eigener Bereich, damit der Binär-Parser nur hier gilt (der Login-Schutz greift trotzdem).
    app.register(async (scope) => {
      scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));
      scope.put<{ Params: { name: string } }>('/api/minecraft/mods/:name', { bodyLimit: MAX_UPLOAD }, async (req, reply) => {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new MainframeError('invalid_input', 'Die Datei ist leer.', 400);
        await saveMod(await modPath(), req.params.name, req.body, engine.appDataDir(MINECRAFT_ID));
        app.events?.add('info', `Minecraft: ${req.params.name} hochgeladen`);
        return reply.code(204).send();
      });
    });

    app.delete<{ Params: { name: string } }>('/api/minecraft/mods/:name', async (req, reply) => {
      await deleteMod(await modPath(), req.params.name);
      app.events?.add('info', `Minecraft: ${req.params.name} gelöscht`);
      return reply.code(204).send();
    });

    app.put<{ Body: Record<string, unknown> | undefined }>('/api/minecraft/settings', async (req) => {
      const body = req.body ?? {};
      const input: Record<string, unknown> = {};
      for (const key of ['serverType', 'version', 'memory', 'perfMods'] as const) if (key in body) input[key] = body[key];
      try {
        const result = await engine.reconfigure(MINECRAFT_ID, input);
        app.events?.add('info', 'Minecraft: Einstellungen geändert');
        return result;
      } finally {
        app.hub.broadcast({ type: 'apps', data: await engine.list().catch(() => []) });
      }
    });
  };
}

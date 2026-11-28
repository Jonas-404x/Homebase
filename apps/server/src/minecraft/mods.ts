import fs from 'node:fs/promises';
import path from 'node:path';
import type { MinecraftMod } from '@mainframe/shared';
import { MainframeError } from '../errors.ts';

const NAME = /^[A-Za-z0-9._+() -]+\.jar$/;

/** Nur normale .jar-Namen, nie ein Pfad (kein "..", kein "/"). */
export function checkModName(name: string): string {
  if (!NAME.test(name) || name.includes('..') || name.startsWith('.')) {
    throw new MainframeError('invalid_name', 'Nur .jar-Dateien mit normalem Namen.', 400);
  }
  return name;
}

export async function listMods(dir: string): Promise<MinecraftMod[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const jars = entries.filter((e) => e.isFile() && e.name.endsWith('.jar'));
  const mods = await Promise.all(jars.map(async (e) => ({ name: e.name, size: (await fs.stat(path.join(dir, e.name))).size })));
  return mods.sort((a, b) => a.name.localeCompare(b.name));
}

/** Schreibt erst in eine Hilfsdatei und benennt dann um: der Server sieht nie eine halbe Datei. */
export async function saveMod(dir: string, name: string, data: Buffer, ownerOf?: string): Promise<void> {
  const target = path.join(dir, checkModName(name));
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${target}.upload`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, target);
  // Mainframe läuft auf dem Server als root, Minecraft als UID 1000: Besitzer des Datenordners übernehmen.
  if (ownerOf && process.platform === 'linux') {
    try {
      const st = await fs.stat(ownerOf);
      await fs.chown(dir, st.uid, st.gid);
      await fs.chown(target, st.uid, st.gid);
    } catch {
      // nur ein Versuch, das Hochladen soll daran nicht scheitern
    }
  }
}

export async function deleteMod(dir: string, name: string): Promise<void> {
  const target = path.join(dir, checkModName(name));
  try {
    await fs.rm(target);
  } catch {
    throw new MainframeError('not_found', 'Diese Datei gibt es nicht.', 404);
  }
}

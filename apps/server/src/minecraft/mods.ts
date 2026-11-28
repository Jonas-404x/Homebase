import { randomUUID } from 'node:crypto';
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
  // Der Ordner gehört dem Minecraft-Container: ein dort angelegter Symlink darf Mainframe (root)
  // nicht woandershin schreiben lassen. Darum kein Symlink als Ordner und eine frische Hilfsdatei
  // mit Zufallsnamen, die exklusiv angelegt wird ("wx" folgt keinem vorhandenen Eintrag).
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new MainframeError('invalid_dir', 'Der Mod-Ordner ist kein normaler Ordner.', 400);
  const tmp = path.join(dir, `.upload-${randomUUID()}`);
  try {
    await fs.writeFile(tmp, data, { flag: 'wx' });
    await fs.rename(tmp, target);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  // Mainframe läuft auf dem Server als root, Minecraft als UID 1000: Besitzer des Datenordners übernehmen.
  if (ownerOf && process.platform === 'linux') {
    try {
      const st = await fs.stat(ownerOf);
      // lchown folgt keinem Symlink
      await fs.lchown(dir, st.uid, st.gid);
      await fs.lchown(target, st.uid, st.gid);
    } catch {
      // nur ein Versuch, das Hochladen soll daran nicht scheitern
    }
  }
}

export async function deleteMod(dir: string, name: string): Promise<void> {
  const target = path.join(dir, checkModName(name));
  const st = await fs.lstat(dir).catch(() => null);
  if (st?.isSymbolicLink()) throw new MainframeError('invalid_dir', 'Der Mod-Ordner ist kein normaler Ordner.', 400);
  try {
    await fs.rm(target);
  } catch {
    throw new MainframeError('not_found', 'Diese Datei gibt es nicht.', 404);
  }
}

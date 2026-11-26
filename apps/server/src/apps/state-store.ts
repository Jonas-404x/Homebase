import fs from 'node:fs/promises';
import path from 'node:path';

export interface AppStateFile {
  id: string;
  values: Record<string, string>;
  installedAt: string;
  lastError: string | null;
  /** Von dir über Mainframe angehalten: dann ist ein beendeter Container kein Fehler. */
  stoppedByUser?: boolean;
}

export interface StateStore {
  list(): Promise<AppStateFile[]>;
  get(id: string): Promise<AppStateFile | null>;
  save(s: AppStateFile): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Ein JSON pro App unter <dataRoot>/apps/<id>/app-state.json. */
export function createStateStore(dataRoot: string): StateStore {
  const appsDir = path.join(dataRoot, 'apps');
  const file = (id: string) => path.join(appsDir, id, 'app-state.json');

  const get = async (id: string): Promise<AppStateFile | null> => {
    try {
      return JSON.parse(await fs.readFile(file(id), 'utf8')) as AppStateFile;
    } catch {
      return null;
    }
  };

  return {
    get,
    async list() {
      let dirs: string[] = [];
      try {
        dirs = (await fs.readdir(appsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
      } catch {
        return [];
      }
      const all = await Promise.all(dirs.sort().map(get));
      return all.filter((s): s is AppStateFile => s !== null);
    },
    async save(s) {
      await fs.mkdir(path.dirname(file(s.id)), { recursive: true });
      const tmp = `${file(s.id)}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(s, null, 2));
      await fs.rename(tmp, file(s.id));
    },
    async remove(id) {
      await fs.rm(file(id), { force: true });
    },
  };
}

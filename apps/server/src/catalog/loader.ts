import fs from 'node:fs/promises';
import path from 'node:path';
import { catalogAppSchema, type CatalogApp } from '@mainframe/shared';
import { MainframeError } from '../errors.ts';

export interface CatalogEntry {
  app: CatalogApp;
  composeTemplate: string;
  dir: string;
}

/** Liest alle Unterordner mit app.json + compose.yml. */
export async function loadCatalog(dir: string): Promise<CatalogEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: CatalogEntry[] = [];
  for (const e of entries.filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const appDir = path.join(dir, e.name);
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(appDir, 'app.json'), 'utf8'));
      const app = catalogAppSchema.parse(manifest);
      const composeTemplate = await fs.readFile(path.join(appDir, 'compose.yml'), 'utf8');
      result.push({ app, composeTemplate, dir: appDir });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new MainframeError('catalog_invalid', `Katalog-Eintrag "${e.name}" ist kaputt: ${detail}`, 500);
    }
  }
  return result;
}

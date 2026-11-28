import { MainframeError } from '../errors.ts';

export const MINECRAFT_ID = 'minecraft';
export const PERF_MODS = ['fabric-api', 'lithium', 'ferrite-core', 'krypton'] as const;
export const USER_AGENT = 'Mainframe (self-hosted home server)';

export async function fetchReleases(fetchImpl: typeof fetch): Promise<string[]> {
  try {
    const response = await fetchImpl('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
      headers: { 'user-agent': USER_AGENT },
    });
    if (!response.ok) throw new Error('Versionsliste nicht erreichbar');
    const manifest = await response.json() as { versions: { id: string; type: string }[] };
    return manifest.versions.filter((version) => version.type === 'release').map((version) => version.id);
  } catch {
    throw new MainframeError('versions_unavailable', 'Die Versionsliste ist gerade nicht erreichbar.', 502);
  }
}

export async function availablePerfMods(
  version: string,
  fetchImpl: typeof fetch,
  timeoutMs = 5000,
): Promise<{ ok: string[]; skipped: string[] }> {
  const available = await Promise.all(PERF_MODS.map(async (id) => {
    try {
      const response = await fetchImpl(
        `https://api.modrinth.com/v2/project/${id}/version?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([version]))}`,
        { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) },
      );
      if (!response.ok) return false;
      const versions: unknown = await response.json();
      return Array.isArray(versions) && versions.length > 0;
    } catch {
      return false;
    }
  }));

  // Alle Mods brauchen die Fabric-API.
  if (!available[0]) return { ok: [], skipped: [...PERF_MODS] };
  return {
    ok: PERF_MODS.filter((_, index) => available[index]),
    skipped: PERF_MODS.filter((_, index) => !available[index]),
  };
}

export function createMinecraftPrepare(deps: {
  fetchImpl: typeof fetch;
  releases: () => Promise<string[]>;
}): (values: Record<string, string>, ctx: { previous: Record<string, string> | null }) => Promise<Record<string, string>> {
  return async (values, ctx) => {
    const { serverType, version, memory, eula } = values;
    if (serverType !== 'PAPER' && serverType !== 'FABRIC') {
      throw new MainframeError('invalid_input', 'Server-Typ muss Paper oder Fabric sein.');
    }
    if (!/^\d+(\.\d+){1,2}$/.test(version)) {
      throw new MainframeError('invalid_input', 'Diese Minecraft-Version gibt es nicht.');
    }
    if (!['2G', '3G', '4G', '5G', '6G'].includes(memory)) {
      throw new MainframeError('invalid_input', 'RAM muss zwischen 2 und 6 GB liegen.');
    }
    if (eula !== 'true') {
      throw new MainframeError('invalid_input', 'Bitte akzeptiere die Minecraft-EULA.');
    }

    const previousVersion = ctx.previous?.version;
    if (previousVersion && previousVersion !== version) {
      let releases: string[] = [];
      try {
        releases = await deps.releases();
      } catch {
        // Ohne Versionsliste entfällt die Downgrade-Prüfung.
      }
      const previousIndex = releases.indexOf(previousVersion);
      const nextIndex = releases.indexOf(version);
      if (previousIndex !== -1 && nextIndex !== -1 && nextIndex > previousIndex) {
        throw new MainframeError('downgrade', 'Ältere Versionen können deine Welt kaputt machen.', 400);
      }
    }

    const mods = serverType === 'FABRIC' && values.perfMods === 'true'
      ? await availablePerfMods(version, deps.fetchImpl)
      : { ok: [], skipped: [] };
    return { ...values, modrinthProjects: mods.ok.join(','), modrinthSkipped: mods.skipped.join(',') };
  };
}

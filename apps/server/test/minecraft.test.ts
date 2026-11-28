import { describe, expect, it, vi } from 'vitest';
import { MainframeError } from '../src/errors.ts';
import { availablePerfMods, createMinecraftPrepare, fetchReleases, PERF_MODS, USER_AGENT } from '../src/minecraft/logic.ts';

function modFetch(responses: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(async (input) => {
    const id = new URL(String(input)).pathname.split('/')[3];
    return Response.json(responses[id] ?? [{ id: 'passende-version' }]);
  });
}

describe('Minecraft-Versionsliste', () => {
  it('filtert Snapshots und behält die Reihenfolge der Releases', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ versions: [
      { id: '26.4-snapshot-1', type: 'snapshot' },
      { id: '26.3', type: 'release' },
      { id: '26.2', type: 'release' },
      { id: '26.1-snapshot-1', type: 'snapshot' },
      { id: '26.1', type: 'release' },
    ] }));
    expect(await fetchReleases(fetchImpl)).toEqual(['26.3', '26.2', '26.1']);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    expect(new Headers(init?.headers).get('user-agent')).toBe(USER_AGENT);
  });

  it('meldet bei HTTP 500 einen Fehler mit Status 502', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('', { status: 500 }));
    await expect(fetchReleases(fetchImpl)).rejects.toMatchObject({
      name: 'MainframeError', code: 'versions_unavailable',
      message: 'Die Versionsliste ist gerade nicht erreichbar.', status: 502,
    });
  });

  it('meldet Netzwerkfehler als nicht erreichbare Versionsliste', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    await expect(fetchReleases(fetchImpl)).rejects.toMatchObject({ code: 'versions_unavailable', status: 502 });
  });
});

describe('Minecraft-Performance-Mods', () => {
  it('überspringt Krypton ohne passende Version und behält die Mod-Reihenfolge', async () => {
    expect(await availablePerfMods('26.3', modFetch({ krypton: [] }))).toEqual({
      ok: ['fabric-api', 'lithium', 'ferrite-core'], skipped: ['krypton'],
    });
  });

  it('überspringt bei Netzwerkfehlern alle Mods', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    expect(await availablePerfMods('26.3', fetchImpl)).toEqual({ ok: [], skipped: [...PERF_MODS] });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('überspringt ohne Fabric-API auch alle anderen Mods', async () => {
    expect(await availablePerfMods('26.3', modFetch({ 'fabric-api': [] }))).toEqual({
      ok: [], skipped: [...PERF_MODS],
    });
  });

  it('sendet kodierte Versionsfilter und den User-Agent bei jeder Anfrage', async () => {
    const fetchImpl = modFetch();
    await availablePerfMods('26.3', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    fetchImpl.mock.calls.forEach(([url, init], index) => {
      expect(String(url)).toBe(
        `https://api.modrinth.com/v2/project/${PERF_MODS[index]}/version?loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent('["26.3"]')}`,
      );
      expect(new Headers(init?.headers).get('user-agent')).toBe(USER_AGENT);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  it('startet alle Anfragen parallel und behält bei umgekehrter Antwortfolge die Reihenfolge', async () => {
    const pending: ((response: Response) => void)[] = [];
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => pending.push(resolve)));
    const result = availablePerfMods('26.3', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    pending.reverse().forEach((resolve) => resolve(Response.json([{}])));
    expect(await result).toEqual({ ok: [...PERF_MODS], skipped: [] });
  });

  it('überspringt Mods bei HTTP-Fehlern und ungültigen Antworten', async () => {
    const fetchImpl = modFetch();
    fetchImpl.mockResolvedValueOnce(Response.json([{}]))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ id: 'keine-liste' }))
      .mockResolvedValueOnce(new Response('kein JSON'));
    expect(await availablePerfMods('26.3', fetchImpl)).toEqual({
      ok: ['fabric-api'], skipped: ['lithium', 'ferrite-core', 'krypton'],
    });
  });

  it('überspringt Mods nach Ablauf des übergebenen Zeitlimits', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    try {
      const fetchImpl = vi.fn<typeof fetch>((_, init) => new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }));
      const result = availablePerfMods('26.3', fetchImpl, 25);
      expect(timeout).toHaveBeenCalledTimes(4);
      expect(timeout).toHaveBeenCalledWith(25);
      controller.abort(new DOMException('Zeitlimit erreicht', 'TimeoutError'));
      expect(await result).toEqual({ ok: [], skipped: [...PERF_MODS] });
    } finally {
      timeout.mockRestore();
    }
  });
});

describe('Minecraft-Vorbereitung', () => {
  const values = { serverType: 'FABRIC', version: '26.3', memory: '4G', eula: 'true', perfMods: 'true' };
  const ctx = { previous: null };

  function setup() {
    const fetchImpl = modFetch({ krypton: [] });
    const releases = vi.fn(async () => ['26.3', '26.2', '26.1']);
    return { fetchImpl, releases, prepare: createMinecraftPrepare({ fetchImpl, releases }) };
  }

  it('ergänzt für Fabric die verfügbaren Mods und übersprungenes Krypton', async () => {
    const { prepare, releases } = setup();
    expect(await prepare(values, ctx)).toEqual({
      ...values, modrinthProjects: 'fabric-api,lithium,ferrite-core', modrinthSkipped: 'krypton',
    });
    expect(releases).not.toHaveBeenCalled();
  });

  it('leert bei Paper die Mod-Felder ohne Netzwerkanfrage', async () => {
    const { prepare, fetchImpl } = setup();
    const paper = { ...values, serverType: 'PAPER', modrinthProjects: 'alt', modrinthSkipped: 'alt' };
    expect(await prepare(paper, ctx)).toEqual({ ...paper, modrinthProjects: '', modrinthSkipped: '' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fragt ohne aktivierte Performance-Mods keine Mods ab', async () => {
    const { prepare, fetchImpl } = setup();
    expect(await prepare({ ...values, perfMods: 'false' }, ctx)).toMatchObject({ modrinthProjects: '', modrinthSkipped: '' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['eula', 'false', 'Bitte akzeptiere die Minecraft-EULA.'],
    ['memory', '12G', 'RAM muss zwischen 2 und 6 GB liegen.'],
    ['serverType', 'FORGE', 'Server-Typ muss Paper oder Fabric sein.'],
    ['version', 'abc', 'Diese Minecraft-Version gibt es nicht.'],
  ])('weist ungültige Eingaben für %s zurück', async (field, value, message) => {
    const { prepare, fetchImpl, releases } = setup();
    const result = prepare({ ...values, [field]: value }, ctx);
    await expect(result).rejects.toBeInstanceOf(MainframeError);
    await expect(result).rejects.toMatchObject({ code: 'invalid_input', message, status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(releases).not.toHaveBeenCalled();
  });

  it('verhindert den Downgrade von 26.3 auf 26.1', async () => {
    const { prepare, fetchImpl, releases } = setup();
    await expect(prepare({ ...values, version: '26.1' }, { previous: { version: '26.3' } })).rejects.toMatchObject({
      code: 'downgrade', message: 'Ältere Versionen können deine Welt kaputt machen.', status: 400,
    });
    expect(releases).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('erlaubt das Upgrade von 26.1 auf 26.3', async () => {
    const { prepare } = setup();
    await expect(prepare(values, { previous: { version: '26.1' } })).resolves.toMatchObject({ version: '26.3' });
  });

  it('erlaubt einen Wechsel bei unbekannter vorheriger Version', async () => {
    const { prepare } = setup();
    await expect(prepare(values, { previous: { version: '25.1' } })).resolves.toMatchObject({ version: '26.3' });
  });

  it('erlaubt einen Wechsel bei unbekannter neuer Version', async () => {
    const { prepare } = setup();
    await expect(prepare({ ...values, version: '25.1' }, { previous: { version: '26.3' } })).resolves.toMatchObject({ version: '25.1' });
  });

  it('überspringt die Downgrade-Prüfung bei nicht erreichbarer Versionsliste', async () => {
    const { prepare, releases } = setup();
    releases.mockRejectedValueOnce(new Error('offline'));
    await expect(prepare({ ...values, version: '26.1' }, { previous: { version: '26.3' } })).resolves.toMatchObject({ version: '26.1' });
  });

  it('fragt bei unveränderter Version keine Versionsliste ab', async () => {
    const { prepare, releases } = setup();
    await prepare(values, { previous: { version: '26.3' } });
    expect(releases).not.toHaveBeenCalled();
  });
});

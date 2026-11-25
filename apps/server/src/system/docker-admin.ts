import Docker from 'dockerode';
import type { DockerUsage, DockerUsageItem } from '@mainframe/shared';

/** Docker-Infos und Aufräumen. Jede Methode liefert null, wenn Docker nicht läuft. */
export interface DockerAdmin {
  info(): Promise<{ version: string; containers: number; images: number } | null>;
  diskUsage(): Promise<DockerUsage | null>;
  prune(): Promise<{ reclaimedBytes: number } | null>;
}

const sum = (list: number[]) => list.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

function item<T>(list: T[] | null | undefined, size: (x: T) => number, unused: (x: T) => boolean): DockerUsageItem {
  const l = list ?? [];
  return { count: l.length, bytes: sum(l.map(size)), reclaimableBytes: sum(l.filter(unused).map(size)) };
}

type DfImage = { Size: number; Containers: number };
type DfContainer = { SizeRw?: number; State: string };
type DfVolume = { UsageData?: { Size: number; RefCount: number } };
type DfBuild = { Size: number; InUse: boolean };

export function createDockerAdmin(docker: Docker = new Docker()): DockerAdmin {
  const safe = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      await docker.ping();
    } catch {
      return null;
    }
    return fn();
  };
  return {
    info: () =>
      safe(async () => {
        const [v, i] = await Promise.all([docker.version(), docker.info()]);
        return { version: String(v.Version), containers: Number(i.Containers ?? 0), images: Number(i.Images ?? 0) };
      }),
    diskUsage: () =>
      safe(async () => {
        const df = (await docker.df()) as { Images?: DfImage[]; Containers?: DfContainer[]; Volumes?: DfVolume[]; BuildCache?: DfBuild[] };
        return {
          images: item(df.Images, (x) => x.Size, (x) => x.Containers === 0),
          containers: item(df.Containers, (x) => x.SizeRw ?? 0, (x) => x.State !== 'running'),
          volumes: item(df.Volumes, (x) => Math.max(0, x.UsageData?.Size ?? 0), (x) => (x.UsageData?.RefCount ?? 0) === 0),
          buildCache: item(df.BuildCache, (x) => x.Size, (x) => !x.InUse),
        };
      }),
    prune: () =>
      safe(async () => {
        // Nur Images ohne Container und Build-Reste. Volumes (Daten der Apps) bleiben immer.
        const images = await docker.pruneImages({ filters: { dangling: { false: true } } });
        const builder = await docker.pruneBuilder().catch(() => ({ SpaceReclaimed: 0 }));
        return { reclaimedBytes: Number(images.SpaceReclaimed ?? 0) + Number(builder.SpaceReclaimed ?? 0) };
      }),
  };
}

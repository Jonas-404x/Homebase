import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import { cpuPercent, memBytes, type DfLike, type StatsLike } from './usage.ts';

export const APP_LABEL = 'mainframe.app';

export type Health = 'healthy' | 'unhealthy' | 'starting' | null;

/** Ein Container einer App, wie ihn die Diagnose braucht. */
export interface ContainerInfo {
  name: string;
  state: string;
  health: Health;
  restartCount: number;
  exitCode: number;
  oomKilled: boolean;
  startedAt: string | null;
  /** Veröffentlichte Ports am Rechner (TCP). */
  ports: number[];
}

export interface AppInspect {
  containers: ContainerInfo[];
  /** Die letzten Log-Zeilen aller Container der App. */
  logs: string[];
}

export interface DockerStatus {
  ping(): Promise<boolean>;
  containersByApp(): Promise<Map<string, { state: string; health?: Health }[]>>;
  followLogs(appId: string, onLine: (line: string) => void): Promise<() => void>;
  /** CPU und RAM pro App (alle Container zusammen). */
  usage(): Promise<Map<string, { cpuPercent: number; memBytes: number }>>;
  /** Speicherbelegung wie `docker system df` (langsam). */
  df(): Promise<DfLike>;
  inspect(appId: string): Promise<AppInspect>;
}

/** Liest den Gesundheits-Zustand aus dem Status-Text der Container-Liste, z. B. "Up 5 minutes (unhealthy)". */
export function healthFromStatus(status: string | undefined): Health {
  const m = /\((healthy|unhealthy|health: starting)\)/.exec(status ?? '');
  if (!m) return null;
  return m[1] === 'health: starting' ? 'starting' : (m[1] as 'healthy' | 'unhealthy');
}

/** Trennt die gemischte stdout/stderr-Ausgabe von `docker logs` in Zeilen. */
function demuxLines(buf: Buffer): string[] {
  const out: string[] = [];
  let i = 0;
  // Format: 8 Byte Kopf (Stream, 3 x 0, Länge als uint32 BE), dann die Daten.
  while (i + 8 <= buf.length && (buf[i] === 1 || buf[i] === 2) && buf[i + 1] === 0) {
    const len = buf.readUInt32BE(i + 4);
    out.push(buf.subarray(i + 8, i + 8 + len).toString('utf8'));
    i += 8 + len;
  }
  const text = i === 0 ? buf.toString('utf8') : out.join('');
  return text.split(/\r?\n/).filter((l) => l.trim() !== '');
}

export function createDockerStatus(docker: Docker = new Docker()): DockerStatus {
  return {
    async ping() {
      try {
        await docker.ping();
        return true;
      } catch {
        return false;
      }
    },

    async containersByApp() {
      const list = await docker.listContainers({ all: true, filters: { label: [APP_LABEL] } });
      const map = new Map<string, { state: string; health?: Health }[]>();
      for (const c of list) {
        const id = c.Labels[APP_LABEL];
        if (!id) continue;
        map.set(id, [...(map.get(id) ?? []), { state: c.State, health: healthFromStatus(c.Status) }]);
      }
      return map;
    },

    async usage() {
      const list = await docker.listContainers({ filters: { label: [APP_LABEL], status: ['running'] } });
      const map = new Map<string, { cpuPercent: number; memBytes: number }>();
      await Promise.all(
        list.map(async (c) => {
          const id = c.Labels[APP_LABEL];
          if (!id) return;
          const s = (await docker.getContainer(c.Id).stats({ stream: false }).catch(() => ({}))) as StatsLike;
          const prev = map.get(id) ?? { cpuPercent: 0, memBytes: 0 };
          map.set(id, { cpuPercent: Math.round((prev.cpuPercent + cpuPercent(s)) * 10) / 10, memBytes: prev.memBytes + memBytes(s) });
        }),
      );
      return map;
    },

    async df() {
      return (await docker.df()) as DfLike;
    },

    async inspect(appId) {
      const list = await docker.listContainers({ all: true, filters: { label: [`${APP_LABEL}=${appId}`] } });
      const containers: ContainerInfo[] = [];
      const logs: string[] = [];
      for (const c of list) {
        const container = docker.getContainer(c.Id);
        const info = await container.inspect();
        containers.push({
          name: info.Name.replace(/^\//, ''),
          state: info.State.Status,
          health: (info.State.Health?.Status as Health | undefined) ?? null,
          restartCount: info.RestartCount ?? 0,
          exitCode: info.State.ExitCode ?? 0,
          oomKilled: Boolean(info.State.OOMKilled),
          startedAt: info.State.StartedAt && !info.State.StartedAt.startsWith('0001') ? info.State.StartedAt : null,
          ports: [...new Set((c.Ports ?? []).filter((p) => p.Type === 'tcp' && p.PublicPort).map((p) => p.PublicPort))],
        });
        const raw = (await container.logs({ stdout: true, stderr: true, tail: 50, follow: false }).catch(() => Buffer.alloc(0))) as unknown as Buffer;
        logs.push(...demuxLines(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))));
      }
      return { containers, logs: logs.slice(-50) };
    },

    async followLogs(appId, onLine) {
      const list = await docker.listContainers({ all: true, filters: { label: [`${APP_LABEL}=${appId}`] } });
      const streams: NodeJS.ReadableStream[] = [];
      for (const c of list) {
        const container = docker.getContainer(c.Id);
        const raw = (await container.logs({ follow: true, stdout: true, stderr: true, tail: 200 })) as NodeJS.ReadableStream;
        const out = new PassThrough();
        docker.modem.demuxStream(raw, out, out);
        let buf = '';
        out.on('data', (chunk: Buffer) => {
          buf += chunk.toString('utf8');
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? '';
          for (const l of lines) onLine(l);
        });
        streams.push(raw);
      }
      return () => {
        for (const s of streams) (s as unknown as { destroy?: () => void }).destroy?.();
      };
    },
  };
}

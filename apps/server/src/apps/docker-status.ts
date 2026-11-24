import { PassThrough } from 'node:stream';
import Docker from 'dockerode';

export const APP_LABEL = 'mainframe.app';

export interface DockerStatus {
  ping(): Promise<boolean>;
  containersByApp(): Promise<Map<string, { state: string }[]>>;
  followLogs(appId: string, onLine: (line: string) => void): Promise<() => void>;
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
      const map = new Map<string, { state: string }[]>();
      for (const c of list) {
        const id = c.Labels[APP_LABEL];
        if (!id) continue;
        map.set(id, [...(map.get(id) ?? []), { state: c.State }]);
      }
      return map;
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

import path from 'node:path';
import { execa } from 'execa';

export interface ComposeRunner {
  /** noStart: Container nur anlegen (z. B. nach dem Ändern einer angehaltenen App). */
  up(projectDir: string, opts?: { noStart?: boolean }): Promise<void>;
  down(projectDir: string, opts?: { volumes?: boolean }): Promise<void>;
  start(projectDir: string): Promise<void>;
  stop(projectDir: string): Promise<void>;
  restart(projectDir: string): Promise<void>;
  /** Befehl in einem laufenden Dienst ausführen, gibt stdout zurück. */
  exec(projectDir: string, service: string, args: string[]): Promise<string>;
}

/** Ruft die docker-compose-CLI auf. Fehlermeldungen enthalten stderr. */
export function createComposeRunner(): ComposeRunner {
  const run = async (projectDir: string, args: string[]) => {
    const file = path.join(projectDir, 'docker-compose.yml');
    const res = await execa('docker', ['compose', '-f', file, '--project-directory', projectDir, ...args], {
      reject: false,
      all: true,
    });
    if (res.exitCode !== 0) throw new Error((res.stderr || res.all || `docker compose ${args[0]} fehlgeschlagen`).trim());
    return String(res.stdout ?? '');
  };
  return {
    up: async (d, opts) => void (await run(d, opts?.noStart ? ['up', '--no-start', '--remove-orphans'] : ['up', '-d', '--remove-orphans'])),
    down: async (d, opts) => void (await run(d, ['down', ...(opts?.volumes ? ['-v'] : [])])),
    start: async (d) => void (await run(d, ['start'])),
    stop: async (d) => void (await run(d, ['stop'])),
    restart: async (d) => void (await run(d, ['restart'])),
    exec: (d, service, args) => run(d, ['exec', '-T', service, ...args]),
  };
}

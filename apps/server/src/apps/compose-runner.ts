import path from 'node:path';
import { execa } from 'execa';

export interface ComposeRunner {
  up(projectDir: string): Promise<void>;
  down(projectDir: string, opts?: { volumes?: boolean }): Promise<void>;
  start(projectDir: string): Promise<void>;
  stop(projectDir: string): Promise<void>;
  restart(projectDir: string): Promise<void>;
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
  };
  return {
    up: (d) => run(d, ['up', '-d', '--remove-orphans']),
    down: (d, opts) => run(d, ['down', ...(opts?.volumes ? ['-v'] : [])]),
    start: (d) => run(d, ['start']),
    stop: (d) => run(d, ['stop']),
    restart: (d) => run(d, ['restart']),
  };
}

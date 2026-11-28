import { describe, expect, it } from 'vitest';
import { createRealShareSystem } from '../src/share/system.ts';

describe('echtes ShareSystem', () => {
  it('stürzt nicht ab, wenn ein Programm mit stdin fehlt', async () => {
    const sys = createRealShareSystem();
    await expect(sys.run('mainframe-gibt-es-nicht', [], 'x\n'.repeat(100_000))).rejects.toMatchObject({ code: 'share_command_failed' });
  });
});

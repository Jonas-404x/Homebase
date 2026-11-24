import { describe, expect, it } from 'vitest';
import { catalogAppSchema } from '@homebase/shared';

const valid = { id: 'adguard', name: 'AdGuard Home', description: 'x', icon: 'shield', fields: [], ports: [] };

describe('catalogAppSchema', () => {
  it('akzeptiert ein gültiges Manifest', () => {
    expect(catalogAppSchema.parse(valid).id).toBe('adguard');
  });

  it('lehnt IDs mit Leerzeichen und Großbuchstaben ab', () => {
    expect(() => catalogAppSchema.parse({ ...valid, id: 'Ad Guard' })).toThrow();
  });

  it('lehnt doppelte Schlüssel zwischen Feldern und Ports ab', () => {
    const dup = {
      ...valid,
      fields: [{ key: 'web', label: 'Web', type: 'string', required: false }],
      ports: [{ key: 'web', label: 'Web', container: 3000, protocol: 'tcp', default: 3000 }],
    };
    expect(() => catalogAppSchema.parse(dup)).toThrow();
  });
});

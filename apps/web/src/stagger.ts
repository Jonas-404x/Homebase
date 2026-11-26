import type { CSSProperties } from 'react';

/** Versatz fürs erste Erscheinen einer Liste: 30 ms pro Zeile, ab der neunten nicht mehr länger. */
export function stagger(index: number): CSSProperties {
  return { '--stagger': `${Math.min(index, 8) * 30}ms` } as CSSProperties;
}

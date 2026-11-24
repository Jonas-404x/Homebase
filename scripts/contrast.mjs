// Prüft die Kontraste der Design-Tokens (WCAG). Aufruf: node scripts/contrast.mjs
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../apps/web/src/styles/tokens.css', import.meta.url), 'utf8');
const [dark, light] = css.split('@media (prefers-color-scheme: light)');
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const pairs = [
  ['text', 'surface', 4.5], ['text', 'surface-raised', 4.5], ['text-secondary', 'surface', 4.5], ['text-secondary', 'surface-raised', 4.5],
  ['accent-on', 'accent', 4.5], ['accent-text', 'surface-raised', 4.5], ['accent-text', 'accent-soft', 4.5], ['accent-text', 'surface', 4.5],
  ['danger', 'surface-raised', 4.5], ['danger', 'danger-soft', 4.5], ['ok', 'surface-raised', 4.5], ['warn', 'surface-raised', 3], ['text', 'warn-soft', 4.5],
  ['text', 'surface-sunken', 4.5],
];
let fail = 0;
for (const [name, t] of [['dunkel', tokens(dark)], ['hell', tokens(light)]]) {
  for (const [fg, bg, min] of pairs) {
    const r = ratio(t[fg], t[bg]);
    const ok = r >= min;
    if (!ok) fail++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(6)} ${fg} auf ${bg}: ${r.toFixed(2)}:1 (min ${min})`);
  }
}
process.exit(fail ? 1 : 0);

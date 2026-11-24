import { randomInt } from 'node:crypto';
import { parse, stringify } from 'yaml';
import type { CatalogApp } from '@mainframe/shared';
import { MainframeError } from '../errors.ts';

export interface RenderContext {
  appId: string;
  appDataDir: string;
  dev: boolean;
}

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePassword(len = 20): string {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** Macht aus Formular-Eingaben fertige Strings für Felder und Ports. */
export function resolveValues(app: CatalogApp, input: Record<string, unknown>, dev: boolean): Record<string, string> {
  const out: Record<string, string> = {};

  for (const f of app.fields) {
    const raw = input[f.key];
    const empty = raw === undefined || raw === null || raw === '';
    if (!empty) out[f.key] = String(raw);
    else if (f.generate === 'password') out[f.key] = generatePassword();
    else if (f.default !== undefined) out[f.key] = String(f.default);
    else if (f.required) throw new MainframeError('field_required', `${f.label} fehlt noch.`);
    else out[f.key] = '';
  }

  for (const p of app.ports) {
    const raw = input[p.key];
    const value = raw === undefined || raw === null || raw === '' ? (dev ? (p.devDefault ?? p.default) : p.default) : Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      throw new MainframeError('port_invalid', `${p.label}: ${String(raw)} ist kein gültiger Port (1–65535).`);
    }
    out[p.key] = String(value);
  }

  return out;
}

/** Escaped für das Einsetzen in einen YAML-String in doppelten Anführungszeichen. */
function escape(v: string): string {
  return v.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function renderCompose(template: string, values: Record<string, string>, ctx: RenderContext): string {
  const filled = template.replace(/\$\{([a-zA-Z]+)\.([a-zA-Z0-9]+)\}/g, (whole, scope: string, key: string) => {
    if (scope === 'app' && key === 'dataDir') return escape(ctx.appDataDir.replaceAll('\\', '/'));
    if (scope === 'app' && key === 'id') return ctx.appId;
    if ((scope === 'field' || scope === 'port') && key in values) return escape(values[key]!);
    throw new MainframeError('template_unknown_placeholder', `Unbekannter Platzhalter in der Vorlage: ${whole}`, 500);
  });
  if (/\$\{[^}]*\}/.test(filled)) {
    const m = filled.match(/\$\{[^}]*\}/)!;
    throw new MainframeError('template_unknown_placeholder', `Unbekannter Platzhalter in der Vorlage: ${m[0]}`, 500);
  }

  const doc = parse(filled) as { name?: string; services?: Record<string, Record<string, unknown>> };
  doc.name = `mf-${ctx.appId}`;
  for (const svc of Object.values(doc.services ?? {})) {
    svc.restart = 'unless-stopped';
    const labels = (svc.labels ?? {}) as Record<string, string>;
    svc.labels = { ...labels, 'mainframe.app': ctx.appId };
  }
  return stringify(doc);
}

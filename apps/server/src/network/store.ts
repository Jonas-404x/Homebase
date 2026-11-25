import type { Db } from '../db.ts';

export interface DeviceRow {
  mac: string;
  ip: string;
  hostname: string | null;
  vendor: string | null;
  name: string;
  note: string;
  /** Vom Benutzer als bekannt markiert; sonst gilt das Gerät als „Neu“. */
  known: boolean;
  firstSeen: number;
  lastSeen: number;
}

/** Inventar der Geräte im Heimnetz, nach MAC-Adresse. */
export function createDeviceStore(db: Db) {
  const q = {
    get: db.sql.prepare('SELECT mac FROM devices WHERE mac = ?'),
    insert: db.sql.prepare('INSERT INTO devices (mac, ip, hostname, vendor, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)'),
    seen: db.sql.prepare('UPDATE devices SET ip = ?, hostname = COALESCE(?, hostname), vendor = COALESCE(?, vendor), last_seen = ? WHERE mac = ?'),
    list: db.sql.prepare('SELECT * FROM devices ORDER BY last_seen DESC, ip'),
    one: db.sql.prepare('SELECT * FROM devices WHERE mac = ?'),
    update: db.sql.prepare('UPDATE devices SET name = ?, note = ?, known = ? WHERE mac = ?'),
  };
  type Row = { mac: string; ip: string; hostname: string | null; vendor: string | null; name: string; note: string; known: number; first_seen: number; last_seen: number };
  const toDevice = (r: Row): DeviceRow => ({
    mac: r.mac,
    ip: r.ip,
    hostname: r.hostname,
    vendor: r.vendor,
    name: r.name,
    note: r.note,
    known: r.known === 1,
    firstSeen: Number(r.first_seen),
    lastSeen: Number(r.last_seen),
  });

  return {
    upsert(d: { mac: string; ip: string; hostname: string | null; vendor: string | null; seenAt: number }): { isNew: boolean } {
      if (q.get.get(d.mac)) {
        q.seen.run(d.ip, d.hostname, d.vendor, d.seenAt, d.mac);
        return { isNew: false };
      }
      q.insert.run(d.mac, d.ip, d.hostname, d.vendor, d.seenAt, d.seenAt);
      return { isNew: true };
    },
    list: () => (q.list.all() as Row[]).map(toDevice),
    update(mac: string, patch: { name?: string; note?: string; known?: boolean }): boolean {
      const cur = q.one.get(mac) as Row | undefined;
      if (!cur) return false;
      q.update.run(patch.name ?? cur.name, patch.note ?? cur.note, (patch.known ?? cur.known === 1) ? 1 : 0, mac);
      return true;
    },
  };
}
export type DeviceStore = ReturnType<typeof createDeviceStore>;

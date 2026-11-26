# Instrument Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every Mainframe screen the approved "Instrument" look while keeping behaviour, bars and sparklines.

**Architecture:** Almost all of it is CSS on the existing token system (`tokens.css`, `accents.css`, `base.css`). Three small behaviour additions get tests: the threshold marker on stat bars, the threshold line in the detail chart, and the live line above the status headline. Orange becomes the default accent.

**Tech Stack:** React 19, plain CSS, Vitest + Testing Library, `scripts/contrast.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-26-instrument-redesign-design.md`

## Global Constraints

- No new dependencies, no web fonts.
- Every accent passes `node scripts/contrast.mjs` in dark and light (text 4.5:1, warn 3:1).
- Roles, labels and texts used by existing tests stay unchanged; `npm test` and `npm run typecheck` stay green.
- Animations only inside `@media (prefers-reduced-motion: no-preference)`.
- UI text German; commits/docs English; nothing personal in Git.

## Review Focus

- Light mode: every surface and the accent still readable (system light theme) — check in the browser with `colorScheme: light`.
- Saved accent preference "blue" (old default) must still render a working blue theme.
- Compact density (`[data-density='compact']`) still fits the new stat grid without overflow.
- Phone width (375 px): stat grid, status headline and detail chart without horizontal scroll.
- Threshold marker/line absent when a metric has no threshold (network, uptime).

---

### Task 1: Palette, default accent, contrast

**Files:** Modify `apps/web/src/styles/tokens.css`, `apps/web/src/styles/accents.css`, `packages/shared/src/prefs.ts` (default `accent: 'orange'`, list order puts orange first), `apps/web/src/pages/settings/Appearance.tsx` only if labels need it. Test: existing prefs tests + contrast script.

- [ ] Warm graphite palette (hue ~60, hex values for the script): surface, surface-raised, surface-sunken, surface-hover, text, text-secondary; light theme neutral warm white.
- [ ] Orange as the token default (`--accent`, `--accent-on`, `--accent-text`, `--accent-soft`); add a `[data-accent='blue']` block; retune the other accents to the new surfaces.
- [ ] Run `node scripts/contrast.mjs` → exit 0; `npm test` green; commit.

### Task 2: Navigation rail and surfaces

**Files:** Modify `apps/web/src/styles/base.css` (nav, `.card`, settings list, dialogs, inputs).

- [ ] Rail: active item raised surface plus 3 px accent bar; cards borderless, depth by lightness; hairlines alpha.
- [ ] Settings icon tiles neutral (graphite tile, secondary icon), active row accent marker.
- [ ] Browser check dark + light; commit.

### Task 3: Overview — headline and instrument stat panel

**Files:** Modify `apps/web/src/components/StatusPanel.tsx`, `apps/web/src/components/StatCard.tsx`, `apps/web/src/pages/Overview.tsx`, `base.css`. Test: `apps/web/test/status.test.tsx`, `apps/web/test/overview.test.tsx`.

**Interfaces:** `StatCard` gains `threshold?: number` (0–100). Renders `<span className="meter-threshold" style={{ left: '<n>%' }} />` inside `.meter` when set.

- [ ] Test: stat card with `threshold={80}` renders `.meter-threshold` at `left: 80%`; without it none. Run → FAIL. Implement. Run → PASS.
- [ ] Test: status panel shows "Zuletzt geprüft um HH:MM" (time of the last successful load) above the summary heading. FAIL → implement → PASS.
- [ ] Overview passes `t.memory`, `t.disk`, `t.temperature` thresholds; CPU has none.
- [ ] CSS: summary as 34 px headline; stat grid as shared-edge panel (1 px gaps); big tabular values; bar with 10 % tick overlay; stagger kept.
- [ ] Commit.

### Task 4: Detail view

**Files:** Modify `apps/web/src/components/BigChart.tsx`, `apps/web/src/pages/Details.tsx`, `base.css`. Test: `apps/web/test/bigchart.test.tsx`, `apps/web/test/details.test.tsx`.

**Interfaces:** `BigChart` gains `threshold?: number`; draws `<line className="big-chart-threshold" …>` at that value when `threshold <= top`.

- [ ] Test threshold line present/absent. FAIL → implement → PASS.
- [ ] Details passes memory/temperature thresholds; header shows the live value large (tabular) under the title; summary min/avg/max as an instrument row.
- [ ] CSS for chart: accent line with soft area fill, tick axis, cursor readout; commit.

### Task 5: Remaining screens

**Files:** `base.css`, `apps/desktop/offline.html`.

- [ ] Services (tiles, bars, devices table, internet), Apps (rows, catalogue), Minecraft, settings panes, dialogs/drawers/palette, login: apply surfaces, type and accent rules.
- [ ] Offline page of the Windows app in the same palette.
- [ ] `npm test`, typecheck, contrast; browser pass on every page at desktop and 375 px, dark and light; commit.

### Task 6: Finish

- [ ] `impeccable detect --json --changed` clean; whole-branch review; CHANGELOG + README screenshots text if needed; PR, merge.

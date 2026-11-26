# Mainframe redesign: "Instrument"

Date: 2026-11-26 · Status: draft, waiting for Jonas' approval

## Intent

Jonas wants the whole Mainframe web interface (and with it the Windows app, which shows the same
pages) to look and feel noticeably better: "geil", with its own face instead of a template look.
Mainframe is a useful tool for one person, not a marketing site. Out of three mockups
(`.superpowers/brainstorm/…/richtungen.html`) he picked **A, "Instrument"**: like a good measuring
instrument, warm graphite, big calm numbers, one accent colour that marks where something is live.

His taste is written down in the `ui-polish` skill (no AI slop, one accent, strong hierarchy,
tactile motion, "don't stop when it works") and `apple-design` (platform conventions,
accessibility). Both apply.

## Goals

- Every screen gets the Instrument look: overview, details views, services (services, devices,
  internet), apps (installed and catalogue), Minecraft, settings (all panes), dialogs and sheets,
  log drawer, command palette, login/setup, the Windows app's offline page.
- **Overview metrics keep their bars and sparklines** (Jonas' explicit wish: "trotzdem diese
  Balken, so wie sie jetzt schon sind"). They are restyled to fit the instrument: big tabular
  numbers, the bar gets a fine tick scale (every 10 %) and a small marker at the warning
  threshold.
- **Tapping a metric opens a refined detail view** (today `/details/cpu`, `/details/memory`, …):
  a large live value, the chart bigger and clearer with a light tick axis, the warning threshold
  as a line, min/average/max for the chosen range, the range switcher as one segmented control.
  The move from tile to detail should feel connected (the value keeps its place where possible).
- The status panel becomes the page headline: one sentence that says how things are ("Alles
  läuft." / "Eine Sache braucht dich. Sonst läuft alles."), a small live line above it
  ("Läuft seit 6 Tagen · zuletzt geprüft vor 12 s"), the items that need attention below.
- Dark is the base, light follows the system (as today). Light becomes a neutral warm white,
  not cream.
- Works on phone and desktop as today (bottom tab bar on phones stays).

## Non-goals

- No new features and no behaviour changes beyond presentation. Texts stay unless a line only
  repeats a label (ui-polish "cut words") or the new headline needs it.
- No AI summary in this change (see "Later").
- No new dependencies, no web fonts (system UI font stays; it ships with Windows and is fast).

## Anti-goals (would make it a failure even if it works)

- Looks like a generic dark dashboard template: gradients, glow everywhere, neon, every card
  shouting in the accent colour.
- Harder to read or slower to use than today; contrast below WCAG AA anywhere.
- Motion that gets in the way (long, bouncy, or replayed on every 5-second refresh).

## Visual system (decided)

- **Palette** in OKLCH, tinted towards warm (hue ~60): background, two raised surfaces
  (depth by lightness, not shadows), text, secondary text, alpha hairlines. Values start from
  the approved mockup and are tuned until `scripts/contrast.mjs` passes for dark and light.
- **Accent: orange** (mockup A) becomes the default accent. It is used only for: primary
  buttons, the active navigation marker, focus rings, live values (e.g. network now) and the
  selected range. Everything else is neutral. ok/warn/danger stay semantic; red only for errors
  and destructive actions. The accent picker in Settings › Darstellung stays; its colours are
  retuned to the new palette. If the saved preference is still the old default ("blue"),
  Jonas can switch it there (builder's note: check whether the stored default should move).
- **Navigation:** left rail as in the mockup: logo on top, items with icon + label, active item
  on a raised surface with a short accent bar on the left; settings at the bottom.
- **Surfaces:** cards without borders, raised by lightness; groups of metrics share edges like
  an instrument panel (1 px hairline gaps) instead of separate floating boxes.
- **Type:** system UI; numbers always tabular; headline ~34 px semibold with tight tracking;
  secondary text one step lighter. Icons keep lucide, stroke matched to text weight.
- **Motion:** the existing tokens (`--ease-out`, `--dur-press`, `--dur-enter`), press scale
  0.97, entrances from 0.97, lists staggered once, popovers from their trigger, reduced motion
  respected.

## Constraints

- React 19 + plain CSS with tokens (`tokens.css`, `accents.css`, `base.css`); no CSS framework.
- `scripts/contrast.mjs` must pass for every accent in both themes.
- All existing tests stay green; test names/roles/labels the tests use stay (behaviour unchanged).
- Compact density mode and all display preferences keep working.
- Windows app needs no change beyond its offline page matching the new look.
- Nothing personal in commits (as always).

## Approaches considered

- **A Instrument** (picked by Jonas): warm graphite, tick scales, one orange accent.
- B Kontrollzentrum: translucent Apple-style tiles, rings. Not picked.
- C Fokus: top navigation, single column, light-first. Not picked.
- Inside A, Jonas changed one thing: metrics keep bars (not only tick scales), and the detail
  view on tap gets refined.

## Left to the builder

Exact token values, spacing per component, how the tick scale and threshold marker are drawn
(CSS gradient vs SVG), the order of pages, and how far the tile-to-detail transition goes
(a simple matched fade is fine if a shared-element move gets fragile).

## Later (separate work)

**AI summary of the status.** Today's "Eine Sache braucht dich" is rule-based, not AI. Jonas
would like a small, cheap AI (e.g. Google Gemini's free tier) to read the status and explain it.
This is its own feature (API key, what data leaves the house, cost, fallback when offline) and
fits the planned assistant (roadmap part 9). It gets its own design.

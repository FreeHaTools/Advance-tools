# Changelog

Versioning follows [semver](https://semver.org): MAJOR.MINOR.PATCH — new
features bump MINOR, fixes bump PATCH.

## 1.0.1

Fixes the **404 Not Found** you get from the sidebar page when the `domain`
option points at Home Assistant instead of at Advance Tools.

- The **Configuration tab now explains every option** in plain English. The
  `domain` field is labelled *"Public address of this add-on"* and says
  outright that Home Assistant's own address will not work there — that
  missing sentence was the whole bug.
- The **sidebar page verifies the domain** before using it. It fetches
  `<domain>/health`, and if anything other than Advance Tools answers it
  explains what went wrong, tells you where to fix it, and points the button
  at the local address instead of at a dead link.
- The add-on **runs the same check at start-up** and writes the result to its
  log, so the answer is already there when someone goes looking.
- `/health` now reports `app` and `version`, and allows cross-origin reads so
  the check above is possible. It still exposes nothing else.
- New **"The `domain` option"** section in the documentation, with a worked
  example of a reverse proxy in front of both Home Assistant and the add-on.

## 1.0.0 — First public release 🎉

Advance Tools is a visual toolbox that runs beside Home Assistant as an
add-on. Eighteen tools in one hub, everything local, no account and no
cloud.

### Getting started

- A **setup wizard** runs on first launch: create your admin password and,
  if you want, pick a starter layout that builds your first dashboard for
  you. There is no default password.
- **📦 Starter Templates** — Family Home, Apartment, Security Tablet and
  Vacation Rental. Each template describes *slots* rather than fixed
  entities, matches them against the devices you actually own by domain,
  device class, area and name, and shows you every match to review before
  anything is created. Dead entities are never chosen, and nothing
  existing is ever overwritten.

### Dashboards

- **📊 Dashboard Maker** — a freeform drag-and-drop designer for wall
  tablets. Absolute positioning, 120+ card skins across importable packs,
  tabs, screen-fit modes and tablet size presets.
- Per-user accounts with a **per-dashboard entity allowlist**, so the
  tablet in the kids' room cannot turn off the boiler. Sessions last a
  year on kiosks.
- Kiosk behaviour: hidden logout gesture, fullscreen guards, live states
  over a WebSocket.

### Keeping the house in order

- **🩺 Entity Doctor** — finds dead *devices* (every entity unavailable),
  orphaned registry entries, duplicate names, flat batteries and stale
  sensors, shows which automations reference something before you delete
  it, and cleans up through a drag-and-drop triage board. Every deletion
  is logged.
- **🧩 Helper Maker** — every Home Assistant helper type with a real UI.
- **⚙️ Automation Maker** — a visual WHEN / AND IF / THEN builder with
  searchable pickers, per-block plain-English summaries and a live YAML
  preview.
- **🎬 Scene Maker** — snapshot the house, edit the captured states, test
  a scene without saving it.

### Watching over things

- **🛡️ Security Center** — a real alarm panel. Arm Home / Away / Night
  behind a PIN with exit and entry delays, choose exactly which sensors
  each mode watches and whether each is instant or delayed, and decide
  what happens when it trips: sirens, lights, switches, locks, scenes,
  scripts, a spoken announcement and a camera snapshot attached to your
  phone alert. Eleven keypad designs for a tablet by the front door.
- **🚨 Alert Maker** — "left open too long", "battery low", "went
  offline" and more, compiled into real Home Assistant automations.
- **🔔 Notify Hub** — multi-channel notification rules and a two-way
  Telegram bot that answers `/status`, `/rules`, `/control` and more.
- **🏠 Away Simulator** — replays your lights' real history while you are
  away, with jitter, and pauses itself when someone comes home.

### Understanding your home

- **📈 History Explorer** — pick up to six entities and a range: a line
  chart for numbers, a state timeline for on/off things, statistics with
  time-weighted averages, and CSV export. Charts are hand-drawn SVG.
- **⚡ Energy Center** — consumption and cost per device from long-term
  statistics.
- **🌡️ Climate Scheduler** — paint a weekly thermostat schedule on a
  grid; the add-on enforces it every minute.

### Living with it

- **📋 Family Board** — shopping lists backed by real Home Assistant
  to-do lists, chores with rotation and streaks, sticky notes.
- **📢 Announce & Intercom** — whole-house text-to-speech with
  per-speaker volume and hold-to-talk from a dashboard.
- **💾 Backup Manager** — scheduled Supervisor backups with retention.
- **🧰 System Center** — a support bundle with every secret stripped out,
  and export/import of your whole setup for moving to a new machine.
- **📖 Manual** — the whole product documented and searchable, inside the
  app.

### Under the hood

- Every tool is a self-contained plugin: a folder with a manifest, a
  Python module and its own static files. Drop one in and it appears.
- **Installable as a phone app** (PWA) with offline-safe caching that
  never caches a dashboard or an alarm state.
- Screens **stop polling when nobody is looking** — hidden tools,
  background tabs and sleeping tablets make no requests, and resume with
  an immediate refresh.
- Sign-in has brute-force protection with escalating lockout and a
  security log.
- A verification suite (`scripts/verify.py`) checks syntax, JSON,
  truncated files, mangled encodings, version consistency, tool manifests
  and uncommitted files, and boots the app for real — and it runs in CI on
  every push.

---

Copyright © 2026 Mike Fattahi · [fattahi.us](https://www.fattahi.us) ·
Free software under the GNU General Public License v3.0.

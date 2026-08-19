# Changelog

Versioning follows [semver](https://semver.org): MAJOR.MINOR.PATCH — new
features bump MINOR, fixes bump PATCH.

## 1.1.0

**New tool: AI Assistant 🤖 — talk to your home in plain language.**

- Pluggable AI brain: Claude (Anthropic API), ChatGPT (OpenAI API) or a
  local Ollama / any OpenAI-compatible server. Function-calling agent
  that searches your entities and calls the right services — "turn off
  all lights", "set the bedroom lamp to 50% red", "lock the front door".
- Voice in the browser: push-to-talk on the mic button, a "Hey <name>"
  wake-word mode, and spoken replies (all client-side Web Speech API).
- Telegram bot: text and voice notes from anywhere (voice transcription
  via OpenAI Whisper when an OpenAI key is set), with an allow-list of
  chat IDs.
- Safety layer for protected domains (locks, alarm, covers by default):
  run freely, require a confirmation, require a PIN, or block. Pending
  actions are parked server-side and only run once confirmed — in the
  web chat or via Telegram inline buttons.
- API keys, the bot token and the PIN are stored server-side and never
  sent back to the browser.

## 1.0.4

**Verified against Home Assistant 2026.8 — no breakage, two small updates.**
Every WebSocket command and REST path the add-on uses was checked against the
2026.8 release; all of them are unchanged.

- **Entity Doctor** now reads a device's config entry from the new
  `config_entry_id` field introduced by 2026.8 (each device now belongs to a
  single config entry), falling back to the deprecated `config_entries` list
  on older cores. This future-proofs dead-device removal for the planned
  2027.8 removal of the old field.
- **Helper Maker**: the template tip now points at **Tools → Template** —
  Home Assistant 2026.8 renamed "Developer Tools" to "Tools".

## 1.0.3

**Automation Maker keeps up with Home Assistant 2026.7.** Home Assistant 2026.7
promoted purpose-specific triggers (`battery` → `became_low`, `vacuum` →
`returned_to_dock`, and friends) out of Labs and made them the default in its
own automation editor. Automation Maker had no form for them, and it used to
fall back to the Template form for anything it did not recognise — so opening
such an automation here and pressing save replaced its trigger with an empty
template. The same happened to `choose`, `if / then`, `repeat`, `parallel` and
`event` actions, and to `and` / `or` / `not` condition groups.

- Anything the visual builder has no form for now opens as an **Advanced
  (kept as-is)** block: the exact JSON Home Assistant stored, saved back
  unchanged. Nothing is guessed at and nothing is dropped.
- The same block is available from the quick-add chips, so a purpose-specific
  trigger or a `choose` action can be pasted in by hand.
- Fields the forms do not model (`id`, `alias`, `enabled`, `variables`,
  `attribute`, `not_to`, …) are now carried through a round-trip instead of
  being stripped.
- Automations are written in the **modern schema** — `triggers:` /
  `conditions:` / `actions:`, with `trigger:` for the trigger type and
  `action:` for the service call. Both schemas are still read, so older
  automations open exactly as before, but editing one that Home Assistant
  already stored in the modern form no longer downgrades it.
- Fixed: the **Continue on timeout** checkbox on a Wait-until action was
  decoration — unticking it still saved "continue anyway". It is now honoured.

Verified against Home Assistant Core 2026.7.4 / Supervisor 2026.07.3: every
REST and WebSocket call the add-on makes still behaves as before, so this
release is a correctness fix, not a migration.

Docs now point at **Settings → Apps**, which is what Home Assistant 2026.7
calls the add-on screens.

## 1.0.2

**Advance Tools now runs inside Home Assistant.** Click it in the sidebar and
the app opens there — no second hostname, no reverse proxy, no forwarded port,
no `domain` to configure. If you can reach Home Assistant, you can reach
Advance Tools, including from outside your house.

Until now the sidebar only held a launcher that sent you to the add-on's own
address on port 8234. That works on a laptop at home and fails everywhere
else, and the fix required running your own web server — which most people
reasonably do not.

- The whole app is served through **Home Assistant ingress**: all 18 tools,
  the dashboards, the designer, the live WebSocket. Home Assistant
  authenticates the request before it reaches the add-on.
- Opening it from the sidebar no longer depends on the `domain` option at all.
  `domain` is now only for tablets and phones that open the panel directly,
  and it can be left empty.
- Port `8234` is still there and still works, unchanged, for wall tablets on
  the local network and for anyone already using it.
- Installing Advance Tools to a phone home screen is offered only on the
  direct address, since the ingress path contains a token that is not stable
  enough to host an installed app.

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

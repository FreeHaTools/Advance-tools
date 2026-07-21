# Advance Tools

Advance Tools is a plugin-based toolbox. The sections below document every
tool. Open the admin hub at `http://YOUR_HA_IP:8234/` and sign in as an
admin.

> **📖 The full illustrated guide lives inside the app**: admin hub →
> **Manual** — every tool with step-by-step how-tos, examples, tips and a
> searchable FAQ.

## First run

A new installation opens a **setup wizard** instead of a login page:
create your admin password, optionally pick a starter layout that builds
your first dashboard automatically, and you're done. Existing
installations skip the wizard entirely — users, dashboards and passwords
are untouched.

## History Explorer

Pick up to six entities and a range and see what actually happened: a
multi-series SVG line chart for numeric entities, a state timeline for
on/off entities, and a statistics table (min, max, time-weighted mean,
change, on-time, transitions). Download as CSV. Short ranges use raw
recorder history, long ones use hourly or daily statistics — the tool
tells you which. Gaps are drawn as gaps, never as zero. How far back you
can look depends on your Home Assistant recorder retention.

## System Center

- **Support bundle** — collects versions, environment, add-on log,
  detected problems and every tool's configuration into one zip with all
  secrets redacted (deny-by-default: anything that looks like a password,
  token, PIN, hash, key or contact detail). The contents and the redaction
  count are shown before download, so the bundle is safe to share.
- **Export / import** — dashboards plus every tool's settings in a single
  file, for migrating to a new box, snapshotting before an experiment, or
  sharing a setup. User passwords are excluded unless you explicitly opt
  in. Import previews every change first, always writes a rollback point,
  validates archive paths, and refuses anything that would lock you out of
  your own admin account. Rollback points are kept for the last 5 imports.

## Starter Templates

Ready-made dashboards matched to the devices you actually have: **Family
Home**, **Apartment**, **Security Tablet** (portrait, built around the
keypad) and **Vacation Rental**. Each template declares *slots* rather
than fixed entities; the tool scores your entities by domain, device
class, area and name, skips dead ones, and shows you the result to review
and adjust before anything is created. Apply always creates a new
dashboard — nothing is overwritten — and sets its entity allowlist to
exactly what you mapped. Drop a JSON file into the tool's `templates/`
folder to add your own.

## Climate Scheduler

Weekly thermostat schedules you paint on a 7-day grid (admin hub → Climate
Scheduler). Pick a temperature, drag across the week, choose off/fallback
behavior outside blocks. The add-on enforces the schedule every minute and
logs every change it makes. Manual thermostat tweaks inside a block are
re-applied within a minute — pause the schedule for manual control.

## Energy Center

Consumption and cost per device from HA long-term statistics (admin hub →
Energy Center). First-run wizard picks your kWh sensors and price; then
Today/Yesterday/Week/Month dashboards with bar charts, top consumers and
per-device drill-down. Tip: turn a smart plug's power (W) into energy (kWh)
with a Helper Maker → Integral helper.

## Security Center

A full alarm panel. Live board of doors, windows, motion, locks, people and
camera snapshots, plus arming modes Home / Away / Night behind a PIN.

- **Sensors tab** — choose exactly which entities the alarm uses, which
  modes watch each one, and whether it is *Instant* (fires at once) or
  *Delayed* (gives you the entry countdown to type your code).
- **Cameras tab** — pick the cameras the system uses; the snapshot is
  attached to phone alerts.
- **Delays** — exit delay to leave after arming, entry delay to disarm,
  and how long the siren runs. Sensors tripping during the exit delay are
  logged but never sound the alarm.
- **Actions** — on trigger: sirens, lights, switches, locks, scenes,
  scripts, a camera snapshot and a spoken announcement.
- **Alerts** — send to several notify services at once, with a test
  button. Email needs an SMTP notify integration in HA; SMS needs a
  provider such as Twilio — any service you add appears automatically.
- **Dashboard keypad** — the 🔐 Security keypad widget (Dashboard Maker,
  Home Life category) lets a wall tablet arm and disarm with the PIN
  without an admin login. It can be disabled from the admin screen.

It works while HA and the add-on run — a smart layer, not a certified
alarm system.

## Family Board

Shopping lists backed by real HA to-do lists (sync with the companion app
and voice assistants), chores with automatic person rotation, due days and
streaks, and sticky notes. Designed for wall tablets. "＋ New list" creates
a Local to-do list in HA (needs HA 2023.11+).

## Announce & Intercom

Text-to-speech announcements to any media players, with editable quick
messages, per-speaker volume, optional phone notifications and a re-send
history. Needs at least one TTS integration in HA (e.g. the free Google
Translate TTS).

## Away Simulator

Vacation presence simulation: replays each selected light's real history
from N days back with random ±minute jitter, optional active window, and
auto-pause while anyone is home. Shows today's plan as per-light timelines.
Requires recorder history for the chosen entities (default retention is
10 days).

## Backup Manager

See, create, schedule and download Supervisor backups (admin hub →
Backup Manager).

- **The list** shows every backup with type (🗄️ full / 🧩 partial), size,
  age, 🔒 password protection and what's inside; 🔎 opens a details view
  listing every included add-on with its version. ⬇️ downloads the `.tar`
  (streamed — multi-GB backups are fine), 🗑️ deletes with confirmation and
  🔄 re-scans the backup folder (useful after copying a file in manually).
- **➕ New backup** — full (everything; the safe pre-update choice) or
  partial: tick Home Assistant configuration, any of the standard folders
  (ssl, share, media, local add-ons) and any installed add-ons from a
  searchable list. Optional password (needed again to restore — don't
  lose it!) and an "exclude the history database" switch that makes
  backups much smaller. Creation runs in the background with a progress
  banner; the list refreshes itself when it finishes.
- **🗓️ Scheduled backups** — pick a time, the weekdays (none = every
  day), full or partial with the same pickers, and an optional password.
  The schedule runs in Home Assistant's own time zone. **Keep the last
  N** automatically deletes the oldest backups *created by this
  schedule* once there are more than N — backups you made by hand are
  never touched (0 = never delete). The schedule card on the main page
  shows exactly what will run and when.
- Requires no setup: the add-on requests Supervisor access with the
  minimal `backup` role, which only covers the `/backups` endpoints.
- Restoring a backup is intentionally left to Home Assistant itself
  (Settings → System → Backups) — a restore reboots parts of the system
  and belongs in the official UI.

## Alert Maker

User-friendly watchdog rules that notify you when something needs
attention (admin hub → Alert Maker). You describe *what to watch* and
*who to tell*; the tool builds a real Home Assistant automation behind
the scenes and keeps it in sync with the rule.

Five ready-made alert types:

- **🚪 Left open / on** — a door, window, lock, valve or switch stays
  open/on/unlocked for more than N minutes (per-domain "open" state is
  handled for you: covers/valves → `open`, locks → `unlocked`,
  everything else → `on`).
- **🪫 Low battery** — a battery level drops below your threshold (fires
  once per crossing, no spam while it stays low).
- **📵 Went offline** — an entity becomes `unavailable`/`unknown` for
  more than N minutes (great for litter boxes, feeders, irrigation
  controllers and other devices that quietly drop off the network).
- **📊 Value too high / low** — a numeric sensor crosses an *above*
  and/or *below* limit, optionally sustained for N minutes (soil
  moisture, temperature, humidity…).
- **🎯 Enters a state** — free-form: any entity reaching any state you
  type, optionally sustained.

One rule can watch many entities; the notification names the exact
entity that fired. Targets are any `notify.*` service (HA companion app
phones/tablets) and/or a persistent notification in HA's 🔔 drawer —
the **🧪 Test** button sends a real notification so you can verify
delivery. Rules can be paused/resumed (this toggles the automation),
edited and deleted; a live preview shows the exact automation YAML.
The generated automations are tagged "Managed by Alert Maker" — edit
them in the tool, not in HA's automation editor, or your changes will
be overwritten on the next save.

## Notify Hub

One place for every notification (admin hub → Notify Hub): *channels*
say where messages go, *rules* say what causes them, and an optional
Telegram bot lets you ask back.

**Channels** — Telegram (a chat or group reached through your own bot),
any Home Assistant `notify.*` service (companion app, email, …), a
persistent notification in HA's sidebar, or a webhook with ready-made
JSON / Discord / Slack body formats. Every channel has a 🧪 test button.

**Rules** — four kinds:

- **A device does something** — an entity reaches a state, a number
  crosses a limit, or anything changes; optional "for X minutes" and a
  time window. This kind is compiled into a real HA automation tagged
  "Managed by Notify Hub", which fires the `advance_tools_notify` event;
  the add-on picks that up and fans it out to the rule's channels. Edit
  these in the tool, not in HA's automation editor.
- **Home Assistant problems** — errors and warnings from the log plus
  restarts, with an ignore list for integrations you can't fix.
- **Dead or flat devices** — entities unavailable longer than a
  threshold, and low batteries. Each device is reported once and becomes
  reportable again after it recovers.
- **Scheduled digest** — a summary at a chosen time and set of weekdays.

Rules choose their own channels, can be marked **urgent** (ignores mute
and quiet hours) and can carry a **cooldown** in minutes so one chatty
sensor can't flood you.

**Quiet hours** hold non-urgent notifications between two times; the
header's 🔕 Mute button pauses everything for an hour. Both are recorded
in the History tab rather than silently dropped.

**Telegram bot** — create a bot with @BotFather, paste the token into
the Telegram bot tab, send `/start` to the bot and press *Find my chats*
to pick up your chat ID. Add that ID to the allow-list and the bot
accepts commands: `/status`, `/rules` (inline buttons switch rules on
and off), `/control` (buttons for the entities you explicitly ticked),
`/find <text>`, `/mute 2h`, `/unmute`, `/log`, `/help`. Chats that are
not on the allow-list are told their own chat ID and nothing else, and
only ticked entities can ever be controlled from Telegram.

Everything lives in `/data/notify_hub.json`; the bot token is stored
there and never sent back to the browser.

## Scene Maker

Build Home Assistant scenes by snapshotting your rooms (admin hub →
Scene Maker).

- **📸 Snapshot**: set the room exactly how you want it (dim the lights,
  set the thermostat…), pick an area, untick anything you don't want and
  capture it. The tool records each entity's current state plus the
  attributes a scene can replay: light brightness/color/effect (aware of
  the light's color mode), climate target temperature and modes, cover
  and valve positions, fan speed/oscillation, media volume/source, lock
  state, vacuum fan speed and all helper values. Unavailable entities are
  skipped and reported. Single entities can be added via the search box,
  and every captured row has its own 📸 re-capture button.
- **🧪 Test now** applies the scene live through `scene.apply` **without
  saving** — check the room, tweak the values, test again. The optional
  transition (seconds) fades lights smoothly and is also used by
  ▶ Activate.
- **Editor**: every captured entity is a card with an editable state and
  an attributes JSON field (with `?` help on every field), plus a live
  YAML preview of exactly what will be stored in `scenes.yaml`.
- Scenes are saved through HA's scene config API, so they are the same
  scenes you see in Home Assistant's own editor and can be used in
  automations, dashboards and voice assistants immediately. Scenes defined
  manually in `configuration.yaml` are listed activate-only, with a dialog
  explaining how to recreate them as editable ones.

## Entity Doctor

A full health check-up for every Home Assistant entity (admin hub →
Entity Doctor). One scan groups problems into categories:

- **Unavailable** — the integration reports the entity as unavailable.
- **Unknown** — stuck in the `unknown` state (bad restart, broken
  integration).
- **Low battery** — battery sensors at or below the threshold (default
  20 %, adjustable), binary low-battery alerts, and `battery_level`
  attributes on any entity.
- **Orphaned** — registry leftovers: *restored* entities whose integration
  no longer provides them, entities whose device was deleted, and entries
  that never load. These are the only entities the tool will let you
  **remove** — the server refuses to delete anything still alive.
- **Stale** — no state change for N days (default 7, adjustable). Domains
  where silence is normal (automations, scenes, buttons, zones, helpers…)
  are never flagged.
- **Duplicate names** — two or more entities sharing a friendly name,
  which confuses pickers and voice assistants.
- Info lists: **disabled**, **hidden**, and **no area** (device-bound
  entities whose device has no area).

Each fixable category has a **🔧 Repair** button that builds a safe,
previewable plan: duplicates keep the healthy entity and rename living
twins apart by area/device (dead copies are removed, unavailable twins
only hidden), orphans are removed in one go, and unavailable/unknown
entities are grouped by integration with one-click reloads. Every action
in the plan is a checkbox with an explanation — nothing runs until you
press Apply, and removals stay orphan-guarded server-side.

Every card offers one-click fixes through HA's entity registry: **rename**
(friendly name and/or entity ID — the domain part is protected), **hide /
unhide**, **disable / enable**, and **remove** for orphans. The **🔎 Usage**
button shows every automation, script, scene and group that references the
entity before you change it. Bulk mode multi-selects entities for bulk
hide/disable/enable or "remove orphans" (live entities are skipped).

The health banner shows a 0–100 score: the share of active entities with
no unavailable/unknown/battery/orphaned/stale problem. Category boxes
filter the list; search (`/`) and the domain dropdown narrow it further.

## Helper Maker

Create, edit, control and understand every Home Assistant helper from one
place (admin hub → Helper Maker).

- **Basic helpers** (Toggle, Button, Number, Text, Dropdown, Date/Time,
  Counter, Timer, Schedule) are fully editable here — forms with a `?` help
  bubble on every field, including a visual weekly-blocks editor for
  Schedules.
- **Advanced helpers** (Group, Template, Threshold, Times of the Day, Trend,
  Min/Max, Statistics, Derivative, Integral, Utility Meter, Random,
  Switch-as-X) are created and edited through Home Assistant's own config
  flows, rendered inside the tool. Field labels are generated from the
  flow schema, so a rarely-used option may show a technical name.
- Every card shows the **live state** with quick controls: toggle, slider,
  stepper, timer start/pause/cancel with a live countdown, dropdown and
  date/time setters. States refresh every few seconds.
- The 🔎 button (and every delete dialog) runs the **usage finder**: it lists
  the automations, scripts and scenes that reference the helper, so you
  never delete something that is still in use without knowing.
- **📖 Learn** on every type explains what it is, when to use it and shows a
  real example automation.
- **☑ Select** enables bulk mode: multi-select, bulk delete, and JSON
  export/import (basic helpers) for backups or copying between installs.

Notes: helpers defined in YAML (`configuration.yaml`) are not editable via
HA's storage API and won't appear here. Deleting an advanced helper removes
its config entry and all entities it provides.

## Dashboard Maker

Multi-user HTML dashboards for wall tablets, with per-user and per-dashboard
access control — independent from Home Assistant's own user system.

## How it works

- The add-on runs its own web server on port **8234**:
  `http://YOUR_HA_IP:8234/` (also `/panel`).
- The login page shows a dropdown of dashboards. A user can only open
  dashboards the admin has granted them.
- Each dashboard is plain **HTML/CSS/JS** — design anything you want.
- Each dashboard has an **entity allowlist**: it can only read and control
  the entities the admin listed (wildcards like `light.bedroom1_*` work).
- Sessions last 365 days for normal users (kiosk tablets stay logged in)
  and 7 days for admins. Logout returns to the login page.

## First steps

1. Start the add-on and open `http://YOUR_HA_IP:8234/`, or click **Advance
   Tools** in the Home Assistant sidebar.
2. The **setup wizard** runs on first launch: create your admin password
   and, if you like, pick a starter layout that builds your first dashboard
   for you.
3. Sign in and you land on the **Hub** — a card for every tool.
4. Create more dashboards (e.g. `bedroom1`, `hall`) in **Dashboard Maker**
   — each gets a working sample design you can replace.
5. Set each dashboard's allowed entities.
6. Create users and tick which dashboards they may open.

## Designing dashboards

**Visual Designer (no coding):** open the admin panel → 🎨 Designer on any
dashboard. Add widgets from the palette (toggle cards, sensors, thermostat,
action buttons, clock, headings), pick entities from the live list, drag to
reorder, set columns and colors, Save. New dashboards use this mode by default.

**Custom HTML (full freedom):** write HTML in the built-in editor or upload
files (multiple files or a zip — `index.html` is the entry point; images/CSS/JS
are served relative to it). Saving HTML switches the dashboard to HTML mode;
saving in the Designer switches it back.

`panel.js` is injected automatically and provides:

```js
HAPanel.ready(cb)                       // states are loaded
HAPanel.state('light.bedroom')          // {state, attributes, last_changed}
HAPanel.states()                        // all allowed entities
HAPanel.on('light.bedroom', cb)         // live updates; '*' = any entity
HAPanel.call('light', 'turn_on', {entity_id: 'light.bedroom', brightness: 200})
HAPanel.logout()                        // back to login page
HAPanel.connected                       // HA link status
```

Example — a lamp toggle button:

```html
<button id="lamp">Lamp</button>
<script>
  const btn = document.getElementById('lamp');
  HAPanel.on('light.bedroom1_lamp', s => btn.textContent = 'Lamp: ' + s.state);
  btn.onclick = () => HAPanel.call('light', 'toggle', {entity_id: 'light.bedroom1_lamp'});
</script>
```

The runtime also locks the page down for kiosk use: back-navigation is
trapped, the context menu is disabled, and the first touch requests
fullscreen.

## Packs — add more designs, or build your own

All card styles and control skins come from **Advance Tools Packs** — a single
JSON format used both by the built-in library and by anything you import:
**Admin → Packs → Import** (paste JSON or pick a .json file). The complete
format documentation, two worked examples and the hooks reference are in the
admin console's **Build your own** tab. Built-in packs live in
`/static/packs.js` on this server — copying one of those items is the fastest
way to start your own.

## Locking the tablet (kiosk mode)

A web page can never stop someone from pressing the device's Home button —
that lock must come from the device itself. Recommended setup per device:

**Android — Fully Kiosk Browser (recommended).** Install Fully Kiosk, set
the Start URL to `http://YOUR_HA_IP:8234/`, enable Kiosk Mode, and set a
**Kiosk PIN**. Only someone with the PIN (you) can exit the app or reach
Android. This is exactly the "only admin can close it" behavior you want.

**iPad — Guided Access.** Settings → Accessibility → Guided Access → on,
set a passcode. Open the dashboard in Safari, triple-click the side/home
button to start Guided Access. Exiting requires the passcode.

**Raspberry Pi — Chromium kiosk.** Autostart Chromium with:
`chromium-browser --kiosk --noerrdialogs --disable-infobars http://YOUR_HA_IP:8234/`
There is no window chrome and no obvious way out without a keyboard.

In all three cases the web login still controls *which dashboard* the
tablet may show, and logout only ever leads back to the login page.

## HTTPS

By default the panel speaks plain HTTP on port 8234. To enable HTTPS, open the
add-on's **Configuration** tab:

- `ssl: true` — serve **HTTPS** on 8234 using certificates from Home
  Assistant's `/ssl` folder (`certfile`/`keyfile`, default
  `fullchain.pem`/`privkey.pem` — the files created by the Let's Encrypt or
  Duck DNS add-ons).
- `keep_http: true` — additionally keep plain **HTTP on port 8235** ("both"
  mode; enable the 8235 port mapping in the Network section if you need it).

If the cert files are missing, the add-on logs an error and falls back to
HTTP so you're never locked out. Note: a self-signed certificate will show a
browser warning on tablets — a real cert (Let's Encrypt / Duck DNS) won't.

## Security notes

- **There is no default password.** A fresh install opens a setup wizard
  that makes you create one before anything else works. Upgrading from an
  older version that still used `admin` / `admin` prompts for a new
  password at the next sign-in.
- Passwords must be at least 8 characters and not a common one.
- **Brute-force protection**: 5 failed sign-ins for the same account and IP
  start an escalating lockout (30s → 2m → 5m → 15m, never permanent),
  returning HTTP 429 with the remaining time.
- A **security log** of sign-ins, failures, lockouts and password changes is
  available to admins (in memory, cleared when the add-on restarts).
- Without SSL the server speaks plain HTTP on your LAN. Don't port-forward
  8234 to the internet; for remote access use a VPN.
- Dashboards can only touch entities in their allowlist — a tablet in the
  kids' room can't turn off the boiler unless you allow it.
- All HA communication happens server-side via the Supervisor; no HA token
  is ever sent to the browser.

## Install on a phone

The panel is an installable app. On Android/Chromium over HTTPS an
**Install app** button appears in the hub and on the login page; on iOS
use Safari's Share → *Add to Home Screen*. It then opens full-screen with
no browser chrome. Over plain HTTP browsers don't permit installing, and
the app says so rather than offering a button that won't work.

The service worker caches static assets only — never dashboards, API
responses or alarm state — so what you see is always live.

## Performance

Screens stop polling when nobody is looking: hidden tools, background
tabs and sleeping tablets make no requests at all, and resume with an
immediate refresh. Visible-but-unfocused windows poll at a third of the
rate, requests never pile up on slow devices, and a briefly unavailable
backend gets an exponential backoff.

## Data

Everything lives in the add-on's `/data` (users, dashboards, files) and
survives updates. Uninstalling the add-on deletes it. Use **System
Center → Export** to take a copy with you.

## License

Copyright © 2026 Mike Fattahi.

Free software under the **GNU General Public License v3.0** (see `LICENSE`
in the repository). Use it, study it, share it, change it. A modified
version you pass on has to stay free software under the same licence.

## Author

Built by **Mike Fattahi**.

- Website — [fattahi.us](https://www.fattahi.us)
- GitHub — [github.com/FreeHaTools](https://github.com/FreeHaTools)
- Source code & issues —
  [github.com/FreeHaTools/Advance-tools](https://github.com/FreeHaTools/Advance-tools)

Found a bug? Open **System Center → Support bundle** first: it produces a
redacted zip with the versions, the log and every tool's configuration, safe
to attach to a GitHub issue.

## Support

Advance Tools is free and always will be. If it saved you an afternoon, you can
[buy me a coffee](https://github.com/sponsors/FreeHaTools) ♥

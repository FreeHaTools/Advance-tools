# Advance Tools for Home Assistant

**A toolbox for the parts of Home Assistant that are still hard.**
Build wall-tablet dashboards without writing YAML, clean up the entities a
year of tinkering left behind, run a real alarm panel with a keypad, and see
what actually happened in your home — all from one hub, all visual, all
explained in plain language.

Runs as a Home Assistant add-on. No cloud, no account, no telemetry.

[![Open your Home Assistant instance and show the add add-on repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FFreeHaTools%2FAdvance-tools)

![The Advance Tools hub](docs/screenshots/hub.jpg)

---

## Start with a finished dashboard, not an empty canvas

Pick a layout. Advance Tools looks at the entities your Home Assistant
reports *right now*, matches them to the places the layout needs them, shows
you every match before anything is created — then builds the dashboard.

![Starter Templates](docs/screenshots/starter-templates.jpg)

Four templates ship with it: **Family Home**, **Apartment**, **Security
Tablet** (portrait, built around the keypad) and **Vacation Rental**. Adding
your own is a JSON file, not a pull request.

## A security panel you'd actually mount by the door

Arm Home / Away / Night behind a PIN, with real exit and entry delays, and
choose exactly which sensors each mode watches and whether each one is
instant or delayed. When it trips: sirens, lights, locks, scenes, scripts,
and a camera snapshot attached to your phone alert.

![Security keypad skins](docs/screenshots/security-keypads.jpg)

Eleven keypad designs for the tablet by your front door — Matrix, Police,
Military, Vault, Neon, a classic beige alarm panel, a radar scope and a
siren bar. All pure CSS, no images, no libraries.

## Find the junk a year of tinkering left behind

Dead devices, unavailable and orphaned entities, duplicate names, flat
batteries — found, explained, and cleaned up with a drag-and-drop triage
board. Every deletion is logged, and it shows you which automations
reference an entity *before* you remove it.

![Entity Doctor](docs/screenshots/entity-doctor.jpg)

---

## Everything in the box

| | |
|---|---|
| 📦 **Starter Templates** | Ready-made dashboards matched to your devices |
| 📊 **Dashboard Maker** | Freeform visual designer, 120+ card skins, per-user access |
| ⚙️ **Automation Maker** | Visual WHEN / AND IF / THEN builder with live YAML preview |
| 🧩 **Helper Maker** | Every helper type with a real UI |
| 🩺 **Entity Doctor** | Health check-up for entities *and* devices, with cleanup |
| 🎬 **Scene Maker** | Snapshot the house, edit it, test without saving |
| 🚨 **Alert Maker** | "Left open too long", "battery low", "went offline" |
| 🔔 **Notify Hub** | Multi-channel notification rules and a two-way Telegram bot |
| 🛡️ **Security Center** | Full alarm panel with a tablet keypad |
| 📈 **History Explorer** | Charts, state timelines, statistics, CSV export |
| ⚡ **Energy Center** | Consumption and cost per device |
| 🌡️ **Climate Scheduler** | Paint a weekly thermostat schedule on a grid |
| 📋 **Family Board** | Shopping lists, chores with rotation, sticky notes |
| 📢 **Announce & Intercom** | Whole-house TTS with per-speaker volume |
| 🏠 **Away Simulator** | Replays your real light history while you're away |
| 💾 **Backup Manager** | Scheduled Supervisor backups with retention |
| 🧰 **System Center** | Redacted support bundles, export/import your whole setup |
| 📖 **Manual** | The whole thing documented and searchable, inside the app |

## Install

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**, and add:
   ```
   https://github.com/FreeHaTools/Advance-tools
   ```
2. Install **Advance Tools**, start it, and open it from the sidebar.
3. The setup wizard walks you through creating a password and building your
   first dashboard.

Needs Home Assistant OS or Supervised. Builds for `amd64`, `aarch64` and
`armv7`. It also installs to a phone home screen as an app.

## Design principles

- **Visual first.** If it can be a grid, a dial, a drag or a preview, it is
  not a text box.
- **Explain everything.** Every non-obvious field has a `?` with a concrete
  example, and every tool has a "How it works" guide.
- **Never surprise the user.** Destructive actions preview exactly what will
  happen, imports write a rollback point first, and nothing is deleted
  quietly.
- **Honest about limits.** The alarm is a convenience layer that runs while
  Home Assistant runs — the docs say so rather than implying otherwise.
- **Your data stays yours.** Everything runs locally against the Supervisor
  API. No account, no cloud, no analytics.

## Security

There is no default password — a fresh install makes you create one before
anything works. Sign-in has brute-force protection with escalating lockout,
and a security log records sign-ins, failures and password changes. This
panel can unlock doors and disarm an alarm, so it is treated that way.

Don't expose port 8234 to the internet; use a VPN or a reverse proxy with
TLS.

## Contributing

Every tool is a self-contained plugin — a folder with `manifest.json`,
`tool.py` and a `static/` directory. Drop one in and it appears in the hub;
no core changes needed.

`python scripts/verify.py` runs the same checks CI does: syntax, JSON,
truncated files, mangled encodings, version consistency, tool manifests,
uncommitted files, and a real boot smoke test.

## License

Copyright © 2026 Mike Fattahi.

Advance Tools is free software released under the
**[GNU General Public License v3.0](LICENSE)**. You may use, study, share
and modify it. If you distribute a modified version, it has to stay free
software under the same licence — so it can never be closed up and sold on.

## Author

Built by **Mike Fattahi**.

- Website — [fattahi.us](https://www.fattahi.us)
- GitHub — [github.com/FreeHaTools](https://github.com/FreeHaTools)

## Support the project

Advance Tools is free and always will be. If it saved you an afternoon, you
can [buy me a coffee](https://github.com/sponsors/FreeHaTools) ♥

Bugs and ideas are welcome in
[Issues](https://github.com/FreeHaTools/Advance-tools/issues). **System Center
→ Support bundle** produces a zip of your versions, logs and configuration
with every password and token stripped out — attaching it makes a report
roughly ten times easier to act on.

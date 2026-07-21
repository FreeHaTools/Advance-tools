# Launch posts

Ready-to-paste text for announcing Advance Tools. Post the forum version
first, then Reddit a day or two later — that way any early bug reports land
in one place while the Reddit thread is still fresh.

Before posting, check that the repo README renders correctly on GitHub, that
the screenshots load, and that a fresh install actually completes the setup
wizard (test it with a clean `/data` if you can).

---

## Home Assistant Community Forum

**Category:** Share your Projects! → Third party integrations / add-ons
**Title:** Advance Tools — a visual toolbox add-on: dashboard builder, entity cleanup, alarm panel with keypad, history explorer (18 tools)

---

I've been building an add-on for about a year to scratch my own itches, and
it has grown enough that it might be useful to other people.

**Advance Tools** is a hub with 18 tools in it. The common thread: things
that are possible in Home Assistant but still take YAML, a template, or an
afternoon of clicking. It runs entirely locally against the Supervisor API —
no account, no cloud, no telemetry.

**A few things it does**

- **Starter Templates** — pick a layout (Family Home, Apartment, Security
  Tablet, Vacation Rental) and it matches the layout's "slots" against the
  entities you actually own, by domain, device class, area and name. It
  shows you every match to review before it creates anything, and never
  touches an existing dashboard.
- **Dashboard Maker** — freeform drag-and-drop designer for wall tablets
  with 120+ card skins, per-user access and entity allowlists, so the tablet
  in the kids' room can't turn off the boiler.
- **Entity Doctor** — the one I use most. It finds dead *devices* (every
  entity unavailable), orphaned registry entries, duplicate names and flat
  batteries, shows which automations reference something before you delete
  it, and cleans up through a drag-and-drop triage board. Every deletion is
  logged.
- **Security Center** — a real alarm panel: Home / Away / Night behind a PIN,
  exit and entry delays, per-sensor instant-vs-delayed, and actions on
  trigger (sirens, lights, locks, scenes, scripts, a camera snapshot
  attached to the push notification). There's a keypad card for a wall
  tablet in eleven designs.
- **History Explorer** — pick entities and a range, get a line chart plus a
  state timeline for on/off things, with time-weighted averages and CSV
  export. Short ranges use raw recorder history, long ones use statistics,
  and it tells you which.
- **System Center** — export your whole setup to one file for migrating to a
  new box, and generate a support bundle with every password and token
  stripped out.

Also: Automation Maker, Helper Maker, Scene Maker, Alert Maker, Notify Hub
(with a two-way Telegram bot), Energy Center, Climate Scheduler, Family
Board, Announce & Intercom, Away Simulator, Backup Manager, and a searchable
manual inside the app.

**Design rules I've stuck to**

- Visual first — if it can be a grid, a dial or a preview, it isn't a text
  box.
- Every non-obvious field has a `?` with a real example.
- Destructive things preview exactly what will happen, imports write a
  rollback point, and nothing is deleted silently.
- Honest about limits: the alarm is a convenience layer that works while HA
  and the add-on are running. It is not a monitored, certified system and
  the docs say so.

**Install**

Add `https://github.com/FreeHaTools/Advance-tools` as an add-on repository,
install Advance Tools, and the setup wizard takes it from there. HA OS or
Supervised, amd64 / aarch64 / armv7.

Repo, screenshots and full docs:
https://github.com/FreeHaTools/Advance-tools

I'd genuinely like to know where it breaks on someone else's setup — my
house has its own quirks (Home Assistant classifies my cat feeders' lids as
doors, which is how I learned the sensor picker was necessary). If a tool
misbehaves, **System Center → Support bundle** produces a redacted zip that
makes a bug report much easier to act on.

---

## r/homeassistant

**Title:** I built a 18-tool add-on for the parts of HA that still need YAML — dashboard builder, entity cleanup, alarm keypad, history charts

---

Been building this for my own house for about a year and finally polished it
enough to share. **Advance Tools** is a Home Assistant add-on: one hub, 18
tools, all local, no account or cloud.

The three I use most:

**Entity Doctor** — finds dead devices (every entity unavailable), orphaned
registry entries, duplicate names and flat batteries. On my own 745-entity
install it turned up 9 completely dead devices I'd forgotten about. It shows
you which automations reference an entity before you delete it, and logs
every deletion.

**Starter Templates** — instead of an empty dashboard canvas, pick a layout
and it matches the layout against the entities you actually have, shows you
every match to confirm, then builds it. It won't guess when it shouldn't:
sixteen lights with no room in the name is a genuine question, so it asks.

**Security Center** — proper alarm panel with Home/Away/Night, exit and entry
delays, per-sensor instant vs delayed, and a keypad card for a wall tablet
(Matrix, Police, Military, Vault, Neon and a classic beige alarm panel
design). On trigger it can sound sirens, turn on lights, lock doors, run
scenes and attach a camera snapshot to the push notification.

Plus Dashboard Maker (freeform designer, 120+ card skins, per-user access),
History Explorer (charts + state timelines + CSV), Automation/Helper/Scene
Maker, Notify Hub with a two-way Telegram bot, Energy Center, Climate
Scheduler, Backup Manager and more.

Screenshots and install instructions:
https://github.com/FreeHaTools/Advance-tools

Happy to answer questions. Bug reports especially welcome — I've only been
able to test against my own house, and I already know it does odd things
when your device classes are unusual.

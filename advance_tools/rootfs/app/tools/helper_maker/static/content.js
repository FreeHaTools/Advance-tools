/* Helper Maker — helper type catalogue.
 *
 * Everything the UI knows about each helper type lives here: display info,
 * form field definitions (storage helpers), tooltips, and the learn panel
 * content. app.js renders forms and panels purely from this data.
 *
 * Field spec: { key, label, type, required, def, min, max, step, choices,
 *               ph (placeholder), showIf, hint: {t, b, ex} }
 * Field types: text | number | bool | select | icon | list | duration | schedule
 */
"use strict";

const ICON_HINT = {
  t: "Icon (optional)",
  b: "Any Material Design Icon name, prefixed with mdi:. Browse the full " +
     "catalogue at pictogrammers.com/library/mdi — the icon shows up in " +
     "Home Assistant next to the helper.",
  ex: "mdi:lightbulb\nmdi:thermometer\nmdi:cup-water"
};

const HELPER_TYPES = {

  /* ============================ storage helpers ============================ */

  input_boolean: {
    kind: "storage", icon: "🔘", name: "Toggle",
    color: "#3ecf8e", entity: "input_boolean",
    short: "A virtual on/off switch you control yourself.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true,
        ph: "Guest mode",
        hint: { t: "Name", b: "Shown everywhere in Home Assistant. The " +
          "entity id is generated from it once, at creation." } },
      { key: "icon", label: "Icon", type: "icon", hint: ICON_HINT },
    ],
    learn: {
      what: "A Toggle (input_boolean) is a virtual switch that isn't wired " +
        "to any real device. It just remembers ON or OFF until you change " +
        "it — from a dashboard, an automation, or a voice assistant.",
      when: [
        "Modes: guest mode, party mode, vacation mode, cleaning day",
        "Manual overrides: 'don't run the heating automation tonight'",
        "Remembering a fact between automations: 'the dog has been fed'",
      ],
      tips: [
        "Combine it with conditions: automations check the toggle before acting.",
        "State survives a Home Assistant restart automatically.",
      ],
      yaml:
`# Skip the morning routine when guest mode is on
triggers:
  - trigger: time
    at: "07:00:00"
conditions:
  - condition: state
    entity_id: input_boolean.guest_mode
    state: "off"
actions:
  - action: light.turn_on
    target:
      entity_id: light.bedroom`
    }
  },

  input_number: {
    kind: "storage", icon: "🎚️", name: "Number",
    color: "#4f8cff", entity: "input_number",
    short: "An adjustable numeric value with a min/max range.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true,
        ph: "Target temperature" },
      { key: "min", label: "Minimum", type: "number", required: true, def: 0,
        hint: { t: "Minimum", b: "Lowest value the helper accepts. The " +
          "slider starts here." } },
      { key: "max", label: "Maximum", type: "number", required: true, def: 100,
        hint: { t: "Maximum", b: "Highest value the helper accepts." } },
      { key: "step", label: "Step", type: "number", def: 1,
        hint: { t: "Step", b: "Increment between values. Use 0.5 for " +
          "half-degree temperature steps." } },
      { key: "unit_of_measurement", label: "Unit", type: "text", ph: "°C",
        hint: { t: "Unit of measurement", b: "Free text shown after the " +
          "value: °C, %, min, kWh …" } },
      { key: "mode", label: "Display mode", type: "select",
        choices: ["slider", "box"], def: "slider",
        hint: { t: "Display mode", b: "slider shows a draggable slider in " +
          "HA dashboards; box shows a numeric input field.",
          ex: "slider → good for temperatures\nbox → good for exact values" } },
      { key: "icon", label: "Icon", type: "icon", hint: ICON_HINT },
    ],
    learn: {
      what: "A Number (input_number) stores one numeric value inside a " +
        "range you define. Automations can read it as a threshold and " +
        "dashboards can expose it as a slider.",
      when: [
        "User-adjustable thresholds: 'turn on the fan above X °C'",
        "Durations and delays that you want to tune without editing YAML",
        "Brightness / volume presets",
      ],
      tips: [
        "Reference it in templates: states('input_number.target_temp') | float",
        "Pair with a Numeric state trigger comparing a sensor against it.",
      ],
      yaml:
`# Fan on when temperature exceeds the user-set threshold
triggers:
  - trigger: template
    value_template: >
      {{ states('sensor.living_temp') | float(0) >
         states('input_number.fan_threshold') | float(25) }}
actions:
  - action: fan.turn_on
    target:
      entity_id: fan.living_room`
    }
  },

  input_text: {
    kind: "storage", icon: "📝", name: "Text",
    color: "#22b8cf", entity: "input_text",
    short: "A small text value — notes, names, statuses.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true,
        ph: "Status message" },
      { key: "min", label: "Min length", type: "number", def: 0 },
      { key: "max", label: "Max length", type: "number", def: 100,
        hint: { t: "Max length", b: "Hard limit is 255 characters." } },
      { key: "pattern", label: "Pattern (regex)", type: "text", ph: "",
        hint: { t: "Pattern", b: "Optional regular expression the value " +
          "must match. Leave empty for no validation.",
          ex: "^[0-9]{4}$   (exactly 4 digits, e.g. a PIN)" } },
      { key: "mode", label: "Mode", type: "select",
        choices: ["text", "password"], def: "text",
        hint: { t: "Mode", b: "password hides the value behind dots in " +
          "dashboards. Note: it is NOT encrypted in storage." } },
      { key: "icon", label: "Icon", type: "icon", hint: ICON_HINT },
    ],
    learn: {
      what: "A Text helper (input_text) stores a short string (up to 255 " +
        "characters). Automations can read it, write it, and show it in " +
        "notifications or on dashboards.",
      when: [
        "Status boards: 'who is home', 'last person to open the door'",
        "Storing the name of the last triggered automation for debugging",
        "Simple PIN codes for kiosk actions (mode: password)",
      ],
      tips: [
        "Write to it from automations with input_text.set_value.",
        "Great with TTS: read the text aloud on a speaker.",
      ],
      yaml:
`# Remember who came home last
triggers:
  - trigger: state
    entity_id: person.mike
    to: "home"
actions:
  - action: input_text.set_value
    target:
      entity_id: input_text.last_arrival
    data:
      value: "Mike at {{ now().strftime('%H:%M') }}"`
    }
  },

  input_select: {
    kind: "storage", icon: "📋", name: "Dropdown",
    color: "#ffb86b", entity: "input_select",
    short: "A pick-one list of options you define.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true,
        ph: "House mode" },
      { key: "options", label: "Options", type: "list", required: true,
        hint: { t: "Options", b: "The values a user (or automation) can " +
          "pick from. At least one is required; the first one is the " +
          "initial state.", ex: "Home\nAway\nNight\nVacation" } },
      { key: "icon", label: "Icon", type: "icon", hint: ICON_HINT },
    ],
    learn: {
      what: "A Dropdown (input_select) holds exactly one value out of a " +
        "list you define. It is the cleanest way to model a mode with " +
        "more than two states.",
      when: [
        "House modes: Home / Away / Night / Vacation",
        "Scene pickers on a wall tablet",
        "Choosing which playlist / radio station an automation starts",
      ],
      tips: [
        "Trigger automations on each option with a State trigger.",
        "Change it from automations with input_select.select_option.",
      ],
      yaml:
`# React to the house mode changing to Night
triggers:
  - trigger: state
    entity_id: input_select.house_mode
    to: "Night"
actions:
  - action: light.turn_off
    target:
      entity_id: all
  - action: lock.lock
    target:
      entity_id: lock.front_door`
    }
  },

  input_datetime: {
    kind: "storage", icon: "📅", name: "Date / Time",
    color: "#ff8fd8", entity: "input_datetime",
    short: "A user-settable date, time, or both.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true,
        ph: "Wake-up time" },
      { key: "has_time", label: "Has time", type: "bool", def: true,
        hint: { t: "Has time", b: "Store a time of day. At least one of " +
          "'Has time' / 'Has date' must be on." } },
      { key: "has_date", label: "Has date", type: "bool", def: false,
        hint: { t: "Has date", b: "Store a calendar date. Combine both for " +
          "a full timestamp." } },
      { key: "icon", label: "Icon", type: "icon", hint: ICON_HINT },
    ],
    learn: {
      what: "A Date/Time helper (input_datetime) stores a time, a date, or " +
        "both — and users can change it from a dashboard. Its killer " +
        "feature: a Time trigger can use it directly as the trigger time.",
      when: [
        "User-adjustable alarm / wake-up light time",
        "'Water the plants on this date' reminders",
        "Storing when something last happened (set by an automation)",
      ],
      tips: [
        "Time trigger accepts it directly: at: input_datetime.wake_up",
        "Set it from automations with input_datetime.set_datetime.",
      ],
      yaml:
`# Wake-up light at the user-chosen time
triggers:
  - trigger: time
    at: input_datetime.wake_up
actions:
  - action: light.turn_on
    target:
      entity_id: light.bedroom
    data:
      brightness_pct: 30
      transition: 300`
    }
  },

  input_button: {
    kind: "storage", icon: "🔲", name: "Button",
    color: "#b17aff", entity: "input_button",
    short: "A stateless press — perfect to trigger automations.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true,
        ph: "Good night" },
      { key: "icon", label: "Icon", type: "icon", hint: ICON_HINT },
    ],
    learn: {
      what: "A Button (input_button) has no on/off state — it only " +
        "remembers when it was last pressed. Pressing it is an event that " +
        "automations can react to.",
      when: [
        "One-tap routines on dashboards: Good night, Leave home, Movie time",
        "A safe way to let guests trigger a specific routine and nothing else",
      ],
      tips: [
        "Trigger on it with a State trigger (any state change = a press).",
        "Unlike a Toggle you never need to reset it.",
      ],
      yaml:
`# Good-night routine on button press
triggers:
  - trigger: state
    entity_id: input_button.good_night
actions:
  - action: light.turn_off
    target:
      entity_id: all
  - action: climate.set_temperature
    target:
      entity_id: climate.bedroom
    data:
      temperature: 18`
    }
  },

  counter: {
    kind: "storage", icon: "🔢", name: "Counter",
    color: "#6be675", entity: "counter",
    short: "Counts up or down in steps — with optional limits.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true,
        ph: "Coffees today" },
      { key: "initial", label: "Initial value", type: "number", def: 0,
        hint: { t: "Initial value", b: "Value the counter returns to on " +
          "counter.reset." } },
      { key: "minimum", label: "Minimum", type: "number",
        hint: { t: "Minimum", b: "Optional floor — decrement stops here. " +
          "Leave empty for no limit." } },
      { key: "maximum", label: "Maximum", type: "number",
        hint: { t: "Maximum", b: "Optional ceiling — increment stops here. " +
          "Leave empty for no limit." } },
      { key: "step", label: "Step", type: "number", def: 1,
        hint: { t: "Step", b: "How much one increment/decrement changes " +
          "the value." } },
      { key: "restore", label: "Restore after restart", type: "bool",
        def: true,
        hint: { t: "Restore", b: "Keep the count across Home Assistant " +
          "restarts. Turn off to reset to the initial value on restart." } },
      { key: "icon", label: "Icon", type: "icon", hint: ICON_HINT },
    ],
    learn: {
      what: "A Counter counts events. Automations call counter.increment / " +
        "counter.decrement / counter.reset; the value is available as a " +
        "sensor-like state.",
      when: [
        "How many times did the door open today?",
        "Failed-attempts counter that locks something after N tries",
        "Chores / habits tracking (coffees, workouts, waterings)",
      ],
      tips: [
        "Reset it nightly with a Time-triggered automation.",
        "Numeric state trigger fires when it crosses a threshold.",
      ],
      yaml:
`# Count front door openings, warn at 20
triggers:
  - trigger: state
    entity_id: binary_sensor.front_door
    to: "on"
actions:
  - action: counter.increment
    target:
      entity_id: counter.door_openings
  - if:
      - condition: numeric_state
        entity_id: counter.door_openings
        above: 19
    then:
      - action: notify.mobile_app_phone
        data:
          message: "Front door opened 20+ times today!"`
    }
  },

  timer: {
    kind: "storage", icon: "⏱️", name: "Timer",
    color: "#ff9d5c", entity: "timer",
    short: "A countdown that fires an event when it finishes.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true,
        ph: "Laundry" },
      { key: "duration", label: "Default duration", type: "duration",
        def: "00:05:00",
        hint: { t: "Default duration", b: "Used when timer.start is called " +
          "without an explicit duration. You can always override it per " +
          "start call.", ex: "00:05:00  (5 minutes)" } },
      { key: "restore", label: "Restore after restart", type: "bool",
        def: false,
        hint: { t: "Restore", b: "If on, a running timer survives a Home " +
          "Assistant restart and resumes counting." } },
      { key: "icon", label: "Icon", type: "icon", hint: ICON_HINT },
    ],
    learn: {
      what: "A Timer counts down from a duration and fires the " +
        "timer.finished event at zero. States: idle, active, paused.",
      when: [
        "Motion lights: restart the timer on motion, lights off on finish",
        "Kitchen / laundry countdowns visible on a dashboard",
        "'Auto-off anything after N minutes' patterns",
      ],
      tips: [
        "Restarting an active timer just resets the countdown — ideal for " +
          "presence-based lighting.",
        "Trigger on finish with: trigger: event / event_type: timer.finished " +
          "+ event_data: entity_id: timer.x",
      ],
      yaml:
`# Light off when the motion timer finishes
triggers:
  - trigger: event
    event_type: timer.finished
    event_data:
      entity_id: timer.hallway_motion
actions:
  - action: light.turn_off
    target:
      entity_id: light.hallway`
    }
  },

  schedule: {
    kind: "storage", icon: "🗓️", name: "Schedule",
    color: "#5cc8ff", entity: "schedule",
    short: "A weekly on/off timetable — on during the blocks you draw.",
    fields: [
      { key: "name", label: "Name", type: "text", required: true,
        ph: "Heating schedule" },
      { key: "__week", label: "Weekly time blocks", type: "schedule",
        hint: { t: "Time blocks", b: "The schedule entity is ON while " +
          "inside any block and OFF outside. Blocks must not overlap " +
          "within a day; 'to' may be 24:00 for end-of-day." } },
      { key: "icon", label: "Icon", type: "icon", hint: ICON_HINT },
    ],
    learn: {
      what: "A Schedule helper is ON during weekly time blocks you define " +
        "and OFF the rest of the time. It replaces piles of time triggers " +
        "with one editable timetable.",
      when: [
        "Heating / cooling windows per weekday",
        "'Quiet hours' condition for noisy automations",
        "Shop-hours style logic (different blocks per day)",
      ],
      tips: [
        "Use it as a condition (state = on) or trigger on its on/off edges.",
        "One schedule can gate many automations at once.",
      ],
      yaml:
`# Heat only inside the schedule
triggers:
  - trigger: state
    entity_id: schedule.heating
actions:
  - if:
      - condition: state
        entity_id: schedule.heating
        state: "on"
    then:
      - action: climate.turn_on
        target:
          entity_id: climate.living
    else:
      - action: climate.turn_off
        target:
          entity_id: climate.living`
    }
  },

  /* ========================== config-entry helpers ========================== */

  group: {
    kind: "entry", icon: "🧺", name: "Group", handler: "group",
    color: "#3ecf8e",
    short: "Combine several entities into one (lights, switches, sensors…).",
    learn: {
      what: "A Group merges several entities of the same kind into a " +
        "single entity. A light group turns all its lights on/off " +
        "together and reports a combined state; sensor groups can report " +
        "min/max/mean of their members.",
      when: [
        "All ceiling spots as one light",
        "'Any window open?' — a binary sensor group with mode: any",
        "Average temperature of several rooms (sensor group)",
      ],
      tips: [
        "Pick the group type first (light, switch, sensor, binary sensor, " +
          "cover, fan, lock, media player, event).",
        "Groups nest: a group can contain other groups.",
      ],
      yaml:
`# Use a light group like any light
actions:
  - action: light.turn_on
    target:
      entity_id: light.living_room_group
    data:
      brightness_pct: 60`
    }
  },

  template: {
    kind: "entry", icon: "🧪", name: "Template", handler: "template",
    color: "#22b8cf",
    short: "Create a sensor/switch/etc. from a Jinja2 template.",
    learn: {
      what: "A Template helper builds a brand-new entity whose state is " +
        "computed by a Jinja2 template from other entities. The most " +
        "powerful helper — anything you can express as a template becomes " +
        "an entity.",
      when: [
        "Combine sensors: 'feels like' from temperature + humidity + wind",
        "Translate states: turn a numeric battery level into ok/low/critical",
        "Count things: how many lights are on right now",
      ],
      tips: [
        "Template syntax: {{ states('sensor.x') | float(0) * 2 }}",
        "Test templates first in HA's Developer Tools → Template.",
        "Set a unit and device class so graphs and dashboards behave.",
      ],
      yaml:
`# Template example: lights currently on
{{ states.light
   | selectattr('state','eq','on') | list | count }}`
    }
  },

  threshold: {
    kind: "entry", icon: "📏", name: "Threshold", handler: "threshold",
    color: "#ffb86b",
    short: "Binary sensor that flips when a number crosses a limit.",
    learn: {
      what: "A Threshold helper watches one numeric sensor and produces a " +
        "binary sensor: ON when the value is above/below/within your " +
        "limits. Hysteresis prevents rapid flip-flopping near the limit.",
      when: [
        "Humidity above 65% → 'too humid' binary sensor",
        "Power draw above 10 W → 'TV is really on'",
        "Temperature within a comfort band",
      ],
      tips: [
        "Set hysteresis to ~2–5% of the range to avoid chattering.",
        "Trigger automations on the binary sensor, not the raw number — " +
          "cleaner and reusable.",
      ],
      yaml:
`triggers:
  - trigger: state
    entity_id: binary_sensor.too_humid
    to: "on"
actions:
  - action: switch.turn_on
    target:
      entity_id: switch.dehumidifier`
    }
  },

  derivative: {
    kind: "entry", icon: "📉", name: "Derivative", handler: "derivative",
    color: "#ff8fd8",
    short: "Rate of change of a sensor (per second/minute/hour…).",
    learn: {
      what: "A Derivative helper computes how fast a sensor changes — " +
        "°C per hour, liters per minute, % per hour. Great for detecting " +
        "trends and leaks that absolute values hide.",
      when: [
        "Water tank level dropping fast → possible leak",
        "Temperature rising quickly → someone opened the oven / fire risk",
        "Battery drain rate monitoring",
      ],
      tips: [
        "Set a time window to smooth noisy sensors.",
        "Negative values mean the source is decreasing.",
      ],
      yaml:
`triggers:
  - trigger: numeric_state
    entity_id: sensor.tank_level_derivative
    below: -5      # dropping >5%/h
actions:
  - action: notify.mobile_app_phone
    data:
      message: "Tank draining fast — check for a leak!"`
    }
  },

  integration: {
    kind: "entry", icon: "∫", name: "Integral (Riemann)",
    handler: "integration", color: "#6be675",
    short: "Accumulates a rate into a total — e.g. power (W) → energy (kWh).",
    learn: {
      what: "The Integral helper (Riemann sum) does the opposite of " +
        "Derivative: it accumulates a rate over time into a total. Its " +
        "classic job is turning a power sensor (W) into an energy sensor " +
        "(kWh) usable in HA's Energy dashboard.",
      when: [
        "Power (W) → Energy (kWh) for plugs without native energy readings",
        "Flow rate (L/min) → total water used (L)",
      ],
      tips: [
        "Method 'left' is recommended for power→energy.",
        "Combine with a Utility Meter to get daily/monthly totals.",
      ],
      yaml:
`# The resulting kWh sensor plugs straight
# into Settings → Dashboards → Energy.`
    }
  },

  utility_meter: {
    kind: "entry", icon: "🧮", name: "Utility Meter",
    handler: "utility_meter", color: "#5cc8ff",
    short: "Tracks consumption per billing cycle (daily/monthly/…).",
    learn: {
      what: "A Utility Meter takes an always-growing total (energy, water, " +
        "gas) and slices it into cycles: daily, weekly, monthly, yearly. " +
        "It resets itself at each cycle boundary and remembers the " +
        "previous cycle's value.",
      when: [
        "Monthly electricity consumption matching your utility bill",
        "Daily water usage",
        "Peak/off-peak tariffs (define tariffs, switch them by automation)",
      ],
      tips: [
        "Source must be a cumulative (total_increasing) sensor.",
        "With tariffs, an automation switches the active tariff — e.g. by " +
          "time of day.",
      ],
      yaml:
`# Switch tariff at 23:00 (off-peak)
triggers:
  - trigger: time
    at: "23:00:00"
actions:
  - action: select.select_option
    target:
      entity_id: select.energy_meter
    data:
      option: "offpeak"`
    }
  },

  tod: {
    kind: "entry", icon: "🌗", name: "Times of the Day", handler: "tod",
    color: "#ffd75c",
    short: "Binary sensor that is ON between two times of day.",
    learn: {
      what: "A Times-of-the-Day helper is a binary sensor that is ON " +
        "between an after-time and a before-time. Both support fixed " +
        "times or sunrise/sunset with offsets.",
      when: [
        "'Night' sensor: sunset → sunrise",
        "'Work hours' condition for notification routing",
      ],
      tips: [
        "Prefer this over writing time conditions in every automation — " +
          "define once, use everywhere.",
        "For weekly patterns with per-day blocks use a Schedule instead.",
      ],
      yaml:
`conditions:
  - condition: state
    entity_id: binary_sensor.night
    state: "on"`
    }
  },

  trend: {
    kind: "entry", icon: "📈", name: "Trend", handler: "trend",
    color: "#ff6b81",
    short: "Binary sensor: is a value going up or down?",
    learn: {
      what: "A Trend helper watches a sensor over a sample window and " +
        "turns ON when the value trends in the chosen direction faster " +
        "than a gradient you set.",
      when: [
        "Humidity rising quickly → someone is showering",
        "Temperature falling → a window was opened",
      ],
      tips: [
        "Tune sample count and max age to your sensor's update rate.",
        "For an exact numeric rate use Derivative; Trend answers yes/no.",
      ],
      yaml:
`triggers:
  - trigger: state
    entity_id: binary_sensor.humidity_rising
    to: "on"
actions:
  - action: fan.turn_on
    target:
      entity_id: fan.bathroom`
    }
  },

  statistics: {
    kind: "entry", icon: "📊", name: "Statistics", handler: "statistics",
    color: "#b17aff",
    short: "Mean / min / max / count of a sensor over a window.",
    learn: {
      what: "A Statistics helper computes a statistical characteristic " +
        "(mean, median, min, max, standard deviation, count…) of one " +
        "sensor over a sliding window of time or samples.",
      when: [
        "Average temperature over the last hour (smooth noisy sensors)",
        "Max power draw today",
        "How often did motion trigger in the last 24 h (count)",
      ],
      tips: [
        "Trigger automations on the smoothed value instead of the raw " +
          "sensor to ignore spikes.",
      ],
      yaml:
`triggers:
  - trigger: numeric_state
    entity_id: sensor.living_temp_mean_1h
    above: 26
actions:
  - action: climate.turn_on
    target:
      entity_id: climate.living`
    }
  },

  min_max: {
    kind: "entry", icon: "🔀", name: "Min / Max / Mean", handler: "min_max",
    color: "#3ecf8e",
    short: "Combine several numeric sensors into one (min, max, mean…).",
    learn: {
      what: "A Min/Max helper combines multiple numeric sensors into one " +
        "value: minimum, maximum, mean, median, last, range or sum.",
      when: [
        "Coldest room in the house (min of all temperature sensors)",
        "Total power of several plugs (sum)",
        "House average humidity (mean)",
      ],
      tips: [
        "All source sensors should share the same unit.",
        "A sensor Group with a type can do similar things — Min/Max offers " +
          "more statistic choices.",
      ],
      yaml:
`triggers:
  - trigger: numeric_state
    entity_id: sensor.coldest_room
    below: 16
actions:
  - action: notify.mobile_app_phone
    data:
      message: "A room dropped below 16°C!"`
    }
  },

  random: {
    kind: "entry", icon: "🎲", name: "Random", handler: "random",
    color: "#ffb86b",
    short: "A sensor that returns a random value when updated.",
    learn: {
      what: "A Random helper produces a random number in a range (or a " +
        "random binary state) each time it updates. Niche but fun.",
      when: [
        "Vacation lighting that doesn't look robotic",
        "Random delays or picking a random scene",
      ],
      tips: [
        "Force a new value with homeassistant.update_entity.",
        "For random picks in automations, Jinja's random filter is often " +
          "simpler: {{ ['a','b','c'] | random }}",
      ],
      yaml:
`actions:
  - action: homeassistant.update_entity
    target:
      entity_id: sensor.random_minutes
  - delay:
      minutes: "{{ states('sensor.random_minutes') | int(5) }}"`
    }
  },

  switch_as_x: {
    kind: "entry", icon: "🔁", name: "Change device type",
    handler: "switch_as_x", color: "#8b98b8",
    short: "Show a switch as a light, cover, fan, lock, siren or valve.",
    learn: {
      what: "Switch-as-X wraps an existing switch entity and presents it " +
        "as a different device type: light, cover, fan, lock, outlet, " +
        "siren or valve. The original switch gets hidden.",
      when: [
        "A smart plug that powers a lamp → show it as a light",
        "A relay driving a valve → show it as a valve",
      ],
      tips: [
        "Voice assistants then treat it correctly ('turn off the lights' " +
          "includes it).",
        "Only works on switch entities.",
      ],
      yaml:
`# After wrapping, target the new entity type
actions:
  - action: light.turn_on
    target:
      entity_id: light.desk_lamp`
    }
  },
};

/* Display order in the type picker */
const TYPE_ORDER = [
  "input_boolean", "input_button", "input_number", "input_text",
  "input_select", "input_datetime", "counter", "timer", "schedule",
  "group", "template", "threshold", "tod", "trend", "min_max",
  "statistics", "derivative", "integration", "utility_meter",
  "random", "switch_as_x",
];

/* Weekday keys/labels for the schedule editor */
const WEEKDAYS = [
  ["monday", "Mon"], ["tuesday", "Tue"], ["wednesday", "Wed"],
  ["thursday", "Thu"], ["friday", "Fri"], ["saturday", "Sat"],
  ["sunday", "Sun"],
];

/* Anchor Five — core program logic (pure functions, no DOM). Works in browser and Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Main program lifts. `dumbbell: true` = weight is per dumbbell (no bar, no plate calc).
     `legacy: true` = kept only so old log entries still have a name (not in the program any more). */
  var LIFTS = {
    squat:    { name: 'Squat',          sets: 5, reps: 5 },
    bench:    { name: 'Bench Press',    sets: 5, reps: 5 },
    dbrow:    { name: 'Dumbbell Row',   sets: 5, reps: 5, dumbbell: true },
    ohp:      { name: 'Overhead Press', sets: 5, reps: 5 },
    deadlift: { name: 'Deadlift',       sets: 1, reps: 5 },
    row:      { name: 'Barbell Row',    sets: 5, reps: 5, legacy: true }
  };
  var PROGRAM_LIFTS = ['squat', 'bench', 'dbrow', 'ohp', 'deadlift'];
  var WORKOUTS = { A: ['squat', 'bench', 'dbrow'], B: ['squat', 'ohp', 'deadlift'] };
  var FAILS_BEFORE_DELOAD = 3;
  var DELOAD_PCT = 0.10;
  var STATE_VERSION = 2;

  var UNIT_DEFAULTS = {
    lb: { bar: 45, inc: 5, dlInc: 10, dbInc: 5, dbMin: 5, round: 5, plates: [45, 35, 25, 10, 5, 2.5],
          start: { squat: 45, bench: 45, dbrow: 20, ohp: 45, deadlift: 95, row: 65 } },
    kg: { bar: 20, inc: 2.5, dlInc: 5, dbInc: 2.5, dbMin: 2.5, round: 2.5, plates: [25, 20, 15, 10, 5, 2.5, 1.25],
          start: { squat: 20, bench: 20, dbrow: 10, ohp: 20, deadlift: 40, row: 30 } }
  };

  /* ---------- exercise library ---------- */
  // equip: 'free' (free weights) | 'cable' (cable machine). perHand: weight is per dumbbell.
  function ex(id, name, equip, group, sets, reps, perHand) {
    return { id: id, name: name, equip: equip, group: group, sets: sets, reps: reps, perHand: !!perHand };
  }
  var EXERCISES = [
    ex('db-bench', 'Dumbbell Bench Press', 'free', 'Chest', 3, 10, true),
    ex('incline-db', 'Incline Dumbbell Press', 'free', 'Chest', 3, 10, true),
    ex('db-fly', 'Dumbbell Fly', 'free', 'Chest', 3, 12, true),
    ex('db-row-1arm', 'One-Arm Dumbbell Row', 'free', 'Back', 3, 10, true),
    ex('db-pullover', 'Dumbbell Pullover', 'free', 'Back', 3, 12, false),
    ex('rdl', 'Romanian Deadlift (DB)', 'free', 'Legs', 3, 10, true),
    ex('goblet-squat', 'Goblet Squat', 'free', 'Legs', 3, 10, false),
    ex('lunge', 'Dumbbell Lunge', 'free', 'Legs', 3, 10, true),
    ex('split-squat', 'Bulgarian Split Squat', 'free', 'Legs', 3, 8, true),
    ex('db-step-up', 'Dumbbell Step-Up', 'free', 'Legs', 3, 10, true),
    ex('db-press', 'Dumbbell Shoulder Press', 'free', 'Shoulders', 3, 10, true),
    ex('lat-raise', 'Lateral Raise', 'free', 'Shoulders', 3, 12, true),
    ex('rear-delt', 'Rear Delt Fly', 'free', 'Shoulders', 3, 12, true),
    ex('db-shrug', 'Dumbbell Shrug', 'free', 'Shoulders', 3, 12, true),
    ex('db-curl', 'Dumbbell Curl', 'free', 'Arms', 3, 10, true),
    ex('hammer-curl', 'Hammer Curl', 'free', 'Arms', 3, 10, true),
    ex('skull-crusher', 'Dumbbell Skull Crusher', 'free', 'Arms', 3, 10, true),
    ex('oh-tri-db', 'Overhead Triceps Extension (DB)', 'free', 'Arms', 3, 12, false),
    ex('farmer-carry', "Farmer's Carry (steps)", 'free', 'Core', 3, 30, true),
    ex('lat-pulldown', 'Lat Pulldown', 'cable', 'Back', 3, 10),
    ex('cable-row', 'Seated Cable Row', 'cable', 'Back', 3, 10),
    ex('straight-arm', 'Straight-Arm Pulldown', 'cable', 'Back', 3, 12),
    ex('face-pull', 'Face Pull', 'cable', 'Shoulders', 3, 15),
    ex('cable-lat-raise', 'Cable Lateral Raise', 'cable', 'Shoulders', 3, 12),
    ex('cable-fly', 'Cable Fly', 'cable', 'Chest', 3, 12),
    ex('cable-press', 'Standing Cable Chest Press', 'cable', 'Chest', 3, 10),
    ex('pushdown', 'Triceps Pushdown', 'cable', 'Arms', 3, 12),
    ex('cable-oh-tri', 'Overhead Cable Triceps Extension', 'cable', 'Arms', 3, 12),
    ex('cable-curl', 'Cable Curl', 'cable', 'Arms', 3, 12),
    ex('cable-crunch', 'Cable Crunch', 'cable', 'Core', 3, 15),
    ex('pallof', 'Pallof Press', 'cable', 'Core', 3, 10),
    ex('woodchop', 'Cable Woodchop', 'cable', 'Core', 3, 12),
    ex('pull-through', 'Cable Pull-Through', 'cable', 'Legs', 3, 12),
    ex('cable-kickback', 'Cable Glute Kickback', 'cable', 'Legs', 3, 12)
  ];
  var EX_BY_ID = {};
  EXERCISES.forEach(function (e) { EX_BY_ID[e.id] = e; });
  function exercisesFor(equip) { return EXERCISES.filter(function (e) { return !equip || equip === 'all' || e.equip === equip; }); }

  /** Accessory/template item built from a library exercise. */
  function itemFromExercise(id) {
    var e = EX_BY_ID[id];
    if (!e) throw new Error('Unknown exercise ' + id);
    return { name: e.name, sets: e.sets, reps: e.reps, weight: 0, ex: e.id, equip: e.equip, perHand: e.perHand };
  }

  /* ---------- recovery (sauna / hot tub) ---------- */
  // General, commonly cited guidance: sauna ~15–20 min, hot tub ~10–15 min. User-adjustable within limits.
  var RECOVERY = {
    sauna:  { name: 'Sauna',   rec: 15, min: 5, max: 20 },
    hottub: { name: 'Hot Tub', rec: 12, min: 5, max: 15 }
  };
  function recoveryMinutes(type, minutes) {
    var r = RECOVERY[type]; if (!r) throw new Error('Unknown recovery type');
    var m = minutes == null ? r.rec : Math.round(Number(minutes));
    if (!isFinite(m)) m = r.rec;
    return Math.max(r.min, Math.min(r.max, m));
  }
  /* Countdown timer as plain data: {duration (ms), elapsed (ms banked), startedAt (ms|null)} */
  function cdNew(sec) { return { duration: sec * 1000, elapsed: 0, startedAt: null }; }
  function cdRunning(t) { return t.startedAt != null; }
  function cdElapsed(t, now) { return t.elapsed + (t.startedAt != null ? Math.max(0, now - t.startedAt) : 0); }
  function cdRemaining(t, now) { return Math.max(0, t.duration - cdElapsed(t, now)); }
  function cdStart(t, now) { if (t.startedAt == null && cdRemaining(t, now) > 0) t.startedAt = now; return t; }
  function cdPause(t, now) { if (t.startedAt != null) { t.elapsed = Math.min(t.duration, cdElapsed(t, now)); t.startedAt = null; } return t; }
  function cdReset(t) { t.elapsed = 0; t.startedAt = null; return t; }
  function cdSetDuration(t, sec, now) { t.duration = sec * 1000; if (cdRemaining(t, now) <= 0) cdPause(t, now); return t; }
  function cdDone(t, now) { return cdRemaining(t, now) <= 0; }

  function logRecovery(state, rec) {
    state.recoveryLog = state.recoveryLog || [];
    var entry = { id: rec.id || ('r' + Date.now().toString(36)), date: rec.date || new Date().toISOString(), type: rec.type,
      plannedSec: Math.round(rec.plannedSec), actualSec: Math.round(rec.actualSec), afterSession: rec.afterSession || null };
    state.recoveryLog.push(entry);
    return entry;
  }

  /* ---------- state ---------- */
  function liftDefaults(k, d) {
    var L = LIFTS[k];
    return { weight: d.start[k], inc: k === 'deadlift' ? d.dlInc : (L.dumbbell ? d.dbInc : d.inc), fails: 0 };
  }
  function defaultState(units) {
    units = units || 'lb';
    var d = UNIT_DEFAULTS[units];
    var lifts = {};
    PROGRAM_LIFTS.forEach(function (k) { lifts[k] = liftDefaults(k, d); });
    return {
      version: STATE_VERSION,
      units: units,
      bar: d.bar,
      plates: d.plates.slice(),
      lifts: lifts,
      rest: { success: 90, fail: 180, failAgain: 300 },
      showWarmups: true,
      nextWorkout: 'A',
      accessories: {
        A: [{ name: 'Dips', sets: 3, reps: 10, weight: 0 }],
        B: [{ name: 'Chin-ups', sets: 3, reps: 8, weight: 0 }]
      },
      customDays: [],
      recovery: { type: 'sauna', minutes: { sauna: RECOVERY.sauna.rec, hottub: RECOVERY.hottub.rec } },
      recoveryLog: [],
      deletedIds: [],
      lastModified: 0,
      history: [],
      current: null
    };
  }

  function roundTo(x, step) {
    step = step || 1;
    return Math.round(Math.round(x / step) * step * 1000) / 1000;
  }
  function floorTo(x, step) {
    step = step || 1;
    return Math.round(Math.floor(x / step + 1e-9) * step * 1000) / 1000;
  }
  function isDumbbell(k) { return !!(LIFTS[k] && LIFTS[k].dumbbell); }
  /** Lowest sensible weight for a lift: empty bar, or the smallest dumbbell step. */
  function minWeight(k, state) { return isDumbbell(k) ? UNIT_DEFAULTS[state.units].dbMin : state.bar; }

  /** Did this lift entry hit every rep of every set? */
  function isSuccess(entry) {
    var target = entry.reps || 5;
    var n = entry.setsTarget || entry.sets.length;
    if (entry.sets.length < n) return false;
    for (var i = 0; i < n; i++) if (!(entry.sets[i] >= target)) return false;
    return true;
  }

  /** Weight to use after a deload. Never below the empty bar (or smallest dumbbell for DB lifts). */
  function deloadWeight(weight, state, liftKey) {
    var step = UNIT_DEFAULTS[state.units].round;
    if (isDumbbell(liftKey)) step = UNIT_DEFAULTS[state.units].dbInc;
    return Math.max(minWeight(liftKey, state), floorTo(weight * (1 - DELOAD_PCT), step));
  }

  /**
   * Apply a finished session to state. Mutates and returns {state, changes}.
   * session = { id, date, workout:'A'|'B'|'C', lifts:[{lift, weight, sets:[reps|null], reps, setsTarget}], accessories:[...] }
   * Custom days ('C') have no main lifts and do not change the A/B rotation.
   */
  function applySession(state, session) {
    var changes = [];
    (session.lifts || []).forEach(function (e) {
      var L = state.lifts[e.lift];
      if (!L) return;
      var before = e.weight;
      var ok = isSuccess(e);
      e.success = ok;
      if (ok) {
        L.weight = roundTo(e.weight + L.inc, 0.25);
        L.fails = 0;
        changes.push({ lift: e.lift, type: 'up', from: before, to: L.weight });
      } else {
        L.fails = (L.fails || 0) + 1;
        if (L.fails >= FAILS_BEFORE_DELOAD) {
          L.weight = deloadWeight(e.weight, state, e.lift);
          L.fails = 0;
          changes.push({ lift: e.lift, type: 'deload', from: before, to: L.weight });
        } else {
          L.weight = e.weight;
          changes.push({ lift: e.lift, type: 'repeat', from: before, to: L.weight, fails: L.fails });
        }
      }
    });
    rememberAccessoryWeights(state, session);
    state.history.push(session);
    if (session.workout === 'A') state.nextWorkout = 'B';
    else if (session.workout === 'B') state.nextWorkout = 'A';
    return { state: state, changes: changes };
  }

  /** Carry the weight used for each accessory back to the template it came from (A/B list or custom day). */
  function rememberAccessoryWeights(state, session) {
    var list = null;
    if (session.workout === 'A' || session.workout === 'B') list = state.accessories[session.workout];
    else if (session.dayId) {
      var day = (state.customDays || []).filter(function (d) { return d.id === session.dayId; })[0];
      list = day && day.items;
    }
    if (!list) return;
    (session.accessories || []).forEach(function (a) {
      var t = list.filter(function (x) { return x.name === a.name && (x.ex || null) === (a.ex || null); })[0];
      if (t && a.weight >= 0) t.weight = a.weight;
    });
  }

  /** Plates per side for a total load. Returns {perSide:[...], leftover, achievable} */
  function plateCalc(total, bar, plates) {
    var sorted = plates.slice().sort(function (a, b) { return b - a; });
    var side = (total - bar) / 2;
    var out = [];
    if (side < 0) return { perSide: [], leftover: side * 2, achievable: false };
    var rem = Math.round(side * 1000) / 1000;
    sorted.forEach(function (p) {
      while (rem + 1e-9 >= p) { out.push(p); rem = Math.round((rem - p) * 1000) / 1000; }
    });
    return { perSide: out, leftover: rem * 2, achievable: rem < 1e-6 };
  }

  /** Warm-up sets leading to a work weight. Dumbbell lifts: one lighter set (no bar). */
  function warmups(work, state, liftKey) {
    if (isDumbbell(liftKey)) {
      var dstep = UNIT_DEFAULTS[state.units].dbInc;
      var lw = floorTo(work * 0.5, dstep);
      return lw >= dstep && lw < work ? [{ weight: lw, reps: 8 }] : [];
    }
    var bar = state.bar;
    var step = UNIT_DEFAULTS[state.units].round;
    var sets = [];
    if (work <= bar) return sets;
    if (liftKey === 'deadlift' || liftKey === 'row') {
      // pulled from the floor: start higher than empty bar
    } else {
      sets.push({ weight: bar, reps: 5 }, { weight: bar, reps: 5 });
    }
    var scheme = [[0.4, 5], [0.6, 3], [0.8, 2]];
    scheme.forEach(function (s) {
      var w = roundTo(work * s[0], step);
      if (w > bar && w < work && (!sets.length || w > sets[sets.length - 1].weight)) sets.push({ weight: w, reps: s[1] });
    });
    if (!sets.length) sets.push({ weight: bar, reps: 5 });
    return sets;
  }

  /** Epley estimated 1-rep max */
  function e1rm(weight, reps) {
    if (!reps || reps <= 0) return 0;
    if (reps === 1) return weight;
    return Math.round(weight * (1 + reps / 30) * 10) / 10;
  }

  /** Best e1RM from a logged lift entry (uses best set). */
  function entryE1rm(entry) {
    var best = 0;
    (entry.sets || []).forEach(function (r) { if (r > 0) best = Math.max(best, e1rm(entry.weight, r)); });
    return best;
  }

  /** Rest seconds after logging a set. failedSoFar = failed sets already in this exercise (incl. this one). */
  function restFor(reps, target, failedSoFar, rest) {
    if (reps >= target) return rest.success;
    return failedSoFar >= 2 ? rest.failAgain : rest.fail;
  }

  function accFromTemplate(a) {
    var o = { name: a.name, weight: a.weight, reps: a.reps, sets: new Array(a.sets).fill(null) };
    if (a.ex) { o.ex = a.ex; o.equip = a.equip; o.perHand = !!a.perHand; }
    return o;
  }

  /** Build a fresh session for the next workout (A/B). */
  function newSession(state) {
    var w = state.nextWorkout;
    return {
      id: Date.now().toString(36),
      date: new Date().toISOString(),
      workout: w,
      lifts: WORKOUTS[w].map(function (k) {
        var n = LIFTS[k].sets;
        return { lift: k, weight: state.lifts[k].weight, reps: LIFTS[k].reps, setsTarget: n, sets: new Array(n).fill(null) };
      }),
      accessories: (state.accessories[w] || []).map(accFromTemplate)
    };
  }

  /** Build a session from a custom day (library exercises only, no 5x5 lifts). */
  function newCustomSession(state, dayId) {
    var day = (state.customDays || []).filter(function (d) { return d.id === dayId; })[0];
    if (!day) throw new Error('No such custom day');
    return { id: Date.now().toString(36), date: new Date().toISOString(), workout: 'C', dayId: day.id, dayName: day.name,
      lifts: [], accessories: day.items.map(accFromTemplate) };
  }

  /** Add a library exercise to the in-progress session. */
  function addExerciseToSession(session, id) {
    var item = accFromTemplate(itemFromExercise(id));
    session.accessories = session.accessories || [];
    session.accessories.push(item);
    return item;
  }

  function addCustomDay(state, name) {
    state.customDays = state.customDays || [];
    var day = { id: 'd' + Date.now().toString(36) + state.customDays.length, name: String(name || '').trim() || ('Day ' + (state.customDays.length + 1)), items: [] };
    state.customDays.push(day);
    return day;
  }

  /** Switch units, converting all weights. */
  function convertUnits(state, to) {
    if (state.units === to) return state;
    var f = to === 'kg' ? 0.45359237 : 1 / 0.45359237;
    var d = UNIT_DEFAULTS[to];
    Object.keys(state.lifts).forEach(function (k) {
      var L = state.lifts[k];
      if (isDumbbell(k)) {
        L.weight = Math.max(d.dbMin, roundTo(L.weight * f, d.dbInc));
        L.inc = d.dbInc;
      } else {
        L.weight = Math.max(d.bar, roundTo(L.weight * f, d.round));
        L.inc = k === 'deadlift' ? d.dlInc : d.inc;
      }
    });
    var conv = function (a) { a.weight = roundTo(a.weight * f, d.round / 2); };
    ['A', 'B'].forEach(function (w) { (state.accessories[w] || []).forEach(conv); });
    (state.customDays || []).forEach(function (day) { day.items.forEach(conv); });
    state.bar = d.bar;
    state.plates = d.plates.slice();
    state.units = to;
    return state;
  }

  /**
   * Barbell Row → Dumbbell Row migration (v1 → v2).
   * Old row history stays as-is and is labelled "Barbell Row" in the log. The new Dumbbell Row
   * working weight starts at ~half the barbell row weight per dumbbell (rounded down to the DB step).
   * An in-progress session with a barbell row is switched to dumbbell row (reps already logged are kept).
   */
  function migrateRow(obj) {
    var d = UNIT_DEFAULTS[obj.units];
    if (!obj.lifts.dbrow) {
      var old = obj.lifts.row;
      var w = old && Number(old.weight) > 0 ? Math.max(d.dbMin, floorTo(Number(old.weight) / 2, d.dbInc)) : d.start.dbrow;
      obj.lifts.dbrow = { weight: w, inc: d.dbInc, fails: 0 };
    }
    if (obj.current && Array.isArray(obj.current.lifts)) {
      obj.current.lifts.forEach(function (e) {
        if (e.lift === 'row') { e.lift = 'dbrow'; e.weight = obj.lifts.dbrow.weight; }
      });
    }
    if (obj.nextWorkout !== 'A' && obj.nextWorkout !== 'B') obj.nextWorkout = 'A';
    return obj;
  }

  /** Validate / normalize imported or stored data (and migrate old versions). Throws on garbage. */
  function normalize(obj) {
    if (!obj || typeof obj !== 'object' || !obj.lifts || typeof obj.lifts !== 'object' || !Array.isArray(obj.history)) throw new Error('Not an Anchor Five backup');
    var base = defaultState(obj.units === 'kg' ? 'kg' : 'lb');
    obj.units = base.units;
    Object.keys(base).forEach(function (k) { if (obj[k] === undefined) obj[k] = base[k]; });
    migrateRow(obj);
    Object.keys(LIFTS).forEach(function (k) {
      if (!obj.lifts[k]) { if (LIFTS[k].legacy) return; obj.lifts[k] = base.lifts[k]; }
      var def = base.lifts[k] || liftDefaults(k, UNIT_DEFAULTS[obj.units]);
      obj.lifts[k].weight = Number(obj.lifts[k].weight) || def.weight;
      obj.lifts[k].inc = Number(obj.lifts[k].inc) || def.inc;
      obj.lifts[k].fails = Number(obj.lifts[k].fails) || 0;
    });
    if (!obj.accessories || typeof obj.accessories !== 'object') obj.accessories = base.accessories;
    ['A', 'B'].forEach(function (w) { if (!Array.isArray(obj.accessories[w])) obj.accessories[w] = []; });
    if (!Array.isArray(obj.customDays)) obj.customDays = [];
    obj.customDays.forEach(function (d) { if (!Array.isArray(d.items)) d.items = []; });
    if (!Array.isArray(obj.recoveryLog)) obj.recoveryLog = [];
    if (!Array.isArray(obj.deletedIds)) obj.deletedIds = [];
    if (!obj.recovery || !obj.recovery.minutes) obj.recovery = base.recovery;
    obj.history.forEach(function (h) { if (!Array.isArray(h.lifts)) h.lifts = []; if (!Array.isArray(h.accessories)) h.accessories = []; });
    obj.lastModified = Number(obj.lastModified) || 0;
    obj.version = STATE_VERSION;
    return obj;
  }

  /* ---------- sync merge (iCloud) ----------
     Never loses data: logs (sessions, recovery) are unioned by id; deletions are carried as tombstones
     (deletedIds). Settings/working weights come from whichever copy was modified last. A workout that
     is in progress on this device is kept. Returns {state, changed}. */
  function byIdUnion(a, b, dead) {
    var m = {}, out = [];
    (a || []).concat(b || []).forEach(function (x) { if (x && x.id && !dead[x.id] && !m[x.id]) { m[x.id] = 1; out.push(x); } });
    return out.sort(function (x, y) { return new Date(x.date) - new Date(y.date); });
  }
  // Compare only synced content: ignore timestamps and device-local state (in-progress workout / recovery timer).
  function stripVolatile(s) {
    var c = JSON.parse(JSON.stringify(s)); delete c.lastModified; delete c.current; delete c.recoveryActive;
    c.deletedIds = (c.deletedIds || []).slice().sort(); return JSON.stringify(c);
  }
  function mergeStates(local, remote) {
    if (!remote) return { state: local, changed: false };
    remote = normalize(JSON.parse(JSON.stringify(remote)));
    local = normalize(local);
    var newer = (remote.lastModified || 0) > (local.lastModified || 0) ? remote : local;
    var older = newer === remote ? local : remote;
    var out = JSON.parse(JSON.stringify(newer));
    var deadList = []; var deadSeen = {};
    (local.deletedIds || []).concat(remote.deletedIds || []).forEach(function (id) { if (!deadSeen[id]) { deadSeen[id] = 1; deadList.push(id); } });
    out.deletedIds = deadList.sort();
    out.history = byIdUnion(newer.history, older.history, deadSeen);
    out.recoveryLog = byIdUnion(newer.recoveryLog, older.recoveryLog, deadSeen);
    var dayIds = {}; out.customDays = (newer.customDays || []).slice();
    out.customDays.forEach(function (d) { dayIds[d.id] = 1; });
    (older.customDays || []).forEach(function (d) { if (!dayIds[d.id] && !deadSeen[d.id]) out.customDays.push(d); });
    out.customDays = out.customDays.filter(function (d) { return !deadSeen[d.id]; });
    out.current = local.current || null; // in-progress workout belongs to this device
    if (local.recoveryActive) out.recoveryActive = local.recoveryActive; else delete out.recoveryActive; // device-local timer
    out.lastModified = Math.max(local.lastModified || 0, remote.lastModified || 0);
    var changed = stripVolatile(out) !== stripVolatile(local);
    // remoteStale: the cloud copy is missing something we have -> caller should save (push) the merged state.
    return { state: out, changed: changed, remoteStale: stripVolatile(out) !== stripVolatile(remote) };
  }

  return {
    LIFTS: LIFTS, PROGRAM_LIFTS: PROGRAM_LIFTS, WORKOUTS: WORKOUTS, UNIT_DEFAULTS: UNIT_DEFAULTS,
    FAILS_BEFORE_DELOAD: FAILS_BEFORE_DELOAD, DELOAD_PCT: DELOAD_PCT, STATE_VERSION: STATE_VERSION,
    EXERCISES: EXERCISES, EX_BY_ID: EX_BY_ID, exercisesFor: exercisesFor, itemFromExercise: itemFromExercise,
    RECOVERY: RECOVERY, recoveryMinutes: recoveryMinutes, logRecovery: logRecovery,
    cdNew: cdNew, cdRunning: cdRunning, cdElapsed: cdElapsed, cdRemaining: cdRemaining, cdStart: cdStart,
    cdPause: cdPause, cdReset: cdReset, cdSetDuration: cdSetDuration, cdDone: cdDone,
    defaultState: defaultState, roundTo: roundTo, isSuccess: isSuccess, isDumbbell: isDumbbell, minWeight: minWeight,
    deloadWeight: deloadWeight, applySession: applySession, rememberAccessoryWeights: rememberAccessoryWeights,
    plateCalc: plateCalc, warmups: warmups, e1rm: e1rm, entryE1rm: entryE1rm,
    restFor: restFor, newSession: newSession, newCustomSession: newCustomSession, addExerciseToSession: addExerciseToSession,
    addCustomDay: addCustomDay, convertUnits: convertUnits, migrateRow: migrateRow, normalize: normalize, mergeStates: mergeStates
  };
});

/* Anchor Five — core program logic (pure functions, no DOM). Works in browser and Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIFTS = {
    squat:    { name: 'Squat',          sets: 5, reps: 5 },
    bench:    { name: 'Bench Press',    sets: 5, reps: 5 },
    row:      { name: 'Barbell Row',    sets: 5, reps: 5 },
    ohp:      { name: 'Overhead Press', sets: 5, reps: 5 },
    deadlift: { name: 'Deadlift',       sets: 1, reps: 5 }
  };
  var WORKOUTS = { A: ['squat', 'bench', 'row'], B: ['squat', 'ohp', 'deadlift'] };
  var FAILS_BEFORE_DELOAD = 3;
  var DELOAD_PCT = 0.10;

  var UNIT_DEFAULTS = {
    lb: { bar: 45, inc: 5, dlInc: 10, round: 5, plates: [45, 35, 25, 10, 5, 2.5],
          start: { squat: 45, bench: 45, row: 65, ohp: 45, deadlift: 95 } },
    kg: { bar: 20, inc: 2.5, dlInc: 5, round: 2.5, plates: [25, 20, 15, 10, 5, 2.5, 1.25],
          start: { squat: 20, bench: 20, row: 30, ohp: 20, deadlift: 40 } }
  };

  function defaultState(units) {
    units = units || 'lb';
    var d = UNIT_DEFAULTS[units];
    var lifts = {};
    Object.keys(LIFTS).forEach(function (k) {
      lifts[k] = { weight: d.start[k], inc: k === 'deadlift' ? d.dlInc : d.inc, fails: 0 };
    });
    return {
      version: 1,
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

  /** Did this lift entry hit every rep of every set? */
  function isSuccess(entry) {
    var target = entry.reps || 5;
    var n = entry.setsTarget || entry.sets.length;
    if (entry.sets.length < n) return false;
    for (var i = 0; i < n; i++) if (!(entry.sets[i] >= target)) return false;
    return true;
  }

  /** Weight to use after a deload. Never below the empty bar. */
  function deloadWeight(weight, state) {
    var step = UNIT_DEFAULTS[state.units].round;
    return Math.max(state.bar, floorTo(weight * (1 - DELOAD_PCT), step));
  }

  /**
   * Apply a finished session to state. Mutates and returns {state, changes}.
   * session = { id, date, workout:'A'|'B', lifts:[{lift, weight, sets:[reps|null], reps, setsTarget}], accessories:[...] }
   */
  function applySession(state, session) {
    var changes = [];
    session.lifts.forEach(function (e) {
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
          L.weight = deloadWeight(e.weight, state);
          L.fails = 0;
          changes.push({ lift: e.lift, type: 'deload', from: before, to: L.weight });
        } else {
          L.weight = e.weight;
          changes.push({ lift: e.lift, type: 'repeat', from: before, to: L.weight, fails: L.fails });
        }
      }
    });
    state.history.push(session);
    state.nextWorkout = session.workout === 'A' ? 'B' : 'A';
    return { state: state, changes: changes };
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

  /** Warm-up sets leading to a work weight. */
  function warmups(work, state, liftKey) {
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

  /** Build a fresh session for the next workout. */
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
      accessories: (state.accessories[w] || []).map(function (a) {
        return { name: a.name, weight: a.weight, reps: a.reps, sets: new Array(a.sets).fill(null) };
      })
    };
  }

  /** Switch units, converting all weights. */
  function convertUnits(state, to) {
    if (state.units === to) return state;
    var f = to === 'kg' ? 0.45359237 : 1 / 0.45359237;
    var d = UNIT_DEFAULTS[to];
    Object.keys(state.lifts).forEach(function (k) {
      var L = state.lifts[k];
      L.weight = Math.max(d.bar, roundTo(L.weight * f, d.round));
      L.inc = k === 'deadlift' ? d.dlInc : d.inc;
    });
    ['A', 'B'].forEach(function (w) {
      (state.accessories[w] || []).forEach(function (a) { a.weight = roundTo(a.weight * f, d.round / 2); });
    });
    state.bar = d.bar;
    state.plates = d.plates.slice();
    state.units = to;
    return state;
  }

  /** Validate / normalize imported data. Throws on garbage. */
  function normalize(obj) {
    if (!obj || typeof obj !== 'object' || !obj.lifts || !Array.isArray(obj.history)) throw new Error('Not an Anchor Five backup');
    var base = defaultState(obj.units === 'kg' ? 'kg' : 'lb');
    Object.keys(base).forEach(function (k) { if (obj[k] === undefined) obj[k] = base[k]; });
    Object.keys(LIFTS).forEach(function (k) {
      if (!obj.lifts[k]) obj.lifts[k] = base.lifts[k];
      obj.lifts[k].weight = Number(obj.lifts[k].weight) || base.lifts[k].weight;
      obj.lifts[k].inc = Number(obj.lifts[k].inc) || base.lifts[k].inc;
      obj.lifts[k].fails = Number(obj.lifts[k].fails) || 0;
    });
    return obj;
  }

  return {
    LIFTS: LIFTS, WORKOUTS: WORKOUTS, UNIT_DEFAULTS: UNIT_DEFAULTS,
    FAILS_BEFORE_DELOAD: FAILS_BEFORE_DELOAD, DELOAD_PCT: DELOAD_PCT,
    defaultState: defaultState, roundTo: roundTo, isSuccess: isSuccess, deloadWeight: deloadWeight,
    applySession: applySession, plateCalc: plateCalc, warmups: warmups, e1rm: e1rm, entryE1rm: entryE1rm,
    restFor: restFor, newSession: newSession, convertUnits: convertUnits, normalize: normalize
  };
});

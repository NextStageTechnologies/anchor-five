// v2 tests: Dumbbell Row, migration, exercise library, custom days, recovery timer, sync merge.
module.exports = function (t, AF, assert, sess, all5) {
  t('standard program has no Barbell Row; Dumbbell Row is per-dumbbell, +5 lb', () => {
    const s = AF.defaultState();
    assert.ok(!s.lifts.row); assert.ok(s.lifts.dbrow);
    assert.equal(AF.LIFTS.dbrow.name, 'Dumbbell Row'); assert.ok(AF.isDumbbell('dbrow'));
    assert.equal(s.lifts.dbrow.inc, 5); assert.equal(s.lifts.dbrow.weight, 20);
    assert.deepEqual(AF.PROGRAM_LIFTS, ['squat', 'bench', 'dbrow', 'ohp', 'deadlift']);
    Object.values(AF.WORKOUTS).forEach(w => assert.ok(!w.includes('row')));
  });
  t('dumbbell row progresses +5 per dumbbell and deloads without the bar floor', () => {
    const s = AF.defaultState(); s.lifts.dbrow.weight = 40;
    AF.applySession(s, sess(s, all5)); assert.equal(s.lifts.dbrow.weight, 45);
    s.lifts.dbrow.weight = 25; s.lifts.dbrow.fails = 2; s.nextWorkout = 'A';
    AF.applySession(s, sess(s, e => e.lift === 'dbrow' ? [5, 5, 3, 3, 3] : all5(e)));
    assert.equal(s.lifts.dbrow.weight, 20); // 22.5 -> floor to 5 = 20, NOT the 45 lb bar
    s.lifts.dbrow.weight = 5; s.lifts.dbrow.fails = 2; s.nextWorkout = 'A';
    AF.applySession(s, sess(s, e => e.lift === 'dbrow' ? [0, 0, 0, 0, 0] : all5(e)));
    assert.equal(s.lifts.dbrow.weight, 5);
  });
  t('dumbbell warm-up: one lighter set, no bar', () => {
    const s = AF.defaultState();
    assert.deepEqual(AF.warmups(50, s, 'dbrow'), [{ weight: 25, reps: 8 }]);
    assert.deepEqual(AF.warmups(5, s, 'dbrow'), []);
  });
  t('migration: v1 data with Barbell Row -> Dumbbell Row, history kept and labelled', () => {
    const v1 = { version: 1, units: 'lb', bar: 45, plates: [45, 25, 10, 5, 2.5],
      lifts: { squat: { weight: 200, inc: 5, fails: 0 }, bench: { weight: 150, inc: 5, fails: 1 }, row: { weight: 135, inc: 5, fails: 2 },
               ohp: { weight: 95, inc: 5, fails: 0 }, deadlift: { weight: 250, inc: 10, fails: 0 } },
      rest: { success: 90, fail: 180, failAgain: 300 }, showWarmups: true, nextWorkout: 'B',
      accessories: { A: [], B: [] },
      history: [{ id: 'h1', date: '2026-10-01T10:00:00Z', workout: 'A', lifts: [{ lift: 'row', weight: 135, reps: 5, setsTarget: 5, sets: [5, 5, 5, 5, 5] }], accessories: [] }],
      current: { id: 'c1', date: '2026-10-27T10:00:00Z', workout: 'A', lifts: [{ lift: 'row', weight: 135, reps: 5, setsTarget: 5, sets: [5, 5, null, null, null] }], accessories: [] } };
    const s = AF.normalize(JSON.parse(JSON.stringify(v1)));
    assert.equal(s.version, 2);
    assert.equal(s.lifts.dbrow.weight, 65); // 135/2 = 67.5 -> 65 per dumbbell
    assert.equal(s.lifts.dbrow.inc, 5);
    assert.equal(s.history[0].lifts[0].lift, 'row'); assert.equal(AF.LIFTS.row.name, 'Barbell Row');
    assert.equal(s.current.lifts[0].lift, 'dbrow'); assert.deepEqual(s.current.lifts[0].sets, [5, 5, null, null, null]);
    assert.equal(s.lifts.squat.weight, 200); assert.equal(s.lifts.bench.fails, 1); assert.equal(s.nextWorkout, 'B');
    s.nextWorkout = 'A'; assert.deepEqual(AF.newSession(s).lifts.map(e => e.lift), ['squat', 'bench', 'dbrow']);
    assert.deepEqual(s.customDays, []); assert.deepEqual(s.recoveryLog, []);
    // finishing the migrated in-progress session doesn't crash and advances dbrow
    const c = s.current; s.current = null; c.lifts[0].sets = [5, 5, 5, 5, 5];
    AF.applySession(s, c); assert.equal(s.lifts.dbrow.weight, 70);
  });
  t('migration in kg; v1 data with no row at all gets the default', () => {
    const s = AF.normalize({ units: 'kg', lifts: { row: { weight: 60, inc: 2.5 } }, history: [] });
    assert.equal(s.lifts.dbrow.weight, 30); assert.equal(s.lifts.dbrow.inc, 2.5);
    const s2 = AF.normalize({ units: 'lb', lifts: {}, history: [] });
    assert.equal(s2.lifts.dbrow.weight, 20);
  });
  t('unit conversion keeps dumbbell row on dumbbell steps', () => {
    const s = AF.defaultState(); s.lifts.dbrow.weight = 50;
    AF.convertUnits(s, 'kg'); assert.equal(s.lifts.dbrow.weight, 22.5); assert.equal(s.lifts.dbrow.inc, 2.5);
    AF.convertUnits(s, 'lb'); assert.equal(s.lifts.dbrow.weight, 50); assert.equal(s.lifts.dbrow.inc, 5);
  });
  t('exercise library: free-weight vs cable filter, required exercises present, unique ids', () => {
    const free = AF.exercisesFor('free'), cable = AF.exercisesFor('cable');
    assert.ok(free.length >= 10 && cable.length >= 10);
    assert.ok(free.every(e => e.equip === 'free')); assert.ok(cable.every(e => e.equip === 'cable'));
    assert.equal(free.length + cable.length, AF.EXERCISES.length);
    ['Dumbbell Bench Press', 'Incline Dumbbell Press', 'Romanian Deadlift (DB)', 'Goblet Squat', 'Dumbbell Lunge', 'Dumbbell Shoulder Press', 'Dumbbell Curl']
      .forEach(n => assert.ok(free.some(e => e.name === n), n));
    ['Lat Pulldown', 'Seated Cable Row', 'Cable Fly', 'Face Pull', 'Triceps Pushdown', 'Cable Curl', 'Cable Crunch']
      .forEach(n => assert.ok(cable.some(e => e.name === n), n));
    assert.equal(new Set(AF.EXERCISES.map(e => e.id)).size, AF.EXERCISES.length);
    assert.ok(!JSON.stringify(AF.EXERCISES).toLowerCase().includes('stronglift'));
  });
  t('add library exercise to an in-progress session', () => {
    const s = AF.defaultState(); const x = AF.newSession(s);
    const n0 = x.accessories.length;
    const it = AF.addExerciseToSession(x, 'lat-pulldown');
    assert.equal(x.accessories.length, n0 + 1); assert.equal(it.name, 'Lat Pulldown'); assert.equal(it.equip, 'cable');
    assert.deepEqual(it.sets, [null, null, null]); assert.equal(it.reps, 10);
    assert.throws(() => AF.addExerciseToSession(x, 'nope'));
  });
  t('custom day: build, start, finish; A/B rotation untouched; weights remembered', () => {
    const s = AF.defaultState(); s.nextWorkout = 'B';
    const d = AF.addCustomDay(s, 'Cable day');
    d.items.push(AF.itemFromExercise('cable-row'), AF.itemFromExercise('face-pull'));
    const x = AF.newCustomSession(s, d.id);
    assert.equal(x.workout, 'C'); assert.equal(x.dayName, 'Cable day'); assert.equal(x.lifts.length, 0); assert.equal(x.accessories.length, 2);
    x.accessories[0].weight = 100; x.accessories[0].sets = [10, 10, 10];
    const r = AF.applySession(s, x);
    assert.equal(r.changes.length, 0); assert.equal(s.nextWorkout, 'B'); assert.equal(s.history.length, 1);
    assert.equal(d.items[0].weight, 100);
    assert.throws(() => AF.newCustomSession(s, 'missing'));
    assert.equal(AF.addCustomDay(s, '  ').name, 'Day 2');
  });
  t('A/B accessory weights are remembered for next time', () => {
    const s = AF.defaultState(); s.accessories.A.push(AF.itemFromExercise('db-curl'));
    const x = AF.newSession(s); x.lifts.forEach(e => e.sets = all5(e));
    x.accessories[1].weight = 25; AF.applySession(s, x);
    assert.equal(s.accessories.A[1].weight, 25);
    assert.equal(AF.newSession(Object.assign(s, { nextWorkout: 'A' })).accessories[1].weight, 25);
  });
  t('recovery: recommended durations and clamping', () => {
    assert.equal(AF.recoveryMinutes('sauna'), 15); assert.equal(AF.recoveryMinutes('hottub'), 12);
    assert.equal(AF.recoveryMinutes('sauna', 45), 20); assert.equal(AF.recoveryMinutes('hottub', 30), 15);
    assert.equal(AF.recoveryMinutes('sauna', 1), 5); assert.equal(AF.recoveryMinutes('sauna', 'x'), 15);
    assert.throws(() => AF.recoveryMinutes('cold-plunge'));
  });
  t('recovery countdown: start / pause / resume / reset / done', () => {
    const c = AF.cdNew(600); let now = 1000000;
    assert.equal(AF.cdRemaining(c, now), 600000); assert.ok(!AF.cdRunning(c));
    AF.cdStart(c, now); now += 120000; assert.equal(AF.cdRemaining(c, now), 480000);
    AF.cdPause(c, now); now += 999999; assert.equal(AF.cdRemaining(c, now), 480000); // paused: no time passes
    AF.cdStart(c, now); now += 480000; assert.ok(AF.cdDone(c, now)); assert.equal(AF.cdRemaining(c, now + 5000), 0);
    AF.cdPause(c, now); assert.equal(AF.cdElapsed(c, now), 600000);
    AF.cdReset(c); assert.equal(AF.cdRemaining(c, now), 600000); assert.ok(!AF.cdRunning(c));
    AF.cdSetDuration(c, 300, now); assert.equal(AF.cdRemaining(c, now), 300000);
    const done = AF.cdNew(60); done.elapsed = 60000; AF.cdStart(done, now); assert.ok(!AF.cdRunning(done)); // can't start a finished timer
  });
  t('recovery sessions are logged', () => {
    const s = AF.defaultState();
    const e = AF.logRecovery(s, { type: 'sauna', plannedSec: 900, actualSec: 900.4, afterSession: 'abc' });
    assert.equal(s.recoveryLog.length, 1); assert.equal(e.type, 'sauna'); assert.equal(e.actualSec, 900); assert.equal(e.afterSession, 'abc');
    const back = AF.normalize(JSON.parse(JSON.stringify(s))); assert.equal(back.recoveryLog.length, 1);
  });
  t('sync merge: union of logs, newer settings win, local workout kept, deletions honoured, never wipes', () => {
    const a = AF.defaultState(); const b = AF.defaultState();
    a.history.push({ id: 'x1', date: '2026-10-01T00:00:00Z', workout: 'A', lifts: [], accessories: [] });
    b.history.push({ id: 'x2', date: '2026-10-03T00:00:00Z', workout: 'B', lifts: [], accessories: [] });
    a.lifts.squat.weight = 150; a.lastModified = 100;
    b.lifts.squat.weight = 160; b.lastModified = 200;
    a.current = { id: 'live', date: '2026-10-04T00:00:00Z', workout: 'A', lifts: [], accessories: [] };
    let r = AF.mergeStates(JSON.parse(JSON.stringify(a)), b);
    assert.ok(r.changed); assert.deepEqual(r.state.history.map(h => h.id), ['x1', 'x2']);
    assert.equal(r.state.lifts.squat.weight, 160); assert.equal(r.state.current.id, 'live'); assert.equal(r.state.lastModified, 200);
    // remote is an empty fresh install -> nothing lost
    r = AF.mergeStates(JSON.parse(JSON.stringify(a)), AF.defaultState());
    assert.equal(r.state.history.length, 1); assert.equal(r.state.lifts.squat.weight, 150);
    // deletion tombstone propagates
    const c = JSON.parse(JSON.stringify(b)); c.history = []; c.deletedIds = ['x2']; c.lastModified = 300;
    r = AF.mergeStates(JSON.parse(JSON.stringify(b)), c);
    assert.equal(r.state.history.length, 0);
    // identical -> no change (no sync ping-pong)
    r = AF.mergeStates(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(b)));
    assert.ok(!r.changed);
    // remote missing local sessions -> remoteStale tells the app to push
    r = AF.mergeStates(JSON.parse(JSON.stringify(a)), AF.defaultState()); assert.ok(r.remoteStale);
    // two devices converge: merging the merged result back is a no-op both ways (no ping-pong)
    const m1 = AF.mergeStates(JSON.parse(JSON.stringify(a)), b).state;
    const m2 = AF.mergeStates(JSON.parse(JSON.stringify(b)), m1);
    assert.ok(!AF.mergeStates(JSON.parse(JSON.stringify(m1)), m2.state).remoteStale);
    // a running sauna timer is device-local and survives a merge
    const l = JSON.parse(JSON.stringify(b)); l.recoveryActive = { type: 'sauna', cd: AF.cdNew(900) };
    r = AF.mergeStates(l, c); assert.equal(r.state.recoveryActive.type, 'sauna');
    // garbage remote throws, caller keeps local
    assert.throws(() => AF.mergeStates(AF.defaultState(), { nope: 1 }));
  });
};

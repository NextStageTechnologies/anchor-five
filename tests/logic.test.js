// Run: node tests/logic.test.js
const assert = require('assert');
const AF = require('../logic.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
const sess = (s, setsFor) => { const x = AF.newSession(s); x.lifts.forEach(e => { e.sets = setsFor(e); }); return x; };
const all5 = e => new Array(e.setsTarget).fill(5);

t('default state: A first, lb, increments 5 / DL 10', () => {
  const s = AF.defaultState();
  assert.equal(s.nextWorkout, 'A'); assert.equal(s.units, 'lb');
  assert.equal(s.lifts.squat.inc, 5); assert.equal(s.lifts.deadlift.inc, 10);
});
t('workouts: A=SQ/BP/DB ROW 5x5, B=SQ/OHP/DL with DL 1x5', () => {
  const s = AF.defaultState();
  const a = AF.newSession(s); assert.deepEqual(a.lifts.map(e => e.lift), ['squat', 'bench', 'dbrow']);
  a.lifts.forEach(e => assert.equal(e.sets.length, 5));
  AF.applySession(s, sess(s, all5));
  const b = AF.newSession(s); assert.equal(b.workout, 'B');
  assert.deepEqual(b.lifts.map(e => e.lift), ['squat', 'ohp', 'deadlift']);
  assert.equal(b.lifts[2].sets.length, 1);
});
t('success adds weight; alternation A->B->A', () => {
  const s = AF.defaultState(); s.lifts.squat.weight = 135;
  AF.applySession(s, sess(s, all5)); assert.equal(s.lifts.squat.weight, 140); assert.equal(s.nextWorkout, 'B');
  AF.applySession(s, sess(s, all5)); assert.equal(s.lifts.squat.weight, 145); assert.equal(s.lifts.deadlift.weight, 105);
  assert.equal(s.nextWorkout, 'A');
});
t('failure keeps weight and counts misses; success resets count', () => {
  const s = AF.defaultState(); s.lifts.bench.weight = 150;
  const fail = e => e.lift === 'bench' ? [5, 5, 5, 4, 3] : all5(e);
  AF.applySession(s, sess(s, fail)); assert.equal(s.lifts.bench.weight, 150); assert.equal(s.lifts.bench.fails, 1);
  s.nextWorkout = 'A';
  AF.applySession(s, sess(s, all5)); assert.equal(s.lifts.bench.weight, 155); assert.equal(s.lifts.bench.fails, 0);
});
t('3 consecutive failed sessions -> 10% deload (rounded down to 5 lb)', () => {
  const s = AF.defaultState(); s.lifts.bench.weight = 155;
  const fail = e => e.lift === 'bench' ? [5, 5, 4, 4, 4] : all5(e);
  for (let i = 0; i < 3; i++) { s.nextWorkout = 'A'; const r = AF.applySession(s, sess(s, fail)); if (i < 2) assert.equal(r.changes[1].type, 'repeat'); else assert.equal(r.changes[1].type, 'deload'); }
  assert.equal(s.lifts.bench.weight, 135); // 155*0.9=139.5 -> 135
  assert.equal(s.lifts.bench.fails, 0);
});
t('deload in kg rounds to 2.5', () => {
  const s = AF.defaultState('kg'); s.lifts.squat.weight = 100; s.lifts.squat.fails = 2;
  AF.applySession(s, sess(s, e => e.lift === 'squat' ? [5, 5, 5, 5, 2] : all5(e)));
  assert.equal(s.lifts.squat.weight, 90);
  s.lifts.ohp.weight = 41; s.lifts.ohp.fails = 2; s.nextWorkout = 'B';
  AF.applySession(s, sess(s, e => e.lift === 'ohp' ? [3, 3, 3, 3, 3] : all5(e)));
  assert.equal(s.lifts.ohp.weight, 35); // 36.9 -> 35
});
t('deload never below the empty bar', () => {
  const s = AF.defaultState(); s.lifts.ohp.weight = 45; s.lifts.ohp.fails = 2; s.nextWorkout = 'B';
  AF.applySession(s, sess(s, e => e.lift === 'ohp' ? [0, 0, 0, 0, 0] : all5(e)));
  assert.equal(s.lifts.ohp.weight, 45);
});
t('progression uses the weight actually lifted (manual edit)', () => {
  const s = AF.defaultState(); s.lifts.bench.weight = 100;
  const x = AF.newSession(s); x.lifts.forEach(e => e.sets = all5(e)); x.lifts[1].weight = 90;
  AF.applySession(s, x); assert.equal(s.lifts.bench.weight, 95);
});
t('unlogged/partial sets are a fail', () => {
  assert.equal(AF.isSuccess({ reps: 5, setsTarget: 5, sets: [5, 5, 5, 5, null] }), false);
  assert.equal(AF.isSuccess({ reps: 5, setsTarget: 1, sets: [5] }), true);
});
t('plate calculator', () => {
  assert.deepEqual(AF.plateCalc(135, 45, [45, 35, 25, 10, 5, 2.5]).perSide, [45]);
  assert.deepEqual(AF.plateCalc(185, 45, [45, 35, 25, 10, 5, 2.5]).perSide, [45, 25]);
  assert.deepEqual(AF.plateCalc(232.5, 45, [45, 35, 25, 10, 5, 2.5]).perSide, [45, 45, 2.5]);
  const r = AF.plateCalc(232.5, 45, [45, 35, 25, 10, 5, 2.5]); assert.equal(r.achievable, false); assert.equal(r.leftover, 2.5);
  assert.deepEqual(AF.plateCalc(102.5, 20, [25, 20, 15, 10, 5, 2.5, 1.25]).perSide, [25, 15, 1.25]);
  assert.deepEqual(AF.plateCalc(45, 45, [45]).perSide, []);
});
t('warm-ups ascend, below work weight, empty bar for squat', () => {
  const s = AF.defaultState();
  const w = AF.warmups(225, s, 'squat');
  assert.equal(w[0].weight, 45); assert.ok(w.every(x => x.weight < 225));
  for (let i = 2; i < w.length; i++) assert.ok(w[i].weight > w[i - 1].weight);
  assert.deepEqual(AF.warmups(45, s, 'squat'), []);
  assert.ok(AF.warmups(275, s, 'deadlift')[0].weight > 45);
});
t('e1RM (Epley)', () => {
  assert.equal(AF.e1rm(200, 5), 233.3); assert.equal(AF.e1rm(200, 1), 200); assert.equal(AF.e1rm(200, 0), 0);
});
t('rest timer: 90s success, 180s first miss, 300s repeated miss', () => {
  const r = { success: 90, fail: 180, failAgain: 300 };
  assert.equal(AF.restFor(5, 5, 0, r), 90); assert.equal(AF.restFor(4, 5, 1, r), 180); assert.equal(AF.restFor(3, 5, 2, r), 300);
});
t('unit conversion lb->kg rounds to 2.5 and sets kg bar/increments', () => {
  const s = AF.defaultState(); s.lifts.squat.weight = 225;
  AF.convertUnits(s, 'kg'); assert.equal(s.units, 'kg'); assert.equal(s.bar, 20);
  assert.equal(s.lifts.squat.weight, 102.5); assert.equal(s.lifts.squat.inc, 2.5); assert.equal(s.lifts.deadlift.inc, 5);
});
t('backup round-trip via JSON + normalize; rejects junk', () => {
  const s = AF.defaultState(); AF.applySession(s, sess(s, all5));
  const back = AF.normalize(JSON.parse(JSON.stringify(s)));
  assert.equal(back.history.length, 1); assert.equal(back.lifts.squat.weight, 50);
  assert.throws(() => AF.normalize({ foo: 1 }));
});
require('./logic.v2.test.js')(t, AF, assert, sess, all5);
console.log(n + ' tests passed');

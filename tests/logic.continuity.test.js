// Continuity fixes: rest-timer merge, import tombstones, history units, normalize zeros.
module.exports = function (t, AF, assert, sess, all5) {

  t('normalize keeps a working weight or increment of 0 (does not treat 0 as missing)', () => {
    const s = AF.defaultState();
    s.lifts.bench.weight = 0;
    s.lifts.bench.inc = 0;
    const back = AF.normalize(JSON.parse(JSON.stringify(s)));
    assert.equal(back.lifts.bench.weight, 0);
    assert.equal(back.lifts.bench.inc, 0);
  });

  t('new sessions are tagged with the current unit', () => {
    const lb = AF.newSession(AF.defaultState('lb'));
    const kg = AF.newSession(AF.defaultState('kg'));
    assert.equal(lb.units, 'lb');
    assert.equal(kg.units, 'kg');
  });

  t('convertUnits stamps untagged history and leaves stored weights unchanged', () => {
    const s = AF.defaultState();
    s.lifts.squat.weight = 225;
    AF.applySession(s, sess(s, all5));
    const logged = s.history[0].lifts.find(e => e.lift === 'squat').weight;
    assert.equal(logged, 225);
    assert.equal(s.history[0].units, 'lb'); // tagged at session create
    AF.convertUnits(s, 'kg');
    assert.equal(s.units, 'kg');
    assert.equal(s.history[0].units, 'lb');
    assert.equal(s.history[0].lifts.find(e => e.lift === 'squat').weight, 225);
    assert.equal(s.lifts.squat.weight, 105); // 230 lb -> 104.3 kg, rounded to 2.5 = 105
    assert.equal(AF.convertWeight(225, 'lb', 'kg'), 102.5);
    assert.equal(AF.convertWeight(225, 'lb', 'lb'), 225);
    assert.equal(AF.convertWeight(102.5, 'kg', 'lb'), 225);
    // untagged older entry is stamped with the unit we are leaving
    const old = AF.defaultState();
    old.lifts.squat.weight = 185;
    const x = sess(old, all5);
    delete x.units;
    AF.applySession(old, x);
    assert.equal(AF.sessionUnits(old.history[0]), null);
    AF.convertUnits(old, 'kg');
    assert.equal(old.history[0].units, 'lb');
    assert.equal(old.history[0].lifts.find(e => e.lift === 'squat').weight, 185);
  });

  t('switching units and back does not rewrite stored history numbers', () => {
    const s = AF.defaultState();
    s.lifts.squat.weight = 225;
    AF.applySession(s, sess(s, all5));
    AF.convertUnits(s, 'kg');
    AF.convertUnits(s, 'lb');
    assert.equal(s.history[0].lifts.find(e => e.lift === 'squat').weight, 225);
    assert.equal(s.history[0].units, 'lb');
    assert.equal(s.units, 'lb');
  });

  t('in-progress session weights follow a unit switch; log entries do not', () => {
    const s = AF.defaultState();
    s.lifts.bench.weight = 100;
    s.current = AF.newSession(s);
    s.current.lifts[1].weight = 100; // bench
    AF.convertUnits(s, 'kg');
    assert.equal(s.current.units, 'kg');
    assert.equal(s.current.lifts[1].weight, 45); // 100 lb -> 45 kg
  });

  t('importTombstones marks replaced local sessions so merge cannot resurrect them', () => {
    const local = AF.defaultState();
    const a = AF.newSession(local);
    a.id = 'local-only';
    a.lifts.forEach(e => { e.sets = all5(e); });
    AF.applySession(local, a);
    local.deletedIds = ['already-gone'];

    const backup = AF.defaultState();
    const b = AF.newSession(backup);
    b.id = 'from-backup';
    b.lifts.forEach(e => { e.sets = all5(e); });
    AF.applySession(backup, b);

    const imported = AF.normalize(JSON.parse(JSON.stringify(backup)));
    imported.deletedIds = AF.importTombstones(local, imported);
    assert.ok(imported.deletedIds.indexOf('local-only') >= 0);
    assert.ok(imported.deletedIds.indexOf('already-gone') >= 0);
    assert.ok(imported.deletedIds.indexOf('from-backup') < 0);

    const merged = AF.mergeStates(imported, local);
    const ids = merged.state.history.map(h => h.id).sort();
    assert.deepEqual(ids, ['from-backup']);
  });

  t('import of a previously deleted session un-tombstones it', () => {
    const local = AF.defaultState();
    local.deletedIds = ['from-backup'];
    const backup = AF.defaultState();
    backup.history = [{ id: 'from-backup', date: '2026-01-01T00:00:00Z', units: 'lb', workout: 'A', lifts: [], accessories: [] }];
    const imported = AF.normalize(JSON.parse(JSON.stringify(backup)));
    imported.deletedIds = AF.importTombstones(local, imported);
    assert.ok(imported.deletedIds.indexOf('from-backup') < 0);
    const merged = AF.mergeStates(imported, local);
    assert.equal(merged.state.history.length, 1);
    assert.equal(merged.state.history[0].id, 'from-backup');
  });

  t('sync merge keeps a local rest timer (device-local, like the sauna timer)', () => {
    const local = AF.defaultState();
    local.restActive = { end: 1700000000000, total: 90, label: 'Good set — rest', fired: false };
    local.current = { id: 'live', date: '2026-11-27T00:00:00Z', units: 'lb', workout: 'A', lifts: [], accessories: [] };
    const remote = AF.defaultState();
    remote.lastModified = Date.now();
    remote.lifts.squat.weight = 135;
    const r = AF.mergeStates(local, remote);
    assert.equal(r.state.restActive.end, 1700000000000);
    assert.equal(r.state.current.id, 'live');
    assert.equal(r.state.lifts.squat.weight, 135); // newer remote settings
  });
};

/* Anchor Five — UI */
(function () {
  'use strict';
  var KEY = 'anchorfive.v1';
  var S = load();
  var tab = 'train';
  var openWarm = {};          // lift -> bool (UI only)
  var progLift = 'squat';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var view = $('#view');

  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) return AF.normalize(JSON.parse(raw)); } catch (e) { console.warn(e); }
    return AF.defaultState('lb');
  }
  function save() {
    S.lastModified = Date.now();
    var json = JSON.stringify(S);
    try { localStorage.setItem(KEY, json); } catch (e) { toast('Could not save: storage full?'); }
    // iOS app: mirror to Documents (Files app) + iCloud key-value sync (private to the user's Apple ID).
    native('afSync', { action: 'save', json: json, lastModified: S.lastModified });
  }
  var cloud = { available: null, note: '' };
  /* Called by the iOS app with data from iCloud / the Documents mirror. Merges, never wipes. */
  window.AFNative = {
    remote: function (json) {
      try {
        var r = AF.mergeStates(S, JSON.parse(json));
        if (r.changed) { S = r.state; save(); render(); toast('Synced from iCloud'); }
        else if (r.remoteStale) save(); // push what the other copy is missing
      } catch (e) { console.warn('sync merge skipped', e); }
    },
    status: function (st) { cloud = st || cloud; if (tab === 'settings') render(); }
  };
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(w) { return (Math.round(w * 100) / 100).toString(); }
  function u() { return S.units; }
  /* Display label for the unit: 'LBs' for pounds, 'kg' for kilograms (badge shows 'LBs' / 'KG'). */
  function UL() { return S.units === 'kg' ? 'kg' : 'LBs'; }
  function liftName(k) { return AF.LIFTS[k] ? AF.LIFTS[k].name : k; }
  function isDB(k) { return AF.isDumbbell(k); }
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.add('hidden'); }, ms || 2200);
  }

  /* ---------------- sheet (modal) ---------------- */
  function openSheet(html, bind) {
    $('#sheetCard').innerHTML = html; $('#sheet').classList.remove('hidden');
    if (bind) bind($('#sheetCard'));
  }
  function closeSheet() { $('#sheet').classList.add('hidden'); $('#sheetCard').innerHTML = ''; }
  $('#sheet').addEventListener('click', function (e) { if (e.target.id === 'sheet') closeSheet(); });

  /* ---------------- audio / haptics ---------------- */
  /* Inside the iOS app (WKWebView) the native side plays the chime: it ducks the user's music
     (AVAudioSession .duckOthers + .mixWithOthers), adds a haptic, then lets the music come back.
     In a browser we fall back to a Web Audio beep + navigator.vibrate. */
  var MH = window.webkit && window.webkit.messageHandlers;
  var NATIVE = !!(MH && MH.restDone);
  function native(name, msg) {
    try { if (MH && MH[name]) { MH[name].postMessage(msg); return true; } } catch (e) {}
    return false;
  }
  function setAudioSessionType(type) { try { if (!NATIVE && navigator.audioSession) navigator.audioSession.type = type; } catch (e) {} }
  // Web: declare our sound as mixable so a beep never stops Spotify/Apple Music (Safari 16.4+).
  setAudioSessionType('ambient');
  /** "Time's up" signal. kind: 'rest' | 'recovery' */
  function alertDone(kind) {
    if (NATIVE && native('restDone', { kind: kind })) return;
    setAudioSessionType('transient');
    beep(3);
    setTimeout(function () { setAudioSessionType('ambient'); }, 1500);
  }
  /** Backup alert for when the app is backgrounded/locked: native local notification (iOS app only). */
  function scheduleNotice(id, sec, title, body) { if (NATIVE) native('afNotify', { action: 'schedule', id: id, seconds: Math.max(1, Math.round(sec)), title: title, body: body }); }
  function cancelNotice(id) { if (NATIVE) native('afNotify', { action: 'cancel', id: id }); }

  var actx = null;
  function unlockAudio() {
    if (actx || NATIVE) return;
    try { var C = window.AudioContext || window.webkitAudioContext; if (C) actx = new C(); } catch (e) {}
  }
  function beep(times) {
    if (navigator.vibrate) { try { navigator.vibrate([300, 120, 300]); } catch (e) {} }
    if (!actx) return;
    try {
      if (actx.state === 'suspended') actx.resume();
      for (var i = 0; i < (times || 3); i++) {
        var o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.28;
        o.type = 'sine'; o.frequency.value = i === (times || 3) - 1 ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
        o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + 0.24);
      }
    } catch (e) {}
  }
  document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });
  document.addEventListener('click', unlockAudio, { once: true });

  /* ---------------- wake lock ---------------- */
  var wakeLock = null;
  function keepAwake(on) {
    if (!('wakeLock' in navigator)) return;
    if (on && !wakeLock) navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); }).catch(function () {});
    if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (S.current || S.recoveryActive)) keepAwake(true); tickTimer(); tickRecovery(); });

  /* ---------------- rest timer ---------------- */
  var T = { end: 0, total: 0, label: '', fired: false, iv: null };
  function startTimer(sec, label) {
    T.total = sec; T.end = Date.now() + sec * 1000; T.label = label; T.fired = false;
    $('#timer').classList.remove('hidden', 'over'); document.body.classList.add('timing');
    if (!T.iv) T.iv = setInterval(tickTimer, 250);
    scheduleRest();
    tickTimer();
  }
  function stopTimer() { if (T.end && !T.fired) cancelNotice('rest'); clearInterval(T.iv); T.iv = null; T.end = 0; $('#timer').classList.add('hidden'); document.body.classList.remove('timing'); }
  function tickTimer() {
    if (!T.end) return;
    var left = Math.round((T.end - Date.now()) / 1000);
    var el = $('#timer');
    if (left <= 0) {
      if (!T.fired) {
        T.fired = true;
        // On time (screen on, app open): chime. Long overdue (we were in the background): the
        // local notification already alerted, so don't play a late chime.
        if (-left <= 5) alertDone('rest'); else cancelNotice('rest');
      }
      el.classList.add('over');
      $('#timerLabel').textContent = 'Rest over — next set';
      $('#timerTime').textContent = '+' + mmss(-left);
      $('#timerFill').style.width = '100%';
      if (-left > 600) stopTimer();
    } else {
      el.classList.remove('over');
      $('#timerLabel').textContent = T.label;
      $('#timerTime').textContent = mmss(left);
      $('#timerFill').style.width = (100 * left / T.total) + '%';
    }
  }
  function mmss(s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function scheduleRest() { var left = (T.end - Date.now()) / 1000; if (left > 1) scheduleNotice('rest', left, 'Rest is over', 'Time for your next set.'); else cancelNotice('rest'); }
  $('#tPlus').onclick = function () { if (T.end) { T.end += 15000; T.total += 15; T.fired = false; scheduleRest(); tickTimer(); } };
  $('#tMinus').onclick = function () { if (T.end) { T.end -= 15000; scheduleRest(); tickTimer(); } };
  $('#tSkip').onclick = stopTimer;

  /* ---------------- plates graphic ---------------- */
  var PLATE_COL = { 45: '#e04b4b', 35: '#f2c14e', 25: '#3fcf8e', 10: '#e9eef7', 5: '#5aa0ff', 2.5: '#c084fc', 1.25: '#9aa5b8',
                    20: '#5aa0ff', 15: '#f2c14e' };
  function platesHTML(total) {
    var r = AF.plateCalc(total, S.bar, S.plates);
    if (total < S.bar) return '<div class="note">Below the bar weight (' + fmt(S.bar) + ' ' + UL() + ').</div>';
    var maxP = Math.max.apply(null, S.plates);
    var g = '<div class="plates"><div class="barstub"></div><div class="sleeve"></div>' + r.perSide.map(function (p) {
      var h = 26 + 54 * (p / maxP), w = p >= 10 ? 16 : 11;
      return '<div class="plate" style="height:' + h + 'px;width:' + w + 'px;background:' + (PLATE_COL[p] || '#9aa5b8') + '">' + (p >= 10 ? fmt(p) : '') + '</div>';
    }).join('') + '</div>';
    var txt = r.perSide.length ? 'Per side: <b>' + r.perSide.map(fmt).join(' + ') + '</b>' : 'Empty bar';
    if (!r.achievable) txt += ' <span class="bad">(' + fmt(r.leftover) + ' ' + UL() + ' short — no small enough plates)</span>';
    return g + '<div class="note">' + txt + ' · bar ' + fmt(S.bar) + ' ' + UL() + '</div>';
  }
  function platesShort(total) {
    var r = AF.plateCalc(total, S.bar, S.plates);
    return r.perSide.length ? r.perSide.map(fmt).join('·') : 'bar';
  }

  /* ---------------- TRAIN ---------------- */
  function renderTrain() {
    if (!S.current) return renderPreview();
    var c = S.current;
    var html = '<div class="hero"><div><div class="w">In progress</div><div class="big">' + sessionTitle(c) + '</div></div>' +
      '<div class="pill" id="elapsed">' + elapsed(c) + '</div></div>';
    c.lifts.forEach(function (e, li) {
      var L = S.lifts[e.lift];
      var failNote = L.fails ? ' · <span class="bad">' + L.fails + ' miss' + (L.fails > 1 ? 'es' : '') + ' in a row</span>' : '';
      html += '<div class="card"><div class="ex-head"><div><div class="ex-name">' + liftName(e.lift) + '</div>' +
        '<div class="ex-sub">' + e.setsTarget + ' × ' + e.reps + (isDB(e.lift) ? ' · per dumbbell' : '') + failNote + '</div></div>' +
        '<button class="wbtn" data-w="' + li + '">' + fmt(e.weight) + ' <small>' + UL() + (isDB(e.lift) ? ' ea' : '') + '</small></button></div>' +
        '<div class="sets">' + e.sets.map(function (r, si) {
          var cls = r === null ? '' : (r >= e.reps ? 'done' : 'miss');
          return '<button class="set ' + cls + '" data-l="' + li + '" data-s="' + si + '" aria-label="Set ' + (si + 1) + '">' + (r === null ? '' : r) + '</button>';
        }).join('') + '</div>' +
        '<div class="row-actions">' + (isDB(e.lift) ? '<span class="chip dbtag">Dumbbells · ' + fmt(e.weight) + ' ' + UL() + ' each</span>' : '<button class="chip" data-plates="' + e.weight + '">Plates: ' + platesShort(e.weight) + '</button>') +
        (S.showWarmups ? '<button class="chip ' + (openWarm[e.lift] ? 'on' : '') + '" data-warm="' + e.lift + '">Warm-up</button>' : '') +
        '<button class="chip" data-e1="' + li + '">e1RM ' + (AF.entryE1rm(e) ? fmt(AF.entryE1rm(e)) : '—') + '</button></div>';
      if (S.showWarmups && openWarm[e.lift]) {
        var ws = AF.warmups(e.weight, S, e.lift);
        c.warmDone = c.warmDone || {};
        var wd = c.warmDone[e.lift] || [];
        html += '<div class="warm">' + (ws.length ? ws.map(function (w, wi) {
          return '<div class="warm-row ' + (wd[wi] ? 'ticked' : '') + '" data-wl="' + e.lift + '" data-wi="' + wi + '"><span>' + fmt(w.weight) + ' ' + UL() + (isDB(e.lift) ? ' each' : '') + ' × ' + w.reps + '</span><span class="plates-inline">' + (isDB(e.lift) ? 'dumbbells' : platesShort(w.weight)) + '</span></div>';
        }).join('') : '<div class="note">' + (isDB(e.lift) ? 'No warm-up needed at this weight.' : 'No warm-up needed at the empty bar.') + '</div>') + '</div>';
      }
      html += '</div>';
    });
    if (c.accessories && c.accessories.length) {
      html += '<h2>' + (c.workout === 'C' ? 'Exercises' : 'Accessories & extras') + '</h2>';
      c.accessories.forEach(function (a, ai) {
        html += '<div class="card"><div class="ex-head"><div><div class="ex-name">' + esc(a.name) + '</div><div class="ex-sub">' + a.sets.length + ' × ' + a.reps +
          (a.equip ? ' · ' + (a.equip === 'cable' ? 'cable' : 'free weight') : '') + (a.perHand ? ' · per dumbbell' : '') + '</div></div>' +
          '<div class="acc-tools"><button class="wbtn sm" data-aw="' + ai + '">' + (a.weight ? fmt(a.weight) + ' <small>' + UL() + (a.perHand ? ' ea' : '') + '</small>' : '<small>body&shy;weight</small>') + '</button>' +
          '<button class="x" data-arm="' + ai + '" aria-label="Remove from today">✕</button></div></div><div class="sets">' +
          a.sets.map(function (r, si) {
            var cls = r === null ? '' : (r >= a.reps ? 'done' : 'miss');
            return '<button class="set acc ' + cls + '" data-a="' + ai + '" data-s="' + si + '">' + (r === null ? '' : r) + '</button>';
          }).join('') + '</div></div>';
      });
    }
    html += '<button class="btn ghost sm" id="addEx">+ Add exercise from library</button>';
    html += '<button class="btn" id="finish">Finish workout</button><button class="btn ghost sm" id="discard">Discard workout</button>';
    view.innerHTML = html;
    $('#addEx').onclick = function () { openLibrary({ kind: 'session' }); };
    view.querySelectorAll('[data-aw]').forEach(function (b) { b.onclick = function () { editAccWeight(c.accessories[+b.dataset.aw]); }; });
    view.querySelectorAll('[data-arm]').forEach(function (b) {
      b.onclick = function () { var a = c.accessories[+b.dataset.arm]; if (confirm('Remove ' + a.name + ' from today?')) { c.accessories.splice(+b.dataset.arm, 1); save(); render(); } };
    });

    view.querySelectorAll('.set[data-l]').forEach(function (b) { b.onclick = function () { tapSet(+b.dataset.l, +b.dataset.s); }; });
    view.querySelectorAll('.set[data-a]').forEach(function (b) { b.onclick = function () { tapAcc(+b.dataset.a, +b.dataset.s); }; });
    view.querySelectorAll('[data-w]').forEach(function (b) { b.onclick = function () { editWeight(c.lifts[+b.dataset.w], true); }; });
    view.querySelectorAll('[data-plates]').forEach(function (b) { b.onclick = function () { showPlates(+b.dataset.plates); }; });
    view.querySelectorAll('[data-warm]').forEach(function (b) { b.onclick = function () { openWarm[b.dataset.warm] = !openWarm[b.dataset.warm]; render(); }; });
    view.querySelectorAll('[data-e1]').forEach(function (b) { b.onclick = function () { toast('Estimated 1-rep max (Epley) from your best set so far'); }; });
    view.querySelectorAll('[data-wl]').forEach(function (r) {
      r.onclick = function () {
        var wd = c.warmDone[r.dataset.wl] = c.warmDone[r.dataset.wl] || [];
        wd[+r.dataset.wi] = !wd[+r.dataset.wi]; save(); render();
      };
    });
    $('#finish').onclick = finishWorkout;
    $('#discard').onclick = function () {
      if (confirm('Discard this workout? Nothing will be saved.')) { S.current = null; save(); stopTimer(); keepAwake(false); render(); }
    };
  }
  function sessionTitle(c) { return c.workout === 'C' ? '<span>' + esc(c.dayName || 'Custom') + '</span>' : 'Workout <span>' + c.workout + '</span>'; }
  function sessionName(c) { return c.workout === 'C' ? (c.dayName || 'Custom day') : 'Workout ' + c.workout; }
  function editAccWeight(a) {
    var inc = AF.UNIT_DEFAULTS[u()].round / (a.perHand || a.equip === 'cable' ? 1 : 2);
    if (a.perHand) inc = AF.UNIT_DEFAULTS[u()].dbInc;
    openSheet('<h3>' + esc(a.name) + '</h3><div class="note">' + (a.perHand ? 'Weight per dumbbell. ' : a.equip === 'cable' ? 'Weight on the stack. ' : '') + '0 = bodyweight. Remembered for next time.</div>' +
      '<div class="stepper"><button id="wm">−</button><input id="wv" type="number" inputmode="decimal" step="any" value="' + fmt(a.weight) + '"><button id="wp">+</button></div>' +
      '<button class="btn" id="wok">Save</button><button class="btn ghost sm" id="wc">Cancel</button>', function (r) {
      var inp = $('#wv', r);
      $('#wm', r).onclick = function () { inp.value = fmt(Math.max(0, (+inp.value || 0) - inc)); };
      $('#wp', r).onclick = function () { inp.value = fmt((+inp.value || 0) + inc); };
      $('#wc', r).onclick = closeSheet;
      $('#wok', r).onclick = function () { var v = +inp.value; if (!(v >= 0)) return; a.weight = v; save(); closeSheet(); render(); };
    });
  }
  function elapsed(c) { var m = Math.floor((Date.now() - new Date(c.date).getTime()) / 60000); return m < 1 ? 'just started' : m + ' min'; }
  setInterval(function () { var el = $('#elapsed'); if (el && S.current) el.textContent = elapsed(S.current); }, 30000);

  function cycle(r, target) { if (r === null) return target; if (r === 0) return null; return r - 1; }

  function tapSet(li, si) {
    var e = S.current.lifts[li];
    var r = cycle(e.sets[si], e.reps);
    e.sets[si] = r; save(); render();
    if (r === null) { stopTimer(); return; }
    var failed = e.sets.filter(function (x) { return x !== null && x < e.reps; }).length;
    var last = li === S.current.lifts.length - 1 && e.sets.every(function (x) { return x !== null; });
    if (last && !(S.current.accessories || []).length) { stopTimer(); return; }
    var sec = AF.restFor(r, e.reps, failed, S.rest);
    startTimer(sec, r >= e.reps ? 'Good set — rest' : (failed >= 2 ? 'Missed again — long rest' : 'Missed reps — take it easy'));
    revealNext();
  }
  /* keep the next empty set visible above the floating timer */
  function revealNext() {
    var next = view.querySelector('.set:empty');
    if (!next) return;
    var rc = next.getBoundingClientRect();
    if (rc.bottom > window.innerHeight - 200 || rc.top < 70) next.scrollIntoView({ block: 'center' });
  }
  function tapAcc(ai, si) {
    var a = S.current.accessories[ai];
    var r = cycle(a.sets[si], a.reps);
    a.sets[si] = r; save(); render();
    if (r === null) stopTimer(); else { startTimer(Math.min(S.rest.success, 90), 'Accessory rest'); revealNext(); }
  }

  function editWeight(entryOrLift, isSession) {
    var key = isSession ? entryOrLift.lift : entryOrLift;
    var cur = isSession ? entryOrLift.weight : S.lifts[key].weight;
    var inc = S.lifts[key].inc;
    var db = isDB(key);
    openSheet('<h3>' + liftName(key) + '</h3><div class="note">' + (isSession ? 'Weight for today only. Next session builds from what you actually lift.' : 'Working weight for the next session.') + (db ? ' <b>Per dumbbell</b> (' + UL() + ' in each hand).' : '') + '</div>' +
      '<div class="stepper"><button id="wm">−</button><input id="wv" type="number" inputmode="decimal" step="any" value="' + fmt(cur) + '"><button id="wp">+</button></div>' +
      '<div id="wpl"></div><button class="btn" id="wok">Save</button><button class="btn ghost sm" id="wc">Cancel</button>', function (r) {
      var inp = $('#wv', r);
      var upd = function () { $('#wpl', r).innerHTML = db ? '' : platesHTML(+inp.value || 0); };
      $('#wm', r).onclick = function () { inp.value = fmt(Math.max(0, (+inp.value || 0) - inc)); upd(); };
      $('#wp', r).onclick = function () { inp.value = fmt((+inp.value || 0) + inc); upd(); };
      inp.oninput = upd; upd();
      $('#wc', r).onclick = closeSheet;
      $('#wok', r).onclick = function () {
        var v = +inp.value; if (!(v >= 0)) return;
        if (isSession) entryOrLift.weight = v; else S.lifts[key].weight = v;
        save(); closeSheet(); render();
      };
    });
  }
  function showPlates(w) {
    openSheet('<h3>' + fmt(w) + ' ' + UL() + '</h3>' + platesHTML(w) + '<button class="btn ghost" id="pc">Close</button>', function (r) { $('#pc', r).onclick = closeSheet; });
  }

  function renderPreview() {
    var w = S.nextWorkout;
    var html = '<div class="hero"><div><div class="w">Up next</div><div class="big">Workout <span>' + w + '</span></div></div>' +
      '<div class="seg" style="width:110px"><button data-nw="A" class="' + (w === 'A' ? 'on' : '') + '">A</button><button data-nw="B" class="' + (w === 'B' ? 'on' : '') + '">B</button></div></div>';
    AF.WORKOUTS[w].forEach(function (k) {
      var L = S.lifts[k], d = AF.LIFTS[k], db = isDB(k);
      html += '<div class="card"><div class="ex-head"><div><div class="ex-name">' + d.name + '</div><div class="ex-sub">' + d.sets + ' × ' + d.reps +
        (L.fails ? ' · <span class="bad">' + L.fails + '/' + AF.FAILS_BEFORE_DELOAD + ' misses before deload</span>' : ' · +' + fmt(L.inc) + ' ' + UL() + ' on success') +
        '</div></div><button class="wbtn" data-pw="' + k + '">' + fmt(L.weight) + ' <small>' + UL() + (db ? ' ea' : '') + '</small></button></div>' +
        '<div class="note" style="margin:8px 0 0">' + (db ? 'Per dumbbell — ' + fmt(L.weight) + ' ' + UL() + ' in each hand' : 'Plates per side: ' + platesShort(L.weight)) + '</div></div>';
    });
    var acc = S.accessories[w] || [];
    if (acc.length) html += '<div class="note">+ accessories: ' + acc.map(function (a) { return esc(a.name) + ' ' + a.sets + '×' + a.reps; }).join(', ') + '</div>';
    html += '<button class="btn" id="start">Start Workout ' + w + '</button>';
    html += '<h2>More workouts</h2>';
    (S.customDays || []).forEach(function (d) {
      html += '<div class="card day"><div class="ex-head"><div><div class="ex-name">' + esc(d.name) + '</div><div class="ex-sub">' +
        (d.items.length ? d.items.map(function (x) { return esc(x.name); }).join(' · ') : 'No exercises yet') + '</div></div>' +
        '<button class="chip" data-ed="' + d.id + '">Edit</button></div>' +
        (d.items.length ? '<button class="btn sm" data-sd="' + d.id + '">Start ' + esc(d.name) + '</button>' : '<button class="btn ghost sm" data-ad="' + d.id + '">+ Add exercises</button>') + '</div>';
    });
    html += '<div class="grid2"><button class="btn ghost sm" id="lib">Exercise library</button><button class="btn ghost sm" id="newDay">+ Build a day</button></div>' +
      '<button class="btn ghost sm recov-btn" id="recov">Sauna / hot tub timer</button>';
    if (!S.history.length) html += '<div class="note" style="margin-top:14px">First time? Set your starting weights in <b>Setup</b>. Start light — the program adds weight every session you complete all your reps.</div>';
    else {
      var last = S.history[S.history.length - 1];
      var days = Math.floor((Date.now() - new Date(last.date).getTime()) / 86400000);
      html += '<div class="note" style="margin-top:14px">Last session: ' + esc(sessionName(last)) + ', ' + (days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago') + ' · ' + S.history.length + ' total</div>';
    }
    view.innerHTML = html;
    view.querySelectorAll('[data-nw]').forEach(function (b) { b.onclick = function () { S.nextWorkout = b.dataset.nw; save(); render(); }; });
    view.querySelectorAll('[data-pw]').forEach(function (b) { b.onclick = function () { editWeight(b.dataset.pw, false); }; });
    $('#start').onclick = function () { unlockAudio(); S.current = AF.newSession(S); openWarm = {}; save(); keepAwake(true); render(); window.scrollTo(0, 0); };
    view.querySelectorAll('[data-sd]').forEach(function (b) {
      b.onclick = function () { unlockAudio(); S.current = AF.newCustomSession(S, b.dataset.sd); openWarm = {}; save(); keepAwake(true); render(); window.scrollTo(0, 0); };
    });
    view.querySelectorAll('[data-ed]').forEach(function (b) { b.onclick = function () { editDay(b.dataset.ed); }; });
    view.querySelectorAll('[data-ad]').forEach(function (b) { b.onclick = function () { openLibrary({ kind: 'day', id: b.dataset.ad }); }; });
    $('#lib').onclick = function () { openLibrary(null); };
    $('#newDay').onclick = function () { var d = newDay(); if (d) openLibrary({ kind: 'day', id: d.id }); };
    $('#recov').onclick = function () { openRecovery(null); };
  }
  function newDay() {
    var name = prompt('Name this workout day (e.g. "Cable Day", "Arms")', 'Day ' + ((S.customDays || []).length + 1));
    if (name === null) return null;
    var d = AF.addCustomDay(S, name); save(); toast('Created ' + d.name); return d;
  }
  function findDay(id) { return (S.customDays || []).filter(function (d) { return d.id === id; })[0]; }
  function editDay(id) {
    var d = findDay(id); if (!d) return;
    openSheet('<h3>Edit day</h3><div class="field"><label>Name</label><input id="dn" value="' + esc(d.name) + '"></div>' +
      '<div style="margin-top:10px">' + (d.items.length ? d.items.map(function (x, i) {
        return '<div class="lib-row"><div><b>' + esc(x.name) + '</b><div class="ex-sub">' + x.sets + ' × ' + x.reps + (x.weight ? ' @ ' + fmt(x.weight) + ' ' + UL() + (x.perHand ? ' ea' : '') : '') + '</div></div>' +
          '<button class="x" data-dx="' + i + '" aria-label="Remove">✕</button></div>';
      }).join('') : '<div class="note">No exercises yet.</div>') + '</div>' +
      '<button class="btn sm" id="dadd">+ Add exercises</button><button class="btn ghost sm" id="dok">Done</button><button class="btn danger sm" id="ddel">Delete this day</button>', function (r) {
      $('#dn', r).onchange = function () { d.name = $('#dn', r).value.trim() || d.name; save(); };
      r.querySelectorAll('[data-dx]').forEach(function (b) { b.onclick = function () { d.items.splice(+b.dataset.dx, 1); save(); editDay(id); render(); }; });
      $('#dadd', r).onclick = function () { d.name = $('#dn', r).value.trim() || d.name; closeSheet(); openLibrary({ kind: 'day', id: id }); };
      $('#dok', r).onclick = function () { d.name = $('#dn', r).value.trim() || d.name; save(); closeSheet(); render(); };
      $('#ddel', r).onclick = function () {
        if (!confirm('Delete "' + d.name + '"? Past sessions stay in your log.')) return;
        S.customDays = S.customDays.filter(function (x) { return x.id !== id; }); S.deletedIds.push(id); save(); closeSheet(); render();
      };
    });
  }

  function finishWorkout() {
    var c = S.current;
    var open = c.lifts.some(function (e) { return e.sets.some(function (x) { return x === null; }); });
    if (open && !confirm('Some sets are not logged. They will count as missed (0 reps). Finish anyway?')) return;
    c.lifts.forEach(function (e) { e.sets = e.sets.map(function (x) { return x === null ? 0 : x; }); });
    c.finished = new Date().toISOString();
    S.current = null;
    var res = AF.applySession(S, c);
    save(); stopTimer(); keepAwake(false); tab = 'train'; render();
    var rows = res.changes.map(function (ch) {
      var txt = ch.type === 'up' ? '<span class="ok">+' + fmt(ch.to - ch.from) + ' → ' + fmt(ch.to) + '</span>'
        : ch.type === 'deload' ? '<span class="bad">Deload → ' + fmt(ch.to) + '</span>'
        : '<span class="muted">Repeat ' + fmt(ch.to) + ' (' + ch.fails + '/' + AF.FAILS_BEFORE_DELOAD + ')</span>';
      return '<div class="change"><span>' + liftName(ch.lift) + '</span>' + txt + '</div>';
    }).join('');
    var rt = (S.recovery && S.recovery.type) || 'sauna';
    openSheet('<h3>Logged. Fair winds.</h3>' + (rows ? '<div class="note">Next time (Workout ' + S.nextWorkout + '):</div>' + rows : '<div class="note">' + esc(sessionName(c)) + ' saved to your log. Up next in the 5×5: Workout ' + S.nextWorkout + '.</div>') +
      '<div class="recov-offer"><div class="ro-title">Recommended recovery</div>' +
      '<div class="note" style="margin:2px 0 10px">Warm up and wind down with a short heat session.</div>' +
      '<div class="seg"><button data-rt="sauna" class="' + (rt === 'sauna' ? 'on' : '') + '">Sauna · ' + AF.RECOVERY.sauna.rec + ' min</button>' +
      '<button data-rt="hottub" class="' + (rt === 'hottub' ? 'on' : '') + '">Hot Tub · ' + AF.RECOVERY.hottub.rec + ' min</button></div>' +
      '<button class="btn" id="rgo">Start recovery timer</button><button class="btn ghost sm" id="dn">Skip</button></div>', function (r) {
      r.querySelectorAll('[data-rt]').forEach(function (b) {
        b.onclick = function () { rt = b.dataset.rt; r.querySelectorAll('[data-rt]').forEach(function (x) { x.classList.toggle('on', x === b); }); };
      });
      $('#rgo', r).onclick = function () { closeSheet(); S.recovery.type = rt; openRecovery(c.id); };
      $('#dn', r).onclick = closeSheet;
    });
  }

  /* ---------------- HISTORY ---------------- */
  function renderHistory() {
    var recs = S.recoveryLog || [];
    if (!S.history.length && !recs.length) { view.innerHTML = '<div class="empty">No sessions yet.<br>Finish a workout and it shows up here.</div>'; return; }
    var html = '<h2>' + S.history.length + ' sessions' + (recs.length ? ' · ' + recs.length + ' recovery' : '') + '</h2>';
    var items = S.history.map(function (h) { return { t: new Date(h.date).getTime(), h: h }; })
      .concat(recs.map(function (r) { return { t: new Date(r.date).getTime() + 1, r: r }; }))
      .sort(function (a, b) { return b.t - a.t; });
    items.forEach(function (it) {
      if (it.r) {
        var r = it.r, rd = new Date(r.date), mins = Math.round(r.actualSec / 60);
        html += '<div class="card recov-log"><div class="hist-item"><div><b>' + AF.RECOVERY[r.type].name + ' · ' + mins + ' min</b><div class="d">' +
          rd.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) +
          (r.actualSec < r.plannedSec - 30 ? ' · planned ' + Math.round(r.plannedSec / 60) + ' min' : '') + '</div></div>' +
          '<button class="chip" data-rdel="' + r.id + '">Delete</button></div></div>';
        return;
      }
      var h = it.h, d = new Date(h.date);
      html += '<div class="card"><div class="hist-item"><div><b>' + esc(sessionName(h)) + '</b><div class="d">' +
        d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) + '</div></div>' +
        '<button class="chip" data-del="' + h.id + '">Delete</button></div><div class="hist-lifts">' +
        h.lifts.map(function (e) {
          var ok = AF.isSuccess(e);
          return '<div><span>' + liftName(e.lift) + ' ' + fmt(e.weight) + (isDB(e.lift) ? ' ea' : '') + '</span><span class="' + (ok ? 'ok' : 'bad') + '">' + e.sets.join('/') + '</span></div>';
        }).join('') +
        (h.accessories || []).map(function (a) {
          return '<div class="muted"><span>' + esc(a.name) + (a.weight ? ' ' + fmt(a.weight) : '') + '</span><span>' + a.sets.map(function (x) { return x === null ? '–' : x; }).join('/') + '</span></div>';
        }).join('') + '</div></div>';
    });
    html += '<div class="note">Deleting a session removes it from your log and charts; it does not change your current working weights (edit those in Setup).</div>';
    view.innerHTML = html;
    view.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Delete this session from the log?')) return;
        S.history = S.history.filter(function (h) { return h.id !== b.dataset.del; }); S.deletedIds.push(b.dataset.del); save(); render();
      };
    });
    view.querySelectorAll('[data-rdel]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Delete this recovery session?')) return;
        S.recoveryLog = S.recoveryLog.filter(function (r) { return r.id !== b.dataset.rdel; }); S.deletedIds.push(b.dataset.rdel); save(); render();
      };
    });
  }

  /* ---------------- PROGRESS ---------------- */
  function renderProgress() {
    var keys = AF.PROGRAM_LIFTS.slice();
    // Old Barbell Row history (pre-v2) stays viewable if there is any.
    if (S.history.some(function (h) { return h.lifts.some(function (e) { return e.lift === 'row'; }); })) keys.splice(3, 0, 'row');
    if (keys.indexOf(progLift) < 0) progLift = 'squat';
    var html = '<div class="seg" style="flex-wrap:wrap">' + keys.map(function (k) {
      return '<button data-pl="' + k + '" class="' + (k === progLift ? 'on' : '') + '">' + ({ squat: 'SQ', bench: 'BP', dbrow: 'DB ROW', row: 'BB ROW', ohp: 'OHP', deadlift: 'DL' })[k] + '</button>';
    }).join('') + '</div>';
    var pts = [];
    S.history.forEach(function (h) {
      h.lifts.forEach(function (e) { if (e.lift === progLift) pts.push({ d: new Date(h.date), w: e.weight, e1: AF.entryE1rm(e), ok: AF.isSuccess(e) }); });
    });
    pts.sort(function (a, b) { return a.d - b.d; });
    html += '<div class="card"><div class="ex-name">' + liftName(progLift) + '</div>';
    if (pts.length < 1) html += '<div class="empty">No data yet for this lift.</div>';
    else html += chartSVG(pts) + '<div class="note"><span style="color:var(--brass2)">━</span> working weight &nbsp; <span style="color:#5aa0ff">┅</span> est. 1RM &nbsp; <span class="bad">●</span> missed</div>';
    var best = pts.reduce(function (m, p) { return Math.max(m, p.e1); }, 0);
    var gain = pts.length ? pts[pts.length - 1].w - pts[0].w : 0;
    html += '<div class="stats"><div class="stat"><b>' + (S.lifts[progLift] ? fmt(S.lifts[progLift].weight) : '—') + '</b><span>Next <i class="u">' + UL() + (isDB(progLift) ? ' ea' : '') + '</i></span></div>' +
      '<div class="stat"><b>' + (best ? fmt(best) : '—') + '</b><span>Best e1RM</span></div>' +
      '<div class="stat"><b>' + (gain >= 0 ? '+' : '') + fmt(gain) + '</b><span>Gained</span></div></div></div>';
    // totals
    var vol = 0; S.history.forEach(function (h) { h.lifts.forEach(function (e) { e.sets.forEach(function (r) { vol += (r || 0) * e.weight * (isDB(e.lift) ? 2 : 1); }); }); });
    html += '<div class="card"><div class="stats"><div class="stat"><b>' + S.history.length + '</b><span>Sessions</span></div>' +
      '<div class="stat"><b>' + (vol >= 10000 ? fmt(Math.round(vol / 100) / 10) + 'k' : fmt(vol)) + '</b><span>Total <i class="u">' + UL() + '</i></span></div>' +
      '<div class="stat"><b>' + streakWeeks() + '</b><span>Week streak</span></div></div></div>';
    view.innerHTML = html;
    view.querySelectorAll('[data-pl]').forEach(function (b) { b.onclick = function () { progLift = b.dataset.pl; render(); }; });
  }
  function streakWeeks() {
    if (!S.history.length) return 0;
    var wk = function (d) { var t = new Date(d); t.setHours(0, 0, 0, 0); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.getTime(); };
    var set = {}; S.history.forEach(function (h) { set[wk(h.date)] = 1; });
    var cur = wk(new Date()), n = 0, W = 7 * 86400000;
    if (!set[cur]) cur -= W; // this week not trained yet doesn't break streak
    while (set[cur]) { n++; cur -= W; }
    return n;
  }
  function chartSVG(pts) {
    var W = 340, H = 200, pl = 38, pr = 10, pt = 12, pb = 26;
    var vals = []; pts.forEach(function (p) { vals.push(p.w); if (p.e1) vals.push(p.e1); });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mx === mn) { mx += 10; mn = Math.max(0, mn - 10); }
    var pad = (mx - mn) * 0.08; mn -= pad; mx += pad;
    var X = function (i) { return pts.length === 1 ? (pl + (W - pl - pr) / 2) : pl + i * (W - pl - pr) / (pts.length - 1); };
    var Y = function (v) { return pt + (H - pt - pb) * (1 - (v - mn) / (mx - mn)); };
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Progress chart">';
    for (var g = 0; g <= 4; g++) {
      var v = mn + (mx - mn) * g / 4, y = Y(v);
      s += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y + '" y2="' + y + '" stroke="#263a5e" stroke-width="1"/>' +
        '<text x="' + (pl - 5) + '" y="' + (y + 4) + '" fill="#8a9bb8" font-size="10" text-anchor="end">' + Math.round(v) + '</text>';
    }
    var line = function (key) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(p[key] || p.w).toFixed(1); }).join(' '); };
    s += '<path d="' + line('e1') + '" fill="none" stroke="#5aa0ff" stroke-width="2" stroke-dasharray="5 4"/>';
    s += '<path d="' + line('w') + '" fill="none" stroke="#ffcf6b" stroke-width="2.5"/>';
    pts.forEach(function (p, i) { s += '<circle cx="' + X(i) + '" cy="' + Y(p.w) + '" r="' + (pts.length > 40 ? 2 : 3.5) + '" fill="' + (p.ok ? '#ffcf6b' : '#ff6b5e') + '"/>'; });
    var df = function (d) { return (d.getMonth() + 1) + '/' + d.getDate(); };
    s += '<text x="' + pl + '" y="' + (H - 6) + '" fill="#8a9bb8" font-size="10">' + df(pts[0].d) + '</text>';
    if (pts.length > 1) s += '<text x="' + (W - pr) + '" y="' + (H - 6) + '" fill="#8a9bb8" font-size="10" text-anchor="end">' + df(pts[pts.length - 1].d) + '</text>';
    return s + '</svg>';
  }

  /* ---------------- TOOLS (plates + 1RM) ---------------- */
  var toolW = null;
  function renderTools() {
    if (toolW === null) toolW = S.lifts.squat.weight;
    view.innerHTML = '<h2>Plate calculator</h2><div class="card"><div class="stepper"><button id="tm">−</button>' +
      '<input id="tw" type="number" inputmode="decimal" step="any" value="' + fmt(toolW) + '"><button id="tp">+</button></div><div id="tpl"></div></div>' +
      '<h2>Estimated 1-rep max</h2><div class="card"><div class="grid2"><div class="field"><label>Weight (' + UL() + ')</label><input id="ew" type="number" inputmode="decimal" value="' + fmt(toolW) + '"></div>' +
      '<div class="field"><label>Reps</label><input id="er" type="number" inputmode="numeric" value="5"></div></div><div id="eo" class="stats"></div>' +
      '<div class="note">Epley formula. Best for sets of 10 reps or fewer. A guide, not a dare.</div></div>';
    var tw = $('#tw'), step = AF.UNIT_DEFAULTS[u()].round;
    var upd = function () { toolW = +tw.value || 0; $('#tpl').innerHTML = platesHTML(toolW); };
    $('#tm').onclick = function () { tw.value = fmt(Math.max(0, (+tw.value || 0) - step)); upd(); };
    $('#tp').onclick = function () { tw.value = fmt((+tw.value || 0) + step); upd(); };
    tw.oninput = upd; upd();
    var eupd = function () {
      var m = AF.e1rm(+$('#ew').value || 0, Math.round(+$('#er').value || 0));
      $('#eo').innerHTML = [[1, 'Est. 1RM'], [0.9, '90%'], [0.8, '80%']].map(function (p) {
        return '<div class="stat"><b>' + fmt(AF.roundTo(m * p[0], p[0] === 1 ? 0.5 : step)) + '</b><span>' + p[1] + '</span></div>';
      }).join('');
    };
    $('#ew').oninput = eupd; $('#er').oninput = eupd; eupd();
  }

  /* ---------------- SETTINGS ---------------- */
  function renderSettings() {
    var html = '<h2>Units</h2><div class="seg"><button data-u="lb" class="' + (u() === 'lb' ? 'on' : '') + '">Pounds (LBs)</button><button data-u="kg" class="' + (u() === 'kg' ? 'on' : '') + '">Kilograms (kg)</button></div>' +
      '<h2>Lifts — next working weight & increment</h2><div class="card">';
    AF.PROGRAM_LIFTS.forEach(function (k) {
      html += '<div class="grid2" style="margin-bottom:10px;grid-template-columns:1.4fr 1fr 1fr;align-items:end"><div><b>' + liftName(k) + '</b>' + (isDB(k) ? '<div class="note" style="margin:2px 0">per dumbbell</div>' : '') +
        (S.lifts[k].fails ? '<div class="note bad" style="margin:2px 0">' + S.lifts[k].fails + ' miss(es) <a href="#" data-rf="' + k + '" style="color:var(--brass2)">reset</a></div>' : '') + '</div>' +
        '<div class="field"><label>Weight</label><input data-lw="' + k + '" type="number" inputmode="decimal" step="any" value="' + fmt(S.lifts[k].weight) + '"></div>' +
        '<div class="field"><label>+ per win</label><input data-li="' + k + '" type="number" inputmode="decimal" step="any" value="' + fmt(S.lifts[k].inc) + '"></div></div>';
    });
    html += '<div class="note">Complete every rep → weight goes up next time. Miss reps ' + AF.FAILS_BEFORE_DELOAD + ' sessions in a row → drop ' + (AF.DELOAD_PCT * 100) + '% and build back.</div></div>' +
      '<h2>Bar & plates</h2><div class="card"><div class="grid2"><div class="field"><label>Bar weight (' + UL() + ')</label><input id="sb" type="number" inputmode="decimal" step="any" value="' + fmt(S.bar) + '"></div>' +
      '<div class="field"><label>Plates you own (per side, comma list)</label><input id="sp" value="' + S.plates.map(fmt).join(', ') + '"></div></div></div>' +
      '<h2>Rest timer (seconds)</h2><div class="card"><div class="grid2" style="grid-template-columns:1fr 1fr 1fr">' +
      '<div class="field"><label>After good set</label><input id="r1" type="number" inputmode="numeric" value="' + S.rest.success + '"></div>' +
      '<div class="field"><label>After a miss</label><input id="r2" type="number" inputmode="numeric" value="' + S.rest.fail + '"></div>' +
      '<div class="field"><label>2nd+ miss</label><input id="r3" type="number" inputmode="numeric" value="' + S.rest.failAgain + '"></div></div>' +
      '<button class="btn ghost sm" id="testBeep">Test alert sound</button>' +
      '<div class="note">' + (NATIVE ? 'The chime briefly lowers your music (Spotify, Apple Music) instead of stopping it, with a haptic tap. If the app is in the background or the phone is locked, a notification alerts you instead — allow notifications when asked.'
        : 'In a browser the beep plays alongside your music; it can\'t lower the music volume (the iPhone app can). iPhone Safari does not vibrate; keep the ringer on. The timer also turns green.') + '</div></div>' +
      '<h2>Warm-ups</h2><div class="seg"><button data-wu="1" class="' + (S.showWarmups ? 'on' : '') + '">Show warm-up sets</button><button data-wu="0" class="' + (!S.showWarmups ? 'on' : '') + '">Hide</button></div>' +
      '<h2>Accessories</h2><div class="note" style="margin-top:0">Or add from the <a href="#" id="libLink" style="color:var(--brass2)">exercise library</a> (free weights & cable machine).</div>';
    ['A', 'B'].forEach(function (w) {
      html += '<div class="card"><b>Workout ' + w + '</b><div class="note" style="margin:4px 0 8px">Name · sets · reps · ' + UL() + ' (0 = bodyweight)</div>';
      (S.accessories[w] || []).forEach(function (a, i) {
        html += '<div class="acc-edit"><input data-an="' + w + i + '" value="' + esc(a.name) + '"><input data-as="' + w + i + '" type="number" inputmode="numeric" value="' + a.sets + '">' +
          '<input data-ar="' + w + i + '" type="number" inputmode="numeric" value="' + a.reps + '"><input data-aw="' + w + i + '" type="number" inputmode="decimal" step="any" value="' + fmt(a.weight) + '">' +
          '<button class="x" data-ax="' + w + i + '" aria-label="Remove">✕</button></div>';
      });
      html += '<button class="chip" data-aa="' + w + '">+ Add accessory</button></div>';
    });
    var syncNote = !NATIVE ? 'Your data lives only on this device. Export a backup now and then (save it to Files or email it to yourself).'
      : (cloud.available ? '<span class="ok">● iCloud sync on</span> — ' + (cloud.note ? esc(cloud.note) : 'your data syncs privately to your other devices on the same Apple ID.') :
        cloud.available === false ? '<span class="muted">○ iCloud sync off</span> — ' + esc(cloud.note || 'not signed in to iCloud.') + ' Data is saved on this iPhone only.' : 'Checking iCloud…') +
        ' A copy is also kept in Files › On My iPhone › Anchor Five.';
    html += '<h2>Backup & sync</h2><div class="card"><div class="note" id="syncStatus" style="margin-top:0">' + syncNote + '</div>' +
      '<div class="grid2"><button class="btn sm" id="exp">' + (NATIVE ? 'Export to iCloud Drive / Files' : 'Export JSON') + '</button><button class="btn ghost sm" id="imp">' + (NATIVE ? 'Restore from iCloud Drive / Files' : 'Import JSON') + '</button></div>' +
      '<input type="file" id="impFile" accept="application/json,.json" class="hidden"></div>' +
      '<button class="btn danger" id="reset">Reset all data</button><div class="note" style="text-align:center;margin-top:16px">Anchor Five · v2.0 · works offline</div>';
    view.innerHTML = html;

    view.querySelectorAll('[data-u]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.u === u()) return;
        if (!confirm('Switch to ' + b.dataset.u + '? Current working weights, bar and plates will be converted and rounded. Past log entries keep their original numbers.')) return;
        AF.convertUnits(S, b.dataset.u); toolW = null; save(); render();
      };
    });
    var num = function (el, fn) { el.onchange = function () { var v = +el.value; if (isFinite(v) && v >= 0) { fn(v); save(); render(); } else render(); }; };
    view.querySelectorAll('[data-lw]').forEach(function (el) { num(el, function (v) { S.lifts[el.dataset.lw].weight = v; }); });
    view.querySelectorAll('[data-li]').forEach(function (el) { num(el, function (v) { S.lifts[el.dataset.li].inc = v; }); });
    view.querySelectorAll('[data-rf]').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); S.lifts[a.dataset.rf].fails = 0; save(); render(); }; });
    num($('#sb'), function (v) { S.bar = v; });
    $('#sp').onchange = function () {
      var p = $('#sp').value.split(/[ ,;]+/).map(Number).filter(function (x) { return x > 0; });
      if (p.length) S.plates = p.sort(function (a, b) { return b - a; }); save(); render();
    };
    num($('#r1'), function (v) { S.rest.success = Math.round(v); });
    num($('#r2'), function (v) { S.rest.fail = Math.round(v); });
    num($('#r3'), function (v) { S.rest.failAgain = Math.round(v); });
    $('#testBeep').onclick = function () { unlockAudio(); alertDone('rest'); };
    $('#libLink').onclick = function (e) { e.preventDefault(); openLibrary(null); };
    view.querySelectorAll('[data-wu]').forEach(function (b) { b.onclick = function () { S.showWarmups = b.dataset.wu === '1'; save(); render(); }; });
    var acc = function (attr, fn) {
      view.querySelectorAll('[data-' + attr + ']').forEach(function (el) {
        var id = el.dataset[attr.replace('-', '')], w = id[0], i = +id.slice(1);
        fn(el, S.accessories[w], i, w);
      });
    };
    acc('an', function (el, list, i) { el.onchange = function () { list[i].name = el.value.trim() || 'Accessory'; save(); }; });
    acc('as', function (el, list, i) { el.onchange = function () { list[i].sets = Math.max(1, Math.min(10, Math.round(+el.value) || 3)); save(); render(); }; });
    acc('ar', function (el, list, i) { el.onchange = function () { list[i].reps = Math.max(1, Math.round(+el.value) || 10); save(); render(); }; });
    acc('aw', function (el, list, i) { el.onchange = function () { list[i].weight = Math.max(0, +el.value || 0); save(); render(); }; });
    acc('ax', function (el, list, i) { el.onclick = function () { list.splice(i, 1); save(); render(); }; });
    view.querySelectorAll('[data-aa]').forEach(function (b) {
      b.onclick = function () { (S.accessories[b.dataset.aa] = S.accessories[b.dataset.aa] || []).push({ name: 'New exercise', sets: 3, reps: 10, weight: 0 }); save(); render(); };
    });
    $('#exp').onclick = exportData;
    $('#imp').onclick = function () { $('#impFile').click(); };
    $('#impFile').onchange = function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var obj = AF.normalize(JSON.parse(rd.result));
          if (!confirm('Replace current data with this backup (' + obj.history.length + ' sessions)?')) return;
          obj.deletedIds = (obj.deletedIds || []).concat(S.deletedIds || []);
          S = obj; save(); toast('Backup restored'); render();
        } catch (err) { alert('Import failed: ' + err.message); }
      };
      rd.readAsText(f);
    };
    $('#reset').onclick = function () {
      if (!confirm('Erase ALL sessions and settings on this device?')) return;
      if (!confirm('Really? Export a backup first if unsure.')) return;
      // Tombstone everything so iCloud sync doesn't bring the old log back.
      var gone = S.deletedIds.concat(S.history.map(function (h) { return h.id; }), S.recoveryLog.map(function (r) { return r.id; }), S.customDays.map(function (d) { return d.id; }));
      S = AF.defaultState(u()); S.deletedIds = gone; save(); render();
    };
  }
  function exportData() {
    var json = JSON.stringify(S, null, 1);
    var name = 'anchor-five-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    try {
      var file = new File([json], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Anchor Five backup' }).catch(function () {});
        return;
      }
    } catch (e) {}
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Backup downloaded');
  }

  /* ---------------- EXERCISE LIBRARY ---------------- */
  var libEquip = 'free', libTarget = null, libBack = 'train';
  function openLibrary(target) { libTarget = target; libBack = tab === 'library' ? libBack : tab; tab = 'library'; render(); window.scrollTo(0, 0); }
  function targetLabel(t) {
    if (!t) return '';
    if (t.kind === 'session') return 'Adding to today’s ' + esc(sessionName(S.current || {}));
    var d = findDay(t.id); return d ? 'Adding to ' + esc(d.name) : '';
  }
  function renderLibrary() {
    if (libTarget && libTarget.kind === 'session' && !S.current) libTarget = null;
    if (libTarget && libTarget.kind === 'day' && !findDay(libTarget.id)) libTarget = null;
    var list = AF.exercisesFor(libEquip), groups = [];
    list.forEach(function (e) { if (groups.indexOf(e.group) < 0) groups.push(e.group); });
    var html = '<div class="lib-top"><button class="chip" id="libBack">‹ Back</button><div class="lib-title">Exercise library</div></div>' +
      '<div class="seg lib-toggle"><button data-eq="free" class="' + (libEquip === 'free' ? 'on' : '') + '">Free Weights</button>' +
      '<button data-eq="cable" class="' + (libEquip === 'cable' ? 'on' : '') + '">Cable Machine</button></div>' +
      (libTarget ? '<div class="lib-target">' + targetLabel(libTarget) + ' · tap <b>+</b> to add</div>'
        : '<div class="note" style="margin-top:0">Tap <b>+</b> to add an exercise to today’s workout, to Workout A or B, or to build your own day.</div>');
    groups.forEach(function (g) {
      html += '<h2>' + esc(g) + '</h2><div class="card lib-card">';
      list.filter(function (e) { return e.group === g; }).forEach(function (e) {
        html += '<div class="lib-row"><div><b>' + esc(e.name) + '</b><div class="ex-sub">' + e.sets + ' × ' + e.reps + (e.perHand ? ' · per dumbbell' : '') + '</div></div>' +
          '<button class="plus" data-ex="' + e.id + '" aria-label="Add ' + esc(e.name) + '">+</button></div>';
      });
      html += '</div>';
    });
    if (libTarget) html += '<button class="btn" id="libDone">Done</button>';
    view.innerHTML = html;
    $('#libBack').onclick = libClose;
    if ($('#libDone')) $('#libDone').onclick = libClose;
    view.querySelectorAll('[data-eq]').forEach(function (b) { b.onclick = function () { libEquip = b.dataset.eq; render(); }; });
    view.querySelectorAll('[data-ex]').forEach(function (b) {
      b.onclick = function () { if (libTarget) addTo(libTarget, b.dataset.ex); else chooseTarget(b.dataset.ex); };
    });
  }
  function libClose() { tab = libTarget && libTarget.kind === 'session' ? 'train' : (libBack || 'train'); libTarget = null; render(); window.scrollTo(0, 0); }
  function addTo(t, exId) {
    var e = AF.EX_BY_ID[exId];
    if (t.kind === 'session') { if (!S.current) return; AF.addExerciseToSession(S.current, exId); }
    else if (t.kind === 'AB') S.accessories[t.w].push(Object.assign(AF.itemFromExercise(exId), {}));
    else { var d = findDay(t.id); if (!d) return; d.items.push(AF.itemFromExercise(exId)); }
    save(); toast('Added ' + e.name);
  }
  function chooseTarget(exId) {
    var e = AF.EX_BY_ID[exId], days = S.customDays || [];
    openSheet('<h3>' + esc(e.name) + '</h3><div class="note">' + e.sets + ' × ' + e.reps + ' · ' + (e.equip === 'cable' ? 'cable machine' : 'free weights') + ' · ' + esc(e.group) + '</div>' +
      (S.current ? '<button class="btn sm" data-t="session">Add to today’s workout</button>' : '') +
      '<div class="grid2"><button class="btn ghost sm" data-t="A">Add to Workout A</button><button class="btn ghost sm" data-t="B">Add to Workout B</button></div>' +
      days.map(function (d) { return '<button class="btn ghost sm" data-t="d:' + d.id + '">Add to ' + esc(d.name) + '</button>'; }).join('') +
      '<button class="btn ghost sm" data-t="new">+ New workout day with this</button><button class="btn ghost sm" id="tc">Cancel</button>', function (r) {
      $('#tc', r).onclick = closeSheet;
      r.querySelectorAll('[data-t]').forEach(function (b) {
        b.onclick = function () {
          var t = b.dataset.t; closeSheet();
          if (t === 'session') addTo({ kind: 'session' }, exId);
          else if (t === 'A' || t === 'B') addTo({ kind: 'AB', w: t }, exId);
          else if (t === 'new') { var d = newDay(); if (d) { addTo({ kind: 'day', id: d.id }, exId); libTarget = { kind: 'day', id: d.id }; render(); } }
          else addTo({ kind: 'day', id: t.slice(2) }, exId);
        };
      });
    });
  }

  /* ---------------- RECOVERY (sauna / hot tub) ---------------- */
  var RIV = null;
  function openRecovery(afterSession) {
    if (!S.recoveryActive) {
      var type = (S.recovery && S.recovery.type) || 'sauna';
      S.recoveryActive = { type: type, afterSession: afterSession || null, cd: AF.cdNew(AF.recoveryMinutes(type, S.recovery.minutes[type]) * 60), alerted: false };
      save();
    }
    tab = 'recovery'; render(); window.scrollTo(0, 0);
  }
  function clockMs(ms) { return mmss(Math.ceil(ms / 1000)); }
  function renderRecovery() {
    var R = S.recoveryActive; if (!R) { tab = 'train'; return renderTrain(); }
    var cfg = AF.RECOVERY[R.type], now = Date.now(), running = AF.cdRunning(R.cd), started = running || AF.cdElapsed(R.cd, now) > 0;
    var mins = Math.round(R.cd.duration / 60000);
    var html = '<div class="lib-top"><button class="chip" id="rBack">‹ Back</button><div class="lib-title">Recovery</div></div>' +
      '<div class="seg"><button data-rt="sauna" class="' + (R.type === 'sauna' ? 'on' : '') + '">Sauna</button><button data-rt="hottub" class="' + (R.type === 'hottub' ? 'on' : '') + '">Hot Tub</button></div>' +
      '<div class="card recov"><div class="r-kind">' + cfg.name + ' · recommended ' + (R.type === 'sauna' ? '15–20' : '10–15') + ' min</div>' +
      '<div class="r-time" id="rTime">' + clockMs(AF.cdRemaining(R.cd, now)) + '</div>' +
      '<div class="r-bar"><div id="rBar" style="width:' + (100 * AF.cdElapsed(R.cd, now) / R.cd.duration).toFixed(1) + '%"></div></div>' +
      '<div class="r-adj"><button class="chip" id="rMinus"' + (started ? ' disabled' : '') + '>−1 min</button><span><b>' + mins + '</b> min</span><button class="chip" id="rPlus"' + (started ? ' disabled' : '') + '>+1 min</button></div>' +
      '<div class="grid2"><button class="btn" id="rGo">' + (running ? 'Pause' : started ? 'Resume' : 'Start') + '</button><button class="btn ghost" id="rReset">Reset</button></div>' +
      (started ? '<button class="btn ghost sm" id="rEnd">Finish now & log</button>' : '') + '</div>' +
      '<div class="card safety"><b>Stay safe in the heat</b><ul>' +
      '<li>Drink water before and after — you lose fluid fast.</li>' +
      '<li>Cool down for a few minutes after lifting before you get in.</li>' +
      '<li>Get out right away if you feel dizzy, light-headed, nauseous or unwell.</li>' +
      '<li>Skip it after alcohol, and check with a doctor first if you are pregnant or have heart or blood-pressure conditions.</li></ul>' +
      '<div class="note" style="margin:6px 0 0">General guidance only — not medical advice.</div></div>' +
      '<button class="btn ghost sm" id="rSkip">' + (started ? 'Cancel without logging' : 'Skip recovery') + '</button>';
    view.innerHTML = html;
    view.querySelectorAll('[data-rt]').forEach(function (b) {
      b.onclick = function () {
        if (b.dataset.rt === R.type) return;
        if (started && !confirm('Switch and restart the timer?')) return;
        R.type = b.dataset.rt; S.recovery.type = R.type; R.cd = AF.cdNew(AF.recoveryMinutes(R.type, S.recovery.minutes[R.type]) * 60); R.alerted = false;
        cancelNotice('recovery'); save(); render();
      };
    });
    var adj = function (d) {
      var m = AF.recoveryMinutes(R.type, mins + d); S.recovery.minutes[R.type] = m; AF.cdSetDuration(R.cd, m * 60, Date.now()); save(); render();
    };
    $('#rMinus').onclick = function () { adj(-1); };
    $('#rPlus').onclick = function () { adj(1); };
    $('#rGo').onclick = function () {
      unlockAudio(); var t = Date.now();
      if (AF.cdRunning(R.cd)) { AF.cdPause(R.cd, t); cancelNotice('recovery'); }
      else { AF.cdStart(R.cd, t); scheduleNotice('recovery', AF.cdRemaining(R.cd, t) / 1000, cfg.name + ' session done', 'Time to get out, cool down and drink some water.'); keepAwake(true); }
      save(); render();
    };
    $('#rReset').onclick = function () { AF.cdReset(R.cd); R.alerted = false; cancelNotice('recovery'); save(); render(); };
    if ($('#rEnd')) $('#rEnd').onclick = function () { finishRecovery(true); };
    $('#rSkip').onclick = function () { if (started && !confirm('Stop without logging this session?')) return; endRecovery(); toast('Recovery skipped'); };
    $('#rBack').onclick = function () { tab = 'train'; render(); };
    if (!RIV) RIV = setInterval(tickRecovery, 250);
  }
  function tickRecovery() {
    var R = S.recoveryActive; if (!R) { if (RIV) { clearInterval(RIV); RIV = null; } return; }
    var now = Date.now();
    if (tab === 'recovery' && $('#rTime')) {
      $('#rTime').textContent = clockMs(AF.cdRemaining(R.cd, now));
      $('#rBar').style.width = (100 * AF.cdElapsed(R.cd, now) / R.cd.duration).toFixed(1) + '%';
    }
    if (AF.cdRunning(R.cd) && AF.cdDone(R.cd, now)) {
      var overdue = now - (R.cd.startedAt + R.cd.duration - R.cd.elapsed);
      if (overdue <= 5000) alertDone('recovery'); else cancelNotice('recovery'); // late = notification already alerted
      finishRecovery(false);
    }
  }
  function finishRecovery(early) {
    var R = S.recoveryActive, now = Date.now();
    var actual = AF.cdElapsed(R.cd, now) / 1000;
    if (early) cancelNotice('recovery');
    AF.logRecovery(S, { type: R.type, plannedSec: R.cd.duration / 1000, actualSec: actual, afterSession: R.afterSession });
    endRecovery();
    openSheet('<h3>' + AF.RECOVERY[R.type].name + ' done</h3><div class="note">' + Math.round(actual / 60) + ' min logged. Cool down gradually and drink some water.</div>' +
      '<button class="btn" id="rOk">Done</button>', function (r) { $('#rOk', r).onclick = closeSheet; });
  }
  function endRecovery() {
    S.recoveryActive = null; cancelNotice('recovery'); save();
    if (!S.current) keepAwake(false);
    if (RIV) { clearInterval(RIV); RIV = null; }
    if (tab === 'recovery') tab = 'train';
    render();
  }

  /* ---------------- router ---------------- */
  function render() {
    $('#unitBadge').textContent = S.units === 'kg' ? 'KG' : 'LBs';
    var nav = tab === 'library' || tab === 'recovery' ? 'train' : tab;
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === nav); });
    ({ train: renderTrain, history: renderHistory, progress: renderProgress, tools: renderTools, settings: renderSettings, library: renderLibrary, recovery: renderRecovery })[tab]();
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.onclick = function () { tab = b.dataset.tab; render(); window.scrollTo(0, 0); };
  });
  render();
  if (S.current || S.recoveryActive) keepAwake(true);
  if (S.recoveryActive) { tab = 'recovery'; render(); }
  native('afSync', { action: 'pull' }); // iOS app: fetch iCloud copy + status

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW failed', e); });
  }
  window.__AF_STATE = function () { return S; }; // for testing
})();

// v2 browser test + screenshots. Needs a static server on :8765 (python3 -m http.server 8765).
const puppeteer = require('puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const out = { errs: [] };
  const mk = async (nativeMock) => {
    const ctx = await b.createBrowserContext();
    const p = await ctx.newPage();
    p.on('pageerror', e => out.errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') out.errs.push('console: ' + m.text()); });
    p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Cable Day' : undefined));
    await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    if (nativeMock) await p.evaluateOnNewDocument(() => {
      window.__msgs = [];
      const h = n => ({ postMessage: m => window.__msgs.push([n, JSON.parse(JSON.stringify(m))]) });
      window.webkit = { messageHandlers: { restDone: h('restDone'), afNotify: h('afNotify'), afSync: h('afSync'), afExport: h('afExport') } };
    });
    return p;
  };
  const shot = (p, n) => p.screenshot({ path: '/workspace/shots/' + n + '.png' });
  const U = 'http://localhost:8765/index.html';

  // ---- 1. browser mode: home, library, custom day, workout, recovery ----
  let p = await mk(false);
  await p.goto(U, { waitUntil: 'networkidle0' });
  out.badge = await p.$eval('#unitBadge', e => getComputedStyle(e).textTransform + '|' + e.innerText);
  out.homeHasDbRow = await p.evaluate(() => document.body.innerText.includes('Dumbbell Row'));
  out.homeHasBarbellRow = await p.evaluate(() => document.body.innerText.includes('Barbell Row'));
  await shot(p, 'v2-home');
  await p.click('#lib'); await sleep(150);
  out.libFreeCount = await p.$$eval('[data-ex]', e => e.length);
  await shot(p, 'v2-library');
  await p.click('[data-eq="cable"]'); await sleep(150);
  out.libCableNames = await p.$$eval('.lib-row b', e => e.map(x => x.textContent).slice(0, 4));
  await shot(p, 'v2-library-cable');
  // + on Lat Pulldown -> sheet -> new day
  await p.click('[data-ex="lat-pulldown"]'); await sleep(200);
  await p.click('[data-t="new"]'); await sleep(200);
  await p.click('[data-ex="cable-row"]'); await sleep(100);
  await p.$eval('#libDone', e => e.click()); await sleep(150);
  out.customDays = await p.evaluate(() => window.__AF_STATE().customDays.map(d => d.name + ':' + d.items.map(i => i.name).join(',')));
  // Start workout A, add exercise from library mid-session
  await p.click('#start'); await sleep(100);
  out.dbRowCard = await p.evaluate(() => [...document.querySelectorAll('.ex-name')].map(e => e.textContent));
  out.noPlatesForDb = await p.evaluate(() => !!document.querySelector('.dbtag'));
  await p.click('#addEx'); await sleep(150);
  await p.click('[data-eq="free"]'); await sleep(100);
  await p.click('[data-ex="db-curl"]'); await sleep(100);
  await p.$eval('#libDone', e => e.click()); await sleep(150);
  out.sessionAcc = await p.evaluate(() => window.__AF_STATE().current.accessories.map(a => a.name));
  await shot(p, 'v2-workout');
  // rest timer: tap a set, force end, see it fire (beep path)
  await p.click('.set[data-l="0"][data-s="0"]'); await sleep(100);
  await p.evaluate(() => { for (let i = 0; i < 10; i++) document.querySelector('#tMinus').click(); });
  await sleep(600);
  out.timerFired = await p.$eval('#timer', e => e.className);
  // finish -> recovery offer
  await p.evaluate(() => { const c = window.__AF_STATE().current; c.lifts.forEach(e => e.sets = e.sets.map(() => 5)); });
  await p.click('#finish'); await sleep(300);
  out.recoveryOffer = await p.evaluate(() => !!document.querySelector('#rgo') && document.querySelector('.sheet-card').innerText.includes('Hot Tub'));
  await shot(p, 'v2-finished-offer');
  await p.click('#rgo'); await sleep(200);
  await p.click('#rGo'); await sleep(1300);
  await shot(p, 'v2-recovery');
  out.recoveryRunning = await p.evaluate(() => { const R = window.__AF_STATE().recoveryActive; return !!R && R.cd.startedAt != null; });
  await p.click('[data-rt="hottub"]'); await sleep(200);
  out.hotTubMins = await p.evaluate(() => window.__AF_STATE().recoveryActive.cd.duration / 60000);
  await shot(p, 'v2-recovery-hottub');
  // speed to the end
  await p.evaluate(() => { const R = window.__AF_STATE().recoveryActive; R.cd.elapsed = R.cd.duration - 500; });
  await p.click('#rGo'); await sleep(1200);
  out.recoveryLog = await p.evaluate(() => window.__AF_STATE().recoveryLog.map(r => r.type + ':' + r.plannedSec));
  await p.click('#rOk').catch(() => {});
  await p.click('.tabs [data-tab="history"]'); await sleep(150);
  await shot(p, 'v2-history');
  await p.click('.tabs [data-tab="settings"]'); await sleep(150);
  out.settingsText = await p.evaluate(() => ['Pounds (LBs)', 'Dumbbell Row', 'per dumbbell', 'v2.0'].map(t => document.body.innerText.includes(t)));
  await p.click('.tabs [data-tab="progress"]'); await sleep(150);
  out.progressBtns = await p.$$eval('[data-pl]', e => e.map(x => x.textContent));
  out.sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  out.swCache = await p.evaluate(async () => (await caches.keys()).join(','));

  // ---- 2. migration from v1 data in localStorage ----
  p = await mk(false);
  await p.goto(U, { waitUntil: 'networkidle0' });
  await p.evaluate(() => localStorage.setItem('anchorfive.v1', JSON.stringify({ version: 1, units: 'lb', bar: 45, plates: [45, 25, 10, 5, 2.5],
    lifts: { squat: { weight: 185, inc: 5, fails: 0 }, bench: { weight: 135, inc: 5, fails: 0 }, row: { weight: 115, inc: 5, fails: 0 }, ohp: { weight: 85, inc: 5, fails: 0 }, deadlift: { weight: 225, inc: 10, fails: 0 } },
    rest: { success: 90, fail: 180, failAgain: 300 }, showWarmups: true, nextWorkout: 'A', accessories: { A: [], B: [] },
    history: [{ id: 'old1', date: '2026-10-20T09:00:00Z', workout: 'A', lifts: [{ lift: 'row', weight: 115, reps: 5, setsTarget: 5, sets: [5, 5, 5, 5, 5] }], accessories: [] }], current: null })));
  await p.reload({ waitUntil: 'networkidle0' });
  out.migrated = await p.evaluate(() => { const S = window.__AF_STATE(); return { dbrow: S.lifts.dbrow.weight, row: !!S.lifts.row, hist: S.history.length, text: document.body.innerText.includes('Dumbbell Row') }; });
  await p.click('.tabs [data-tab="progress"]'); await sleep(100);
  out.migratedProgress = await p.$$eval('[data-pl]', e => e.map(x => x.textContent));

  // ---- 3. iOS wrapper mode (mocked message handlers) ----
  p = await mk(true);
  await p.goto(U, { waitUntil: 'networkidle0' });
  await p.click('#start'); await sleep(50);
  await p.click('.set[data-l="0"][data-s="0"]'); await sleep(50);
  await p.evaluate(() => { for (let i = 0; i < 10; i++) document.querySelector('#tMinus').click(); });
  await sleep(600);
  // iCloud push from "another device" with an extra session; local in-progress workout must survive
  await p.evaluate(() => {
    const r = AF.defaultState(); r.lastModified = Date.now() + 5000; r.lifts.squat.weight = 999;
    r.history.push({ id: 'remote1', date: '2026-10-25T09:00:00Z', workout: 'B', lifts: [], accessories: [] });
    window.AFNative.remote(JSON.stringify(r));
    window.AFNative.status({ available: true, note: '' });
  });
  const ns = await p.evaluate(() => { const S = window.__AF_STATE(); return { hist: S.history.map(h => h.id), squat: S.lifts.squat.weight, current: !!S.current }; });
  const msgs = await p.evaluate(() => window.__msgs);
  out.native = { kinds: [...new Set(msgs.map(m => m[0] + (m[1].action ? ':' + m[1].action : m[1].kind ? ':' + m[1].kind : '')))],
    firstNotify: msgs.find(m => m[0] === 'afNotify'), merged: ns };
  await p.click('.tabs [data-tab="settings"]'); await sleep(100);
  out.nativeSettings = await p.$eval('#syncStatus', e => e.innerText);
  out.nativeButtons = await p.$$eval('#exp,#imp', e => e.map(x => x.textContent));
  await shot(p, 'v2-settings-ios');
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });

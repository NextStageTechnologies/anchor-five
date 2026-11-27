/**
 * Playwright continuity checks (iPhone viewport).
 * Run: NODE_PATH=.../node_modules node tests/e2e.continuity.pw.js
 */
const { chromium } = require('playwright-core');

const CHROME = process.env.CHROME || '/usr/bin/google-chrome';
const URL = process.env.LOCAL_URL || 'http://127.0.0.1:8765/';
const IPHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
};

let failed = 0, passed = 0;
function rec(ok, name, detail) {
  if (ok) passed++; else failed++;
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? ' — ' + detail : ''));
}

(async () => {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({ ...IPHONE, acceptDownloads: true });
  const dialogs = [];
  context.on('page', (page) => {
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    page.on('pageerror', (e) => { rec(false, 'pageerror', String(e)); });
  });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#start');

  // ---- rest timer persists across reload ----
  await page.click('#start');
  await page.waitForSelector('.set[data-l="0"][data-s="0"]');
  await page.click('.set[data-l="0"][data-s="0"]');
  await page.waitForSelector('#timer:not(.hidden)');
  const before = await page.evaluate(() => {
    const S = window.__AF_STATE();
    return { time: document.querySelector('#timerTime').textContent, end: S.restActive && S.restActive.end, label: S.restActive && S.restActive.label };
  });
  rec(!!(before.end && before.time), 'rest timer is saved on S.restActive while running', JSON.stringify(before));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#view');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const el = document.querySelector('#timer');
    const hidden = !el || el.classList.contains('hidden');
    const S = window.__AF_STATE();
    return { hidden, time: el && el.querySelector('#timerTime') && el.querySelector('#timerTime').textContent, hasCurrent: !!S.current, rest: S.restActive, logged: S.current && S.current.lifts[0].sets[0] };
  });
  rec(!after.hidden && after.hasCurrent && after.logged === 5 && after.rest && after.rest.end,
    'reload mid-rest restores the workout AND the rest timer',
    JSON.stringify(after));

  // ---- sauna running + start workout warns, banner stays visible ----
  await page.click('#tSkip');
  await page.click('#discard'); // confirm auto-accepted
  await page.waitForSelector('#recov');
  await page.click('#recov');
  await page.waitForSelector('#rGo');
  await page.click('#rGo'); // start sauna
  await page.waitForTimeout(200);
  await page.click('#rBack');
  await page.waitForSelector('#start');
  const bannerBefore = await page.locator('#recovBanner').count();
  rec(bannerBefore === 1, 'sauna banner is visible on Train while the timer runs');
  dialogs.length = 0;
  await page.click('#start');
  await page.waitForTimeout(300);
  const warned = dialogs.some((m) => /timer is still running/i.test(m));
  const inWorkout = await page.locator('#finish').count();
  const bannerInWorkout = await page.locator('#recovBanner').count();
  rec(warned && inWorkout === 1 && bannerInWorkout === 1,
    'starting a workout while sauna runs warns and keeps a visible banner',
    'warned=' + warned + ' dialogs=' + JSON.stringify(dialogs) + ' banner=' + bannerInWorkout);

  // finish this workout later; first test units after a completed session
  // log remaining sets quickly and finish
  async function logAll() {
    const lifts = await page.$$eval('.set[data-l]', els => [...new Set(els.map(e => e.getAttribute('data-l')))]);
    for (const li of lifts) {
      const n = await page.$$eval(`.set[data-l="${li}"]`, els => els.length);
      for (let si = 0; si < n; si++) {
        const sel = `.set[data-l="${li}"][data-s="${si}"]`;
        const val = await page.$eval(sel, e => e.textContent.trim());
        if (val === '') {
          await page.click(sel);
          if (await page.locator('#timer:not(.hidden)').count()) await page.click('#tSkip');
        }
      }
    }
  }
  await logAll();
  await page.click('#finish');
  await page.waitForTimeout(200);
  if (await page.locator('#dn').count()) await page.click('#dn');
  // recovery may still be active; cancel if a sheet isn't up
  // go to log
  await page.click('.tabs [data-tab="history"]');
  await page.waitForTimeout(200);
  const histHead = await page.locator('h2').first().innerText();
  rec(/^1 session(\b|$)/i.test(histHead) && !/1 sessions/i.test(histHead),
    'Log heading pluralizes as “1 session”',
    'h2=' + histHead);

  // ---- unit switch: stored history stays in lb, display converts ----
  const storedBefore = await page.evaluate(() => {
    const S = window.__AF_STATE();
    const squat = S.history[0].lifts.find(e => e.lift === 'squat');
    return { units: S.history[0].units, weight: squat.weight, display: document.body.innerText };
  });
  rec(storedBefore.units === 'lb' && storedBefore.weight === 45, 'session stored as 45 lb', JSON.stringify({ units: storedBefore.units, weight: storedBefore.weight }));
  await page.click('.tabs [data-tab="settings"]');
  await page.waitForTimeout(200);
  await page.click('[data-u="kg"]');
  await page.waitForTimeout(300);
  rec((await page.locator('#unitBadge').innerText()).trim() === 'KG', 'badge switches to KG');
  await page.click('.tabs [data-tab="history"]');
  await page.waitForTimeout(200);
  const afterSwitch = await page.evaluate(() => {
    const S = window.__AF_STATE();
    const squat = S.history[0].lifts.find(e => e.lift === 'squat');
    return { storedUnits: S.history[0].units, storedWeight: squat.weight, text: document.querySelector('#view').innerText };
  });
  rec(afterSwitch.storedUnits === 'lb' && afterSwitch.storedWeight === 45,
    'stored history is still 45 lb after switching to kg',
    JSON.stringify({ storedUnits: afterSwitch.storedUnits, storedWeight: afterSwitch.storedWeight }));
  rec(/Squat 20/.test(afterSwitch.text),
    'Log displays the squat in kilograms (45 lb → 20 kg)',
    afterSwitch.text.slice(0, 200).replace(/\n/g, ' | '));
  // switch back so later tests stay in lb
  await page.click('.tabs [data-tab="settings"]');
  await page.waitForTimeout(200);
  await page.click('[data-u="lb"]');
  await page.waitForTimeout(300);

  // ---- Setup does not drop a field mid-typing ----
  await page.click('.tabs [data-tab="settings"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const squat = document.querySelector('[data-lw="squat"]');
    squat.value = '225';
    // no change event yet
    const inc = document.querySelector('[data-li="bench"]');
    inc.value = '2.5';
    inc.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const mid = await page.evaluate(() => ({
    squatInput: document.querySelector('[data-lw="squat"]').value,
    squatState: window.__AF_STATE().lifts.squat.weight,
    benchInc: window.__AF_STATE().lifts.bench.inc,
  }));
  rec(mid.squatInput === '225' && mid.benchInc === 2.5,
    'changing bench increment does not wipe an unsaved squat field',
    JSON.stringify(mid));
  // commit squat too
  await page.evaluate(() => {
    const squat = document.querySelector('[data-lw="squat"]');
    squat.dispatchEvent(new Event('change', { bubbles: true }));
  });

  // ---- increment 0 survives reload ----
  await page.evaluate(() => {
    const el = document.querySelector('[data-li="ohp"]');
    el.value = '0';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  rec((await page.evaluate(() => window.__AF_STATE().lifts.ohp.inc)) === 0, 'increment 0 is saved in state');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#view');
  await page.waitForTimeout(250);
  const afterZero = await page.evaluate(() => {
    const S = window.__AF_STATE();
    return { ohpInc: S.lifts.ohp.inc, squat: S.lifts.squat.weight };
  });
  rec(afterZero.ohpInc === 0, 'increment 0 survives reload (normalize does not restore the default)', JSON.stringify(afterZero));

  // ---- import tombstones: replace then simulated iCloud merge cannot resurrect ----
  await page.click('.tabs [data-tab="settings"]');
  await page.waitForTimeout(200);
  const mergeCheck = await page.evaluate(() => {
    const local = JSON.parse(JSON.stringify(window.__AF_STATE()));
    const backup = AF.defaultState('lb');
    backup.history = [{ id: 'from-backup', date: '2026-01-01T00:00:00Z', units: 'lb', workout: 'A', lifts: [], accessories: [] }];
    backup.deletedIds = AF.importTombstones(local, backup);
    backup.lastModified = Date.now() + 1000; // import calls save(), so the backup is newer than iCloud
    const r = AF.mergeStates(backup, local);
    return { deleted: backup.deletedIds, ids: r.state.history.map(h => h.id) };
  });
  rec(mergeCheck.ids.length === 1 && mergeCheck.ids[0] === 'from-backup',
    'import tombstones keep iCloud merge from resurrecting replaced sessions',
    JSON.stringify(mergeCheck));

  // ---- Setup miss plural if any ----
  // skip if no fails

  rec(failed === 0, 'no failures in Playwright continuity suite', passed + ' passed, ' + failed + ' failed');
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('dialog', d => d.accept());
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const U = 'http://localhost:8765/index.html';
  await p.goto(U, { waitUntil: 'networkidle0' });
  const shot = n => p.screenshot({ path: '/workspace/shots/' + n + '.png' });
  await shot('1-home');
  await p.click('#start');
  // squat: all 5; bench: 5,5,5,4,3 ; row all 5
  const tap = async (l, s, times = 1) => { for (let i = 0; i < times; i++) { await p.click(`.set[data-l="${l}"][data-s="${s}"]`); await new Promise(r=>setTimeout(r,60)); } };
  for (let s = 0; s < 5; s++) await tap(0, s);
  const timerVisible = await p.$eval('#timer', e => !e.classList.contains('hidden'));
  const timerTxt = await p.$eval('#timerTime', e => e.textContent);
  for (let s = 0; s < 3; s++) await tap(1, s);
  await tap(1, 3, 2); // 4
  const failTimer = await p.$eval('#timerTime', e => e.textContent);
  await tap(1, 4, 3); // 3
  const fail2Timer = await p.$eval('#timerTime', e => e.textContent);
  await p.click('[data-warm="squat"]');
  await shot('2-workout');
  for (let s = 0; s < 5; s++) await tap(2, s);
  await p.click('.set[data-a="0"][data-s="0"]');
  await p.click('#finish');
  await new Promise(r => setTimeout(r, 300));
  await shot('3-finished');
  const st = await p.evaluate(() => window.__AF_STATE());
  // 2 more failing bench sessions → deload
  await p.evaluate(() => {
    const S = window.__AF_STATE(); S.lifts.bench.weight = 155;
    for (let i = 0; i < 2; i++) { S.nextWorkout = 'A'; const x = AF.newSession(S); x.lifts.forEach(e => e.sets = e.lift === 'bench' ? [5,5,5,4,3] : new Array(e.setsTarget).fill(5)); x.date = new Date(Date.now() - (2 - i) * 864e5).toISOString(); x.id += i; AF.applySession(S, x); }
    localStorage.setItem('anchorfive.v1', JSON.stringify(S));
  });
  await p.reload({ waitUntil: 'networkidle0' });
  const st2 = await p.evaluate(() => window.__AF_STATE());
  for (const t of ['history', 'progress', 'tools', 'settings']) {
    await p.click(`.tabs [data-tab="${t}"]`); await new Promise(r => setTimeout(r, 150)); await shot('4-' + t);
  }
  await p.click('[data-pl="bench"]').catch(()=>{});
  await p.click('.tabs [data-tab="progress"]'); await p.click('[data-pl="bench"]'); await shot('5-progress-bench');
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.ready; return !!r.active; });
  await p.setOfflineMode(true);
  await p.reload({ waitUntil: 'domcontentloaded' });
  const offlineOk = await p.evaluate(() => !!document.querySelector('.tabs') && typeof AF === 'object');
  console.log(JSON.stringify({ errs, timerVisible, timerTxt, failTimer, fail2Timer,
    after1: { squat: st.lifts.squat.weight, bench: st.lifts.bench, dbrow: st.lifts.dbrow.weight, next: st.nextWorkout, hist: st.history.length },
    after3: { bench: st2.lifts.bench, hist: st2.history.length }, sw, offlineOk }, null, 1));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });

# Anchor Five — 5×5 strength log (PWA)

A no-frills, offline strength tracker built around two alternating 5×5 workouts:

| Workout A | Workout B |
|---|---|
| Squat 5×5 | Squat 5×5 |
| Bench Press 5×5 | Overhead Press 5×5 |
| Dumbbell Row 5×5 (per dumbbell) | Deadlift 1×5 |

**How it works:** log every rep. Hit all of them and the lift goes up next session (+5 lb, deadlift +10 lb, dumbbell row +5 lb per dumbbell; you can change this). Miss reps 3 sessions in a row and that lift drops 10%, then you build back up.

## Features
- Tap a set to log it: 5 → 4 → 3 → 2 → 1 → 0 → clear
- Rest timer starts on its own: 90 s after a good set, 3 min after a miss, 5 min after a second miss (change these in Setup). Plays a chime when time's up, and vibrates on Android. In the iOS app the chime dims (ducks) your music instead of stopping it, and a notification backs it up if the app isn't open.
- Exercise library (v2): Free Weights / Cable Machine toggle; add an exercise to today's workout or to Workout A/B, or build your own extra days
- Sauna / hot tub recovery timer after a workout (sauna 15 min, hot tub 12 min by default, adjustable), with start/pause/reset and a chime at the end; sessions show in the log
- Upgrading from v1: Barbell Row history is kept (shown as "Barbell Row"); the new Dumbbell Row starts at half your last row weight per dumbbell, rounded down to 5 lb (115 lb row → 55 lb dumbbells)
- Screen stays on during a workout (on browsers that support it)
- Warm-up sets worked out for each lift, with plates listed (dumbbell row: weight per dumbbell, no plates)
- Plate calculator (per side), with your own bar weight and plate set
- Optional accessory exercises for Workout A and Workout B
- Workout log, a progress chart for each lift, estimated 1RM (Epley), total volume, week streak
- LBs / kg switch
- Export/import a JSON backup
- Works offline once it's been opened

All data stays on the phone (localStorage). Nothing goes to a server. (The iOS app can also sync it through your own private iCloud.)

## Putting it on your iPhone
Opening `index.html` as a file on an iPhone **won't** install it as an app. It has to be served over HTTPS once. After that it works offline. Two free options:

### Option 1: Netlify Drop (easiest, ~2 minutes)
1. On a computer, go to https://app.netlify.com/drop
2. Drag the whole `workout-app` folder onto the page. A free Netlify account is needed to keep the site (otherwise it expires).
3. You get a URL like `https://something.netlify.app`.

### Option 2: GitHub Pages
1. Create a free GitHub repo (e.g. `anchor-five`) and upload the files in this folder (index.html in the root).
2. Repo **Settings → Pages → Deploy from branch → main / root → Save**.
3. A minute later it's live at `https://<username>.github.io/anchor-five/`.

### Then, on the iPhone
1. Open the URL in **Safari** (it has to be Safari).
2. Tap **Share** (square with an up arrow) → **Add to Home Screen** → **Add**.
3. Open **Anchor Five** from the home screen. It runs full-screen and offline.

Tips
- Keep the ringer on if you want to hear the timer alert. iPhones don't let web apps vibrate.
- iOS pauses web apps in the background, so the timer can't alert you while the phone is locked or you're in another app. The countdown is still correct when you come back.
- Go to **Setup → Export JSON** now and then and save the file to Files/iCloud. Deleting the home-screen app also deletes its data.
- Updating: upload the new files, then bump `CACHE` in `sw.js` so phones pick up the change.

## Development
- Files: `index.html`, `app.css`, `app.js` (UI), `logic.js` (program rules, no DOM), `sw.js`, `manifest.json`, `icons/`
- Test locally: `python3 -m http.server 8000` and open http://localhost:8000
- Logic tests: `node tests/logic.test.js` (runs `logic.v2.test.js` too)
- Browser tests (puppeteer-core + Chrome, server on :8765): `node tests/e2e.puppeteer.js`, `node tests/e2e.v2.puppeteer.js`

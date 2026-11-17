// Headless playtest: drives the real game logic through mission 1 (walk, take a car, drive
// to the lock-up, wanted level, police response) and reports what happened, step by step.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const profile = mkdtempSync(join(tmpdir(), 'mfplay-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--window-size=1280,720', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
chrome.stderr.on('data', (d) => { stderr += d; });
const wsUrl = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(stderr.slice(-600))), 15000);
  chrome.stderr.on('data', () => { const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const events = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method) events.push(m);
});
const send = (method, params = {}, sessionId) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); });
const { result: ti } = await send('Target.createTarget', { url: 'about:blank' });
const at = await send('Target.attachToTarget', { targetId: ti.targetId, flatten: true });
const s = at.result.sessionId;
await send('Runtime.enable', {}, s);
await send('Page.enable', {}, s);
await send('Log.enable', {}, s);
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, s);
await send('Page.navigate', { url: process.argv[2] ?? 'http://127.0.0.1:8080/?seed=7' }, s);
await new Promise((r) => setTimeout(r, 4000));

const run = async (label, expr) => {
  const r = await send('Runtime.evaluate', { expression: `(() => { const g = window.__game; ${expr} })()`, returnByValue: true, awaitPromise: true }, s);
  if (r.exceptionDetails) {
    console.log(`${label}: EXCEPTION ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return null;
  }
  const v = r.result?.result?.value;
  console.log(`${label}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  return v;
};

// Step the deterministic simulation with a scripted input override.
const step = (frames, override) => `g.input.override = ${JSON.stringify(override ?? {})};
  for (let i = 0; i < ${frames}; i++) g.tick(1 / 60);
  g.input.override = null;
  return JSON.stringify({ mode: g.mode, mission: g.missions.index, step: g.missions.step,
    stars: g.police.stars, units: g.police.units.length, cash: g.cash,
    inCar: !!g.player.inCar, hp: Math.round(g.player.health),
    pos: [Math.round(g.player.pos.x), Math.round(g.player.pos.z)],
    obj: g.missions.objectiveText(), banner: g.missions.banner?.text ?? null,
    carSpeed: g.player.inCar ? +g.player.inCar.speed.toFixed(1) : 0 });`;

console.log('--- start the game from the title screen');
await run('title', `g.startGame(false); return JSON.stringify({ mode: g.mode, mission: g.missions.index, pos: [Math.round(g.player.pos.x), Math.round(g.player.pos.z)], obj: g.missions.objectiveText() });`);

console.log('--- walk forward for a second');
await run('walk', step(60, { forward: true }));

console.log('--- walk toward the nearest car and take it');
await run('prep', `
  let best = null, bd = 1e9;
  for (const c of g.vehicles.cars) {
    if (c.wrecked) continue;
    const d = Math.hypot(c.pos.x - g.player.pos.x, c.pos.z - g.player.pos.z);
    if (d < bd) { bd = d; best = c; }
  }
  g.player.pos.x = best.pos.x + 1.6; g.player.pos.z = best.pos.z; g.player.pos.y = 0;
  return JSON.stringify({ nearest: best.type, dist: +bd.toFixed(1) });`);
await run('enter', `g.input.pressed.add('enter'); g.tick(1/60); return JSON.stringify({ inCar: !!g.player.inCar, type: g.player.inCar?.type, stars: g.police.stars, mode: g.mode });`);

console.log('--- drive for two seconds');
await run('drive', step(120, { forward: true }));

console.log('--- teleport near the lock-up and arrive');
await run('arrive', `
  const m = g.missions.marker;
  const car = g.player.inCar;
  car.pos.x = m.x + 3; car.pos.z = m.z + 2; car.vel.set(0, 0, 0); car.speed = 0;
  g.player.pos.set(car.pos.x, 0, car.pos.z);
  for (let i = 0; i < 10; i++) g.tick(1/60);
  return JSON.stringify({ mission: g.missions.index, state: g.missions.state, banner: g.missions.banner?.text ?? null, cash: g.cash, stars: g.police.stars });`);

console.log('--- wait for mission two to start');
await run('next', `for (let i = 0; i < 120; i++) g.tick(1/60);
  return JSON.stringify({ mission: g.missions.index, state: g.missions.state, name: g.missions.current?.name, target: !!g.missions.target, obj: g.missions.objectiveText() });`);

console.log('--- police response at three stars');
await run('wanted', `
  g.police.setStars(3);
  for (let i = 0; i < 240; i++) g.tick(1/60);
  const d = g.police.units.map(u => Math.round(Math.hypot(u.car.pos.x - g.player.pos.x, u.car.pos.z - g.player.pos.z)));
  return JSON.stringify({ stars: g.police.stars, units: g.police.units.length, dists: d, hudStars: document.querySelectorAll('#stars .star.on').length, minimapBlips: g.police.units.length });`);

console.log('--- shoot, punch, pause, save, resume');
await run('combat', `
  g.player.weapon = 'pistol'; g.player.ammo = 12; g.player.fireCooldown = 0;
  g.cameraYaw = 0; const before = g.player.ammo; g.fire();
  g.input.pressed.add('punch'); g.tick(1/60);
  g.input.pressed.add('pause'); g.tick(1/60);
  const paused = g.mode;
  g.saveGame(false);
  const saved = !!localStorage.getItem('portmeridian.save.v1');
  g.resume();
  return JSON.stringify({ ammoBefore: before, ammoAfter: g.player.ammo, paused, saved, mode: g.mode, weaponLabel: document.getElementById('weapon').textContent.trim() });`);

console.log('--- busted flow');
await run('busted', `
  g.police.setStars(2); g.busted(); const m1 = g.mode;
  const overlay = document.querySelector('#overlay.show')?.textContent.includes('BUSTED');
  g.respawn();
  return JSON.stringify({ modeAfterBusted: m1, overlayShowsBusted: overlay, modeAfterRespawn: g.mode, cash: g.cash });`);

console.log('--- wasted flow');
await run('wasted', `
  g.player.health = 0; g.tick(1/60); const m = g.mode;
  const overlay = document.querySelector('#overlay.show')?.textContent.includes('WASTED');
  g.respawn();
  return JSON.stringify({ mode: m, overlayShowsWasted: overlay, modeAfter: g.mode, hp: g.player.health });`);

console.log('--- mission 3: pick up the case, deliver it');
await run('m3', `
  g.missions.start(2);
  const name = g.missions.current.name;
  const px = g.player.pos.x, pz = g.player.pos.z;
  g.missions.setMarker(px, pz);
  if (g.missions.packageMesh) g.missions.packageMesh.position.set(px, 0.9, pz);
  for (let i = 0; i < 6; i++) g.tick(1/60);
  const picked = g.missions.picked;
  const newMarker = { ...g.missions.marker };
  g.vehicles.spawn('sedan', 0x2e6fa8, newMarker.x, newMarker.z, 0, 'tmp');
  const car = g.vehicles.cars[g.vehicles.cars.length - 1];
  g.player.inCar = car; car.driver = 'player'; g.player.hide();
  g.player.pos.set(newMarker.x, 0, newMarker.z);
  for (let i = 0; i < 12; i++) g.tick(1/60);
  return JSON.stringify({ name, picked, step: g.missions.step, state: g.missions.state, cash: g.cash });`);

console.log('--- mission 4: steal a sports car, shake the tail, reach the hideout');
await run('m4', `
  g.player.inCar = null; g.player.show();
  g.missions.start(3);
  const name = g.missions.current.name;
  const sc = g.vehicles.spawn('sports', 0x8f2f4a, g.player.pos.x + 3, g.player.pos.z, 0, 'tmp2');
  g.player.inCar = sc; sc.driver = 'player'; g.player.hide();
  g.player.pos.set(sc.pos.x, 0, sc.pos.z);
  for (let i = 0; i < 5; i++) g.tick(1/60);
  const step1 = g.missions.step;
  g.police.setStars(3);
  const starsNow = g.police.stars;
  return JSON.stringify({ name, stepAfterSteal: step1, starsNow });`);

console.log('--- shake the tail: stars decay to zero with no police near');
await run('shake', `
  g.police.clear();
  g.police.setStars(1);
  let ticks = 0;
  while (g.police.stars > 0 && ticks < 60 * 60) { g.tick(1/60); ticks++; }
  return JSON.stringify({ stars: g.police.stars, ticks, step: g.missions.step, secs: +(ticks/60).toFixed(1) });`);

console.log('--- reach the hideout to finish job four');
await run('finish', `
  const m = g.missions.marker;
  g.player.pos.set(m.x, 0, m.z);
  if (g.player.inCar) { g.player.inCar.pos.set(m.x, 0, m.z); }
  for (let i = 0; i < 8; i++) g.tick(1/60);
  return JSON.stringify({ state: g.missions.state, index: g.missions.index, cash: g.cash, banner: g.missions.banner?.text ?? null, obj: g.missions.objectiveText() });`);

const errors = events.filter((e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded')
  .map((e) => e.method === 'Runtime.exceptionThrown'
    ? 'EXCEPTION ' + (e.params.exceptionDetails?.exception?.description ?? e.params.exceptionDetails?.text)
    : `${e.params.entry.level}: ${e.params.entry.text}`)
  .filter((t) => !t.includes('favicon'));
console.log('--- console problems:', errors.length ? errors : 'none');

const final = await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 }, s);
writeFileSync('/tmp/playtest-final.jpg', Buffer.from(final.result.data, 'base64'));
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

// Composition check: projects the objects that must be visible in a screenshot to screen
// space, plus the DOM boxes of the HUD, so framing can be verified without eyeballing.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const [, , url, wIn = '1280', hIn = '720'] = process.argv;
const width = Number(wIn);
const height = Number(hIn);
const profile = mkdtempSync(join(tmpdir(), 'mfcomp-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  `--window-size=${width},${height}`, `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = '';
chrome.stderr.on('data', (d) => { stderr += d; });
const wsUrl = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error(stderr.slice(-600))), 15000);
  chrome.stderr.on('data', () => { const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); res(m[1]); } });
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}, sessionId) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params, sessionId })); });
const { result: ti } = await send('Target.createTarget', { url: 'about:blank' });
const at = await send('Target.attachToTarget', { targetId: ti.targetId, flatten: true });
const s = at.result.sessionId;
await send('Runtime.enable', {}, s);
await send('Page.enable', {}, s);
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, s);
await send('Page.navigate', { url }, s);
await new Promise((r) => setTimeout(r, 4200));

const script = `(() => {
  const g = window.__game;
  const THREE = g.scene.constructor;
  const cam = g.camera;
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const V = cam.position.constructor;
  const project = (obj) => {
    const v = new V(obj.x, obj.y ?? 1, obj.z);
    v.project(cam);
    return {
      x: Math.round((v.x * 0.5 + 0.5) * innerWidth),
      y: Math.round((-v.y * 0.5 + 0.5) * innerHeight),
      inFront: v.z > -1 && v.z < 1,
      inFrame: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z > -1 && v.z < 1,
    };
  };
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  };
  const out = { size: [innerWidth, innerHeight], cam: [cam.position.x, cam.position.y, cam.position.z].map(Math.round) };
  const hero = g.player.inCar;
  out.hero = hero ? project(hero.pos) : project({ x: g.player.pos.x, y: 1, z: g.player.pos.z });
  out.heroType = hero ? hero.type : 'onfoot';
  out.beacon = g.missions.marker ? project({ x: g.missions.marker.x, y: 3, z: g.missions.marker.z }) : null;
  out.police = g.police.units.map((u) => project(u.car.pos));
  const peds = g.traffic.peds.filter((p) => p.alive).map((p) => project({ x: p.pos.x, y: 1, z: p.pos.z })).filter((p) => p.inFrame);
  out.pedsInFrame = peds.length;
  out.carsInFrame = g.vehicles.cars.filter((c) => project(c.pos).inFrame).length;
  out.hud = {
    health: box('#health-wrap'), cash: box('#cash-row'), stars: box('#stars'),
    objective: box('#objective'), minimap: box('#map-wrap'), speedo: box('#speedo'),
    weapon: box('#weapon'), clock: box('#clock'), prompt: box('#prompt'), banner: box('#banner'),
  };
  out.stars = g.police.stars;
  out.overlay = !!document.querySelector('#overlay.show');
  out.ready = window.__shotReady === true;
  out.fps = g.__fps ?? null;
  return JSON.stringify(out);
})()`;
const r = await send('Runtime.evaluate', { expression: script, returnByValue: true }, s);
console.log(JSON.stringify(JSON.parse(r.result.result.value), null, 1));
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

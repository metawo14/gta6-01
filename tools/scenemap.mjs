// Scene diagram: projects the world's objects to screen space and prints a labelled ASCII
// map, so framing can be judged without looking at the image.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const [, , url, colsIn = '100', wIn = '1280', hIn = '720'] = process.argv;
const cols = Number(colsIn);
const width = Number(wIn);
const height = Number(hIn);
const profile = mkdtempSync(join(tmpdir(), 'mfmap-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
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

const expr = `(() => {
  const g = window.__game; const cam = g.camera;
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const V = cam.position.constructor;
  const rows = 26, cols = ${cols};
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(' '));
  const put = (x, y, z, ch, force) => {
    const v = new V(x, y, z); v.project(cam);
    if (Math.abs(v.x) >= 1 || Math.abs(v.y) >= 1 || v.z <= -1 || v.z >= 1) return false;
    const cx = Math.floor((v.x * 0.5 + 0.5) * cols);
    const cy = Math.floor((-v.y * 0.5 + 0.5) * rows);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    if (force || grid[cy][cx] === ' ') grid[cy][cx] = ch;
    return true;
  };
  // Buildings as silhouette blocks (approx by their height at ground).
  const tall = g.world.buildings.filter(b => b.height > 30);
  for (const b of tall) {
    const mx = (b.min.x + b.max.x) / 2, mz = (b.min.z + b.max.z) / 2;
    for (let hh = 0; hh < b.height; hh += 8) put(mx, hh, mz, '#');
  }
  for (const c of g.vehicles.cars) {
    if (c.driver === 'police') continue;
    put(c.pos.x, 0.9, c.pos.z, c === g.player.inCar ? 'H' : 'c');
  }
  for (const p of g.police.units) put(p.car.pos.x, 1.0, p.car.pos.z, 'P', true);
  if (!g.player.inCar) put(g.player.pos.x, 1.0, g.player.pos.z, 'H', true);
  for (const p of g.traffic.peds) if (p.alive) put(p.pos.x, 0.9, p.pos.z, '.');
  if (g.missions.marker) {
    put(g.missions.marker.x, 1.5, g.missions.marker.z, 'W', true);
    put(g.missions.marker.x, 7, g.missions.marker.z, 'B', true);
  }
  const lines = grid.map((r) => r.join(''));
  return lines.join('\\n');
})()`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, s);
console.log(r.result.result.value);
console.log('legend: H hero  P police  c car  . ped  W waypoint  B beacon  # tall building');
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

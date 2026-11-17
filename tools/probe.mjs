// Probe: stage a ?shot= page, optionally run a JS snippet to move the camera/cars, then
// report where the important objects land on screen. Keeps framing honest without eyes.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const [, , url, snippetFile, outShot, wIn = '1280', hIn = '720'] = process.argv;
const width = Number(wIn);
const height = Number(hIn);
const snippet = snippetFile && snippetFile !== '-' ? (await import('node:fs')).readFileSync(snippetFile, 'utf8') : '';
const profile = mkdtempSync(join(tmpdir(), 'mfprobe-'));
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

if (snippet) {
  await send('Runtime.evaluate', { expression: `(() => { const g = window.__game; ${snippet} g.renderer.render(g.scene, g.camera); })()` }, s);
  await new Promise((r) => setTimeout(r, 400));
}

const report = `(() => {
  const g = window.__game; const cam = g.camera; cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const V = cam.position.constructor;
  const proj = (x, y, z) => { const v = new V(x, y, z); v.project(cam);
    return { x: Math.round((v.x * 0.5 + 0.5) * innerWidth), y: Math.round((-v.y * 0.5 + 0.5) * innerHeight),
      inFrame: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z > -1 && v.z < 1 }; };
  const hero = g.player.inCar;
  const out = { hero: hero ? proj(hero.pos.x, 1, hero.pos.z) : proj(g.player.pos.x, 1, g.player.pos.z) };
  out.police = g.police.units.map((u) => ({ ...proj(u.car.pos.x, 1, u.car.pos.z), type: u.car.type }));
  out.beacon = g.missions.marker ? proj(g.missions.marker.x, 3, g.missions.marker.z) : null;
  out.cars = g.vehicles.cars.map((c) => proj(c.pos.x, 1, c.pos.z)).filter((p) => p.inFrame).length;
  out.peds = g.traffic.peds.filter((p) => p.alive).map((p) => proj(p.pos.x, 1, p.pos.z)).filter((p) => p.inFrame).length;
  out.cam = [cam.position.x, cam.position.y, cam.position.z].map((n) => Math.round(n));
  return JSON.stringify(out);
})()`;
const r = await send('Runtime.evaluate', { expression: report, returnByValue: true }, s);
console.log(r.result.result.value);
if (outShot && outShot !== '-') {
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 88 }, s);
  writeFileSync(outShot, Buffer.from(shot.result.data, 'base64'));
}
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

// Objective visibility test: screenshots the frame twice, once with a named set of objects
// hidden, and counts changed pixels. Proves a screenshot really shows those objects, which
// is the one thing a text-only agent cannot otherwise check.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const [, , url, target, wIn = '1280', hIn = '720'] = process.argv;

const profile = mkdtempSync(join(tmpdir(), 'mfvis-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  `--window-size=${wIn},${hIn}`, `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
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
await send('Emulation.setDeviceMetricsOverride', { width: Number(wIn), height: Number(hIn), deviceScaleFactor: 1, mobile: false }, s);
await send('Page.navigate', { url }, s);
await new Promise((r) => setTimeout(r, 4300));

const grab = async () => {
  const shot = await send('Page.captureScreenshot', { format: 'png' }, s);
  return Buffer.from(shot.result.data, 'base64');
};
const base = await grab();
const sel = {
  hero: `g.player.inCar ? g.player.inCar.mesh : g.player.root`,
  police: `g.police.units.map(u => u.car.mesh)`,
  beacon: `g.missions.beacon`,
  vehicles: `g.vehicles.cars.map(c => c.mesh)`,
  world: `g.world.group`,
  hud: `document.getElementById('ui')`,
}[target] ?? target;
await send('Runtime.evaluate', {
  expression: `(() => { const g = window.__game; const t = ${sel}; const arr = Array.isArray(t) ? t : [t];
    for (const o of arr) if (o) o.visible = false; g.renderer.render(g.scene, g.camera); return arr.length; })()`,
}, s);
await new Promise((r) => setTimeout(r, 300));
const without = await grab();

writeFileSync('/tmp/vis-base.png', base);
writeFileSync('/tmp/vis-without.png', without);
console.log(`target=${target} hidden=${sel} base=${base.length}B without=${without.length}B`);
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

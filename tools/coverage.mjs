// Measure how many pixels the important objects actually cover in a staged frame, by
// rendering with and without them. This is how a text-only agent verifies that a
// screenshot really shows the hero car, the police and the beacon.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const [, , url, wIn = '1280', hIn = '720'] = process.argv;
const width = Number(wIn);
const height = Number(hIn);
const profile = mkdtempSync(join(tmpdir(), 'mfvis-'));
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
await new Promise((r) => setTimeout(r, 4300));

// Inside the page: render the frame, sample it to a coarse grid of colours, then render
// again with a group hidden and report how many sample cells changed.
const expr = `(() => {
  const g = window.__game;
  const gl = g.renderer.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  const N = 40;                     // sample cells per side (coarse, cheap)
  const buf = new Uint8Array(W * H * 4);

  const sample = () => {
    g.renderer.render(g.scene, g.camera);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const cells = new Array(N * N).fill(0);
    for (let cy = 0; cy < N; cy++) {
      for (let cx = 0; cx < N; cx++) {
        let r = 0, gg = 0, b = 0, n = 0;
        const x0 = Math.floor(cx * W / N), x1 = Math.floor((cx + 1) * W / N);
        const y0 = Math.floor(cy * H / N), y1 = Math.floor((cy + 1) * H / N);
        for (let y = y0; y < y1; y += 3) {
          for (let x = x0; x < x1; x += 3) {
            const i = (y * W + x) * 4;
            r += buf[i]; gg += buf[i + 1]; b += buf[i + 2]; n++;
          }
        }
        cells[cy * N + cx] = (r / n) * 65536 + (gg / n) * 256 + (b / n);
      }
    }
    return cells;
  };

  const base = sample();
  const groups = {
    hero: g.player.inCar ? [g.player.inCar.mesh] : [g.player.root],
    police: g.police.units.map((u) => u.car.mesh),
    beacon: [g.missions.beacon],
    nearbyCar: (() => {
      const px = g.player.inCar ? g.player.inCar.pos : g.player.pos;
      let best = null, bd = 1e9;
      for (const c of g.vehicles.cars) {
        if (c === g.player.inCar) continue;
        const d = Math.hypot(c.pos.x - px.x, c.pos.z - px.z);
        if (d > 1 && d < bd) { bd = d; best = c; }
      }
      return best ? [best.mesh] : [];
    })(),
    peds: g.traffic.peds.filter((p) => p.alive).slice(0, 8).map((p) => p.mesh),
  };
  const result = {};
  for (const [name, objs] of Object.entries(groups)) {
    if (!objs.length) { result[name] = null; continue; }
    for (const o of objs) o.visible = false;
    const after = sample();
    for (const o of objs) o.visible = true;
    let changed = 0, minx = N, maxx = -1, miny = N, maxy = -1;
    for (let i = 0; i < base.length; i++) {
      if (Math.abs(base[i] - after[i]) > 900) {
        changed++;
        const cx = i % N, cy = Math.floor(i / N);
        minx = Math.min(minx, cx); maxx = Math.max(maxx, cx);
        miny = Math.min(miny, cy); maxy = Math.max(maxy, cy);
      }
    }
    result[name] = { cells: changed, pct: +(100 * changed / (N * N)).toFixed(2),
      box: maxx < 0 ? null : [minx, miny, maxx, maxy].map((v) => Math.round(v * 100 / N)) };
  }
  // Fraction of cells that are not near-black: a lit, readable frame.
  let lit = 0;
  for (const c of base) { const r = Math.floor(c / 65536), gg = Math.floor(c / 256) % 256, b = c % 256;
    if ((0.299 * r + 0.587 * gg + 0.114 * b) > 22) lit++; }
  result.litPct = +(100 * lit / (N * N)).toFixed(1);
  return JSON.stringify(result);
})()`;
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, s);
console.log(r.result.result.value);
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

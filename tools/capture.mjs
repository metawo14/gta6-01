// Headless capture + console check. Usage: node capture.mjs <page> <outfile> [w] [h] [wait]
// Uses the Playwright chromium binary directly with the DevTools protocol, no packages.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = `${process.env.HOME}/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`;
const [, , url, out, wIn = '1280', hIn = '800', waitIn = '6000'] = process.argv;
const width = Number(wIn);
const height = Number(hIn);
const waitMs = Number(waitIn);

const profile = mkdtempSync(join(tmpdir(), 'mfshot-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion', '--disable-background-timer-throttling',
  '--allow-file-access-from-files',
  `--window-size=${width},${height}`,
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

let stderr = '';
chrome.stderr.on('data', (d) => { stderr += d.toString(); });
const wsUrl = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('no devtools ws: ' + stderr.slice(-800))), 15000);
  chrome.stderr.on('data', () => {
    const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) { clearTimeout(t); resolve(m[1]); }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  else if (msg.method) events.push(msg);
});
function send(method, params = {}, sessionId) {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
  return new Promise((res) => pending.set(mid, res));
}

const { result: targetInfo } = await send('Target.createTarget', { url: 'about:blank' });
const attach = await send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: true });
const session = attach.result.sessionId;

await send('Page.enable', {}, session);
await send('Runtime.enable', {}, session);
await send('Log.enable', {}, session);
await send('Network.enable', {}, session);
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
await send('Page.navigate', { url }, session);

const started = Date.now();
let shotTaken = false;
while (Date.now() - started < waitMs + 12000) {
  await new Promise((r) => setTimeout(r, 350));
  const ready = await send('Runtime.evaluate', { expression: 'window.__shotReady === true || !!document.querySelector("#overlay.show")', returnByValue: true }, session);
  const elapsed = Date.now() - started;
  if (ready.result?.result?.value && elapsed > 1800 && !shotTaken) {
    await new Promise((r) => setTimeout(r, 900));
    shotTaken = true;
    break;
  }
}
const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90, captureBeyondViewport: false }, session);
if (shot.result?.data) writeFileSync(out, Buffer.from(shot.result.data, 'base64'));

const logs = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ errors: window.__errors || [], ready: window.__shotReady === true, title: document.title, cars: window.__game?.vehicles?.cars?.length ?? -1, buildings: window.__game?.world?.buildings?.length ?? -1, stars: window.__game?.police?.stars ?? -1 })`,
  returnByValue: true,
}, session);
const consoleMsgs = events
  .filter((e) => e.method === 'Runtime.consoleAPICalled' || e.method === 'Log.entryAdded' || e.method === 'Runtime.exceptionThrown')
  .map((e) => {
    if (e.method === 'Runtime.exceptionThrown') return 'EXCEPTION ' + (e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text);
    if (e.method === 'Log.entryAdded') return `LOG ${e.params.entry.level}: ${e.params.entry.text} ${e.params.entry.url ?? ''}`;
    return `CONSOLE ${e.params.type}: ` + e.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
  });
const requests = events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url);
console.log(JSON.stringify({ page: logs.result?.result?.value, consoleMsgs, requests: [...new Set(requests)], bytes: shot.result?.data?.length }, null, 2));
ws.close();
chrome.kill('SIGKILL');
process.exit(0);

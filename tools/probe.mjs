// A small probe: load the page, report console errors, exceptions, and a few counts.
// Usage: node tools/probe.mjs <url> [wait ms]

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  join(homedir(), '.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'),
  join(homedir(), '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'),
  join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell'),
  '/opt/meta-chromium/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

export function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    if (existsSync(path)) return path;
  }
  throw new Error('no Chrome/Chromium binary found; set CHROME_PATH');
}

export async function launch({ headless = true } = {}) {
  const bin = findChrome();
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    '--window-size=1280,800',
    'about:blank',
  ];
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('chrome did not report a devtools endpoint')), 20000);
    const onData = (chunk) => {
      buffer += chunk.toString();
      const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        child.stderr.off('data', onData);
        resolve(match[1]);
      }
    };
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`chrome exited early (${code})`)));
  });
  return { child, wsUrl };
}

export async function connect(wsUrl) {
  const url = new URL(wsUrl);
  let endpoint = wsUrl;
  if (!url.pathname.includes('/devtools/browser/')) {
    const info = await fetch(`http://${url.host}/json/version`).then((r) => r.json());
    endpoint = info.webSocketDebuggerUrl;
  }
  const ws = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const events = [];
  const listeners = [];
  let sessionId = null;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    } else {
      events.push(msg);
      for (const fn of listeners) fn(msg);
    }
  });
  const rawSend = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    const payload = { id: mid, method, params };
    if (session) payload.sessionId = session;
    ws.send(JSON.stringify(payload));
  });

  // A fresh page target, attached with flattening so Page/Runtime events come to this socket.
  const { targetId } = await rawSend('Target.createTarget', { url: 'about:blank' });
  const attached = await rawSend('Target.attachToTarget', { targetId, flatten: true });
  sessionId = attached.sessionId;

  const send = (method, params = {}) => rawSend(method, params, sessionId);
  return { ws, send, events, on: (fn) => listeners.push(fn), targetId, close: () => ws.close() };
}

async function main() {
  const url = process.argv[2];
  const waitMs = Number(process.argv[3] ?? 6000);
  if (!url) {
    console.error('usage: node tools/probe.mjs <url> [wait ms]');
    process.exit(2);
  }
  const { child, wsUrl } = await launch();
  const cdp = await connect(wsUrl);
  const errors = [];
  const logs = [];
  const exceptions = [];

  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push(d.exception?.description ?? d.text ?? 'exception');
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      if (msg.params.type === 'error') errors.push(text);
      else logs.push(`${msg.params.type}: ${text}`);
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') errors.push(`${e.source}: ${e.text}`);
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url });
  await new Promise((r) => setTimeout(r, waitMs));

  const state = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.__game;
      return {
        hasGame: !!g,
        shotReady: !!window.__shotReady,
        mode: g ? g.mode : null,
        cars: g ? g.vehicles.cars.length : 0,
        buildings: g ? g.city.buildings.length : 0,
        peds: g ? g.traffic.peds.length : 0,
        trafficCars: g ? g.trafficManager.cars.length : 0,
        stars: g ? g.police.stars : 0,
        title: document.title,
        overlayShown: !!document.querySelector('#overlay.show, .overlay.show'),
        objective: document.getElementById('objective-text') ? document.getElementById('objective-text').textContent : '',
        clock: document.getElementById('clock') ? document.getElementById('clock').textContent : '',
      };
    })()`,
    returnByValue: true,
  });

  console.log(JSON.stringify({
    state: state.result.value,
    exceptions,
    errors,
    logs: logs.slice(-8),
  }, null, 2));

  cdp.close();
  child.kill('SIGKILL');
  process.exit(exceptions.length || errors.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('probe failed:', err);
    process.exit(1);
  });
}

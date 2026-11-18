// Capture a page as a JPEG through Chrome's DevTools protocol.
// Launches the Playwright Chromium binary headless, opens the page at 1280x800, waits until
// window.__shotReady is true (or a menu overlay shows), waits a beat, captures a JPEG at
// quality 90, and prints the page state, console messages, network requests and the byte size.
//
// Usage: node capture.mjs <page> <outfile> [width] [height] [wait ms]

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  join(homedir(), '.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'),
  join(homedir(), '.cache/ms-playwright/chromium-1255/chrome-linux64/chrome'),
  join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell'),
  '/opt/meta-chromium/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    if (existsSync(path)) return path;
  }
  throw new Error('no Chrome/Chromium binary found; set CHROME_PATH');
}

async function launchChrome(width, height) {
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
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error('chrome did not report a devtools endpoint')), 25000);
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

async function connect(wsUrl) {
  const url = new URL(wsUrl);
  const info = await fetch(`http://${url.host}/json/version`).then((r) => r.json());
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const listeners = [];
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
      for (const fn of listeners) fn(msg);
    }
  });
  const rawSend = (method, params = {}, session = null) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    const payload = { id: mid, method, params };
    if (session) payload.sessionId = session;
    ws.send(JSON.stringify(payload));
  });
  const { targetId } = await rawSend('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await rawSend('Target.attachToTarget', { targetId, flatten: true });
  return {
    ws,
    targetId,
    sessionId,
    send: (method, params = {}) => rawSend(method, params, sessionId),
    on: (fn) => listeners.push(fn),
    close: () => ws.close(),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [, , page, outfile, wArg, hArg, waitArg] = process.argv;
  if (!page || !outfile) {
    console.error('usage: node capture.mjs <page> <outfile> [width] [height] [wait ms]');
    process.exit(2);
  }
  const width = Number(wArg ?? 1280);
  const height = Number(hArg ?? 800);
  const extraWait = Number(waitArg ?? 1200);

  const { child, wsUrl } = await launchChrome(width, height);
  const cdp = await connect(wsUrl);

  const consoleMsgs = [];
  const exceptions = [];
  const errors = [];
  const requests = [];

  cdp.on((msg) => {
    switch (msg.method) {
      case 'Runtime.exceptionThrown': {
        const d = msg.params.exceptionDetails;
        exceptions.push(d.exception?.description ?? d.text ?? 'exception');
        break;
      }
      case 'Runtime.consoleAPICalled': {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
        if (msg.params.type === 'error') errors.push(text);
        consoleMsgs.push(`${msg.params.type}: ${text}`);
        break;
      }
      case 'Log.entryAdded': {
        const e = msg.params.entry;
        if (e.level === 'error') errors.push(`${e.source}: ${e.text}`);
        consoleMsgs.push(`${e.level}: ${e.text}`);
        break;
      }
      case 'Network.requestWillBeSent': {
        requests.push(msg.params.request.url);
        break;
      }
      default:
        break;
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Page.navigate', { url: page });

  // Wait for the staged frame flag, or for a menu overlay (the title screen).
  const deadline = Date.now() + 40000;
  let ready = false;
  let overlay = false;
  while (Date.now() < deadline) {
    await sleep(280);
    const probe = await cdp.send('Runtime.evaluate', {
      expression: `({ ready: !!window.__shotReady, overlay: !!document.querySelector('.overlay.show'), hasGame: !!window.__game })`,
      returnByValue: true,
    });
    const v = probe.result.value ?? {};
    ready = Boolean(v.ready);
    overlay = Boolean(v.overlay);
    if (ready || (overlay && v.hasGame)) break;
  }
  await sleep(extraWait);

  // Collect the page state the spec asks for.
  const state = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.__game;
      return {
        errors: (window.__pageErrors || []),
        ready: !!window.__shotReady,
        title: document.title,
        mode: g ? g.mode : null,
        cars: g ? g.vehicles.cars.length : 0,
        buildings: g ? g.city.buildings.length : 0,
        peds: g ? g.traffic.peds.length : 0,
        stars: g ? g.police.stars : 0,
        cash: g ? g.cash : 0,
        clock: g ? (() => {
          const m = ((g.clockMinutes % 1440) + 1440) % 1440;
          return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0');
        })() : '',
        objective: document.getElementById('objective-text') ? document.getElementById('objective-text').textContent : '',
        overlay: !!document.querySelector('.overlay.show'),
      };
    })()`,
    returnByValue: true,
  });

  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 90,
    captureBeyondViewport: false,
  });
  const bytes = Buffer.from(shot.data, 'base64');
  mkdirSync(dirname(outfile), { recursive: true });
  writeFileSync(outfile, bytes);

  console.log('page state:', JSON.stringify(state.result.value, null, 2));
  if (consoleMsgs.length) {
    console.log('console:');
    for (const line of consoleMsgs.slice(0, 40)) console.log('  ' + line);
  }
  if (exceptions.length) {
    console.log('exceptions:');
    for (const line of exceptions) console.log('  ' + line);
  }
  const uniqueRequests = [...new Set(requests)];
  console.log(`network: ${uniqueRequests.length} request(s)`);
  for (const line of uniqueRequests.slice(0, 30)) console.log('  ' + line);
  console.log(`screenshot: ${outfile} — ${bytes.length} bytes (${(bytes.length / 1024).toFixed(1)} KiB)`);

  cdp.close();
  child.kill('SIGKILL');
  if (exceptions.length) process.exit(3);
  if (errors.length) process.exit(4);
  if (bytes.length === 0) process.exit(5);
  if (!ready && !overlay) process.exit(6);
}

main().catch((err) => {
  console.error('capture failed:', err);
  process.exit(1);
});

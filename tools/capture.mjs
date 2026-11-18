// capture.mjs — screenshot a page with the Playwright Chromium binary over the DevTools
// protocol. No npm dependencies: it drives the browser with its own tiny CDP client over
// Node's built-in WebSocket.
//
//   node tools/capture.mjs <page-url> <outfile.jpg> [width] [height] [wait ms]

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  join(process.env.HOME || '/root', '.cache/ms-playwright/chromium-1254/chrome-linux64/chrome'),
  join(process.env.HOME || '/root', '.cache/ms-playwright/chromium-1194/chrome-linux64/chrome'),
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  for (const c of CANDIDATES) {
    try {
      if (existsSync(c)) return c;
    } catch {
      /* keep looking */
    }
  }
  throw new Error('no Chromium binary found; set CHROME_PATH');
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }
}

export async function launch({ width = 1280, height = 800 } = {}) {
  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'pm-chrome-'));
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--hide-scrollbars',
    '--mute-audio',
    '--enable-unsafe-swiftshader',
    '--use-gl=swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate,BackForwardCache',
    `--window-size=${width},${height}`,
    'about:blank',
  ];
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => {
    stderr += d.toString();
  });

  const wsUrl = await new Promise((resolve, reject) => {
    const deadline = Date.now() + 25000;
    const tick = () => {
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        resolve(m[1]);
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`chrome did not report a DevTools endpoint\n${stderr.slice(-1500)}`));
        return;
      }
      setTimeout(tick, 60);
    };
    tick();
  });

  const base = wsUrl.replace(/^ws:\/\//, 'http://').replace(/\/devtools\/browser\/.*$/, '');
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket to the browser failed')), { once: true });
  });
  const cdp = new CDP(ws);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);

  const page = {
    cdp,
    sessionId,
    width,
    height,
    async goto(url) {
      await cdp.send('Page.navigate', { url }, sessionId);
    },
    async evaluate(expression) {
      const res = await cdp.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true, allowUnsafeEval: true },
        sessionId,
      );
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        throw new Error(d.exception?.description || d.text || 'evaluate failed');
      }
      return res.result ? res.result.value : undefined;
    },
    async waitFor(expression, timeout = 30000, poll = 120) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        try {
          const v = await page.evaluate(expression);
          if (v) return v;
        } catch {
          /* the page may still be booting */
        }
        await new Promise((r) => setTimeout(r, poll));
      }
      return null;
    },
    async screenshot(path, quality = 90) {
      const res = await cdp.send(
        'Page.captureScreenshot',
        { format: 'jpeg', quality, captureBeyondViewport: false, fromSurface: true },
        sessionId,
      );
      writeFileSync(path, Buffer.from(res.data, 'base64'));
      return readFileSync(path).length;
    },
    async close() {
      try {
        await cdp.send('Browser.close');
      } catch {
        /* the browser may already be gone */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      proc.kill('SIGKILL');
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* the profile may be held; the kernel cleans /tmp */
      }
    },
    base,
  };
  return page;
}

export function collectDiagnostics(events) {
  const console_ = [];
  const exceptions = [];
  const requests = [];
  for (const ev of events) {
    if (ev.method === 'Runtime.consoleAPICalled') {
      const type = ev.params.type;
      const text = ev.params.args
        .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
        .join(' ');
      console_.push({ type, text });
    } else if (ev.method === 'Runtime.exceptionThrown') {
      const d = ev.params.exceptionDetails;
      exceptions.push(d.exception?.description || d.text || 'exception');
    } else if (ev.method === 'Log.entryAdded') {
      const e = ev.params.entry;
      console_.push({ type: e.level, text: e.text, url: e.url });
    } else if (ev.method === 'Network.requestWillBeSent') {
      requests.push(ev.params.request.url);
    }
  }
  return { consoleMessages: console_, exceptions, requests };
}

const isMain = process.argv[1] && process.argv[1].endsWith('capture.mjs');

if (isMain) {
  const [url, outfile, w, h, waitRaw] = process.argv.slice(2);
  if (!url || !outfile) {
    console.error('usage: node capture.mjs <page> <outfile> [width] [height] [wait ms]');
    process.exit(2);
  }
  const width = parseInt(w || '1280', 10);
  const height = parseInt(h || '800', 10);
  const waitMs = parseInt(waitRaw || '1600', 10);

  const page = await launch({ width, height });
  try {
    await page.goto(url);
    // a staged shot sets __shotReady; the title screen shows an overlay. Wait for whichever
    // this URL is meant to produce, rather than for either.
    const staged = /[?&]shot=/.test(url);
    const ready = await page.waitFor(
      staged
        ? 'window.__shotReady === true || !!window.__shotError'
        : 'window.__shotReady === true || document.querySelector("#overlay.show") !== null',
      60000,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    const size = await page.screenshot(outfile, 90);
    const state = await page.evaluate(`(() => {
      const g = window.__game;
      return {
        ready: !!window.__shotReady,
        readyFlag: window.__ready === true,
        shotError: window.__shotError || null,
        title: document.title,
        mode: g ? g.mode : null,
        cars: g ? g.cars.cars.length : null,
        buildings: g ? g.world.buildings.length : null,
        stars: g ? g.police.stars : null,
        peds: g ? g.traffic.peds.length : null,
        overlay: !!document.querySelector('#overlay.show'),
        shots: !!window.__game && !!window.__game.shot,
      };
    })()`);
    const diag = collectDiagnostics(page.cdp.drainEvents());
    console.log(JSON.stringify({ page: state, ready, screenshot: { file: outfile, bytes: size }, ...diag }, null, 2));
  } catch (err) {
    console.error('capture failed:', err.message);
    process.exitCode = 1;
  } finally {
    await page.close();
  }
}

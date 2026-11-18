// Port Meridian — the headless playtest.
//
// Drives the real game, not a model of it. Every key press and click goes through the game's
// own `input.override` channel, the same one the browser keyboard and the screenshot staging
// write into, and the game's own loop, physics, missions, police, audio bookkeeping and HUD do
// all the work. Fourteen labelled steps run from the title screen through every job, combat,
// saving, the busted and wasted flows and a successful shake of a police tail.
//
// There is no rendering in the timed steps. Headless Chromium draws WebGL in software at about
// five frames a second, which makes wall-clock-driven tests slow and flaky; instead the harness
// steps `game.frame(1/60)` in a tight loop, which is the same code the requestAnimationFrame
// loop calls. Rendering and the minimap are switched back on for the final frame.
//
// Usage: node tools/playtest.mjs [url]
//   Defaults to http://127.0.0.1:8080/, and starts serve.ts itself if nothing is listening.
//   Exit code 0 only when all fourteen steps pass with no console exceptions or errors.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, launch } from './probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DEFAULT_URL = 'http://127.0.0.1:8080/';
const FRAME_OUT = join(ROOT, 'out', 'playtest-final.jpg');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// The page-side harness: a deterministic stepper plus a grid driver.
// Installed once into the page; every helper below calls into it.
// ---------------------------------------------------------------------------

const HARNESS = String.raw`
(() => {
  const g = window.__game;
  if (!g) return { ok: false, why: 'no window.__game' };
  if (g.__pt) return { ok: true, reinstall: true };

  // ---- deterministic stepping -------------------------------------------------
  // Stop the rAF loop from double-stepping, then keep the real frame function as the
  // single source of truth for a step.
  g.running = false;
  const render = g.renderer.render.bind(g.renderer);
  const drawMap = g.hud._drawMinimap.bind(g.hud);
  g.__resumeRender = () => { g.renderer.render = render; g.hud._drawMinimap = drawMap; };
  g.renderer.render = () => {};
  g.hud._drawMinimap = () => {};

  // ---- the road grid ----------------------------------------------------------
  const GRID = [];
  for (let i = 0; i <= 12; i++) GRID.push((i - 6) * 64);
  const MAX_X = 320;                       // the sea edge is at 330

  const COMBOS = [
    [0, -1, ['KeyW']], [0, 1, ['KeyS']], [-1, 0, ['KeyA']], [1, 0, ['KeyD']],
    [-1, -1, ['KeyW', 'KeyA']], [1, -1, ['KeyW', 'KeyD']],
    [-1, 1, ['KeyS', 'KeyA']], [1, 1, ['KeyS', 'KeyD']],
  ];

  const pt = {
    mode: 'idle', target: null, tol: 3, path: [], index: 0, arrived: true,
    reason: '', stuck: 0, reverse: 0, reverseSteer: 'KeyA', steerKey: null,
    lastX: 0, lastZ: 0, dist: Infinity, maxSpeed: 0, keys: [], frames: 0,
    detour: null, maxFrames: 0,
  };

  function clearKeys() {
    for (const k of pt.keys) g.input.override.keys.delete(k);
    pt.keys = [];
  }
  function setKeys(list) {
    for (const k of pt.keys) if (!list.includes(k)) g.input.override.keys.delete(k);
    for (const k of list) g.input.override.keys.add(k);
    pt.keys = list.slice();
  }

  // A* over the road grid. Roads are clear of buildings by construction, so a node-to-node
  // leg is drivable; the final straight leg to the exact target is where tolerance matters.
  function nearestNode(x, z) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < GRID.length; i++) {
      if (GRID[i] > MAX_X) continue;
      for (let j = 0; j < GRID.length; j++) {
        const d = Math.hypot(GRID[i] - x, GRID[j] - z);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    return [bi, bj];
  }

  function astar(a, b) {
    const W = GRID.length;
    const key = (i, j) => i * W + j;
    const open = [{ i: a[0], j: a[1], g: 0, f: 0 }];
    const best = new Map([[key(a[0], a[1]), 0]]);
    const came = new Map();
    const closed = new Set();
    while (open.length) {
      open.sort((p, q) => p.f - q.f);
      const cur = open.shift();
      const ck = key(cur.i, cur.j);
      if (closed.has(ck)) continue;
      closed.add(ck);
      if (cur.i === b[0] && cur.j === b[1]) {
        const out = [];
        let k = ck;
        let guard = 0;
        while (k !== undefined && guard++ < 400) {
          out.push([Math.floor(k / W), k % W]);
          k = came.get(k);
        }
        return out.reverse();
      }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = cur.i + di;
        const nj = cur.j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
        if (GRID[ni] > MAX_X) continue;
        const nk = key(ni, nj);
        if (closed.has(nk)) continue;
        const cost = cur.g + 64;
        if (best.has(nk) && best.get(nk) <= cost) continue;
        best.set(nk, cost);
        came.set(nk, ck);
        const h = (Math.abs(ni - b[0]) + Math.abs(nj - b[1])) * 64;
        open.push({ i: ni, j: nj, g: cost, f: cost + h });
      }
    }
    return [];
  }

  function plan(tx, tz) {
    const from = g.playerCar || g.player;
    const a = nearestNode(from.x, from.z);
    const b = nearestNode(tx, tz);
    const nodes = astar(a, b);
    pt.path = nodes.map(([i, j]) => ({ x: GRID[i], z: GRID[j] }));
    pt.path.push({ x: tx, z: tz });
    pt.index = 0;
    while (pt.index < pt.path.length - 1) {
      const wp = pt.path[pt.index];
      if (Math.hypot(wp.x - from.x, wp.z - from.z) < 12) pt.index++;
      else break;
    }
  }

  // Movement on foot is camera-relative, so pick the key combination whose world direction
  // best matches the wanted direction. This is exactly what a player pressing W does.
  function footKeys(dx, dz) {
    const yaw = g.camera.yaw;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    let best = null;
    let bestDot = -2;
    for (const [ax, az, keys] of COMBOS) {
      const mx = ax * cos + az * sin;
      const mz = -ax * sin + az * cos;
      const len = Math.hypot(mx, mz) || 1;
      const dot = (mx / len) * dx + (mz / len) * dz;
      if (dot > bestDot) { bestDot = dot; best = keys; }
    }
    return best || [];
  }

  function stepWalk(dt) {
    const p = g.player;
    if (p.hidden || g.playerCar) { clearKeys(); pt.arrived = true; pt.reason = 'in a car'; return; }
    let tx = pt.target.x;
    let tz = pt.target.z;
    if (pt.detour) {
      if (g.time < pt.detour.until) { tx = pt.detour.x; tz = pt.detour.z; }
      else pt.detour = null;
    }
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    pt.dist = d;
    if (d <= pt.tol) { clearKeys(); pt.arrived = true; return; }
    setKeys(footKeys(dx / d, dz / d));
    const moved = Math.hypot(p.x - pt.lastX, p.z - pt.lastZ);
    pt.lastX = p.x;
    pt.lastZ = p.z;
    if (moved < 0.02) pt.stuck += dt; else pt.stuck = 0;
    if (pt.stuck > 0.5) {
      // Sidestep around whatever is in the way rather than pushing at it forever.
      pt.stuck = 0;
      const px = -dz / (d || 1);
      const pz = dx / (d || 1);
      const side = Math.floor(g.time * 0.7) % 2 === 0 ? 1 : -1;
      pt.detour = { x: p.x + px * side * 6, z: p.z + pz * side * 6, until: g.time + 1.0 };
    }
  }

  function stepDrive(dt) {
    const car = g.playerCar;
    if (!car) { clearKeys(); pt.arrived = true; pt.reason = 'no car'; return; }
    pt.maxSpeed = Math.max(pt.maxSpeed, Math.abs(car.forwardSpeed));

    while (pt.index < pt.path.length - 1) {
      const wp = pt.path[pt.index];
      if (Math.hypot(wp.x - car.x, wp.z - car.z) < 8) pt.index++;
      else break;
    }
    const wp = pt.path[Math.min(pt.index, pt.path.length - 1)];
    if (!wp) { clearKeys(); pt.arrived = true; return; }
    const dx = wp.x - car.x;
    const dz = wp.z - car.z;
    const d = Math.hypot(dx, dz);
    pt.dist = d;
    const isLast = pt.index >= pt.path.length - 1;
    if (isLast && d <= pt.tol) { clearKeys(); pt.arrived = true; return; }

    if (pt.reverse > 0) {
      pt.reverse -= dt;
      setKeys(['KeyS', pt.reverseSteer]);
      return;
    }

    const desired = Math.atan2(-dx, -dz);
    let diff = desired - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const speed = car.forwardSpeed;
    const absSpeed = Math.abs(speed);

    if (absSpeed < 0.8) pt.stuck += dt; else pt.stuck = Math.max(0, pt.stuck - dt * 1.5);
    if (pt.stuck > 0.9) {
      pt.stuck = 0;
      pt.reverse = 0.8;
      pt.reverseSteer = diff > 0 ? 'KeyD' : 'KeyA';
      setKeys(['KeyS', pt.reverseSteer]);
      return;
    }

    const ad = Math.abs(diff);
    const keys = [];
    if (ad > 2.4 && absSpeed < 4) {
      // Facing the wrong way and nearly stopped: reverse while steering round.
      keys.push('KeyS');
      keys.push(diff > 0 ? 'KeyD' : 'KeyA');
    } else {
      const want = ad > 0.9 ? 6 : ad > 0.35 ? 13 : isLast ? 9 : 21;
      if (speed < want) keys.push('KeyW');
      else if (speed > want + 6) keys.push('KeyS');
      if (diff > 0.09) pt.steerKey = 'KeyA';
      else if (diff < -0.09) pt.steerKey = 'KeyD';
      else if (Math.abs(diff) < 0.04) pt.steerKey = null;
      if (pt.steerKey) keys.push(pt.steerKey);
    }
    setKeys(keys);
  }

  const originalFrame = g.frame.bind(g);
  g.frame = (dt) => {
    if (g.mode === 'play' && pt.mode !== 'idle') {
      pt.frames++;
      if (pt.mode === 'walk') stepWalk(dt);
      else if (pt.mode === 'drive') stepDrive(dt);
    } else if (pt.mode !== 'idle') {
      clearKeys();
    }
    originalFrame(dt);
  };

  // One deterministic tick, the same call the rAF loop makes.
  window.__tick = (n) => {
    const count = n ?? 1;
    for (let i = 0; i < count; i++) g.frame(1 / 60);
  };

  // Run a driver goal to completion or its frame cap. Returns the driver state.
  window.__runGoal = (cap) => {
    const limit = cap ?? 9000;
    for (let i = 0; i < limit; i++) {
      if (pt.arrived) break;
      g.frame(1 / 60);
      pt.maxFrames = i;
    }
    return window.__pt.state();
  };

  window.__pt = {
    begin(mode, x, z, tol) {
      pt.mode = mode;
      pt.target = { x, z };
      pt.tol = tol;
      pt.arrived = false;
      pt.reason = '';
      pt.stuck = 0;
      pt.reverse = 0;
      pt.steerKey = null;
      pt.detour = null;
      pt.maxSpeed = 0;
      pt.frames = 0;
      pt.lastX = g.player.x;
      pt.lastZ = g.player.z;
      if (mode === 'drive') plan(x, z);
    },
    stop() {
      pt.mode = 'idle';
      clearKeys();
      pt.arrived = true;
    },
    tap(code) { g.input.override.pressed.add(code); },
    shoot() { g.input.override.firePressed = true; },
    keys(list) { setKeys(list); },
    clear() { clearKeys(); },
    state() {
      return {
        mode: pt.mode,
        arrived: pt.arrived,
        reason: pt.reason,
        dist: Math.round(pt.dist * 10) / 10,
        maxSpeed: Math.round(pt.maxSpeed * 10) / 10,
        index: pt.index,
        path: pt.path.length,
        frames: pt.frames,
        gameMode: g.mode,
        time: Math.round(g.time * 100) / 100,
      };
    },
  };

  return { ok: true };
})()
`;

// ---------------------------------------------------------------------------
// CDP client
// ---------------------------------------------------------------------------

function makeClient(cdp) {
  return {
    async evaluate(expression) {
      const res = await cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        throw new Error(`page exception: ${d.exception?.description ?? d.text}`);
      }
      return res.result.value;
    },
  };
}

const q = (v) => JSON.stringify(v);

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Playtest
// ---------------------------------------------------------------------------

class Playtest {
  constructor(ev, cdp) {
    this.ev = ev;
    this.cdp = cdp;
    this.steps = [];
    this.failures = [];
  }

  // --- live state ---------------------------------------------------------

  snap() {
    return this.ev(`(() => {
      const g = window.__game;
      const p = g.player;
      const car = g.playerCar;
      const lit = document.querySelectorAll('#stars .star.lit').length;
      return {
        mode: g.mode,
        time: Math.round(g.time * 100) / 100,
        cash: g.cash,
        stars: g.police.stars,
        litStars: lit,
        health: Math.round(p.health),
        px: Math.round(p.x * 10) / 10,
        pz: Math.round(p.z * 10) / 10,
        hidden: p.hidden,
        magazine: p.magazine,
        reserve: p.reserve,
        weapon: p.weapon,
        inCar: !!car,
        carKind: car ? car.kind : null,
        carX: car ? Math.round(car.x * 10) / 10 : null,
        carZ: car ? Math.round(car.z * 10) / 10 : null,
        carSpeed: car ? Math.round(Math.abs(car.forwardSpeed) * 10) / 10 : 0,
        carHealth: car ? Math.round(car.health) : null,
        units: g.police.units.length,
        nearest: Number.isFinite(g.police.nearestDistance) ? Math.round(g.police.nearestDistance) : null,
        idle: Math.round(g.police.idle * 10) / 10,
        bustTimer: Math.round(g.police.bustTimer * 10) / 10,
        job: g.missions.index,
        step: g.missions.step,
        completed: g.missions.completed,
        storyComplete: !!g.storyComplete,
        objective: g.missions.objectiveText,
        jobLabel: g.missions.jobLabel,
        carrying: g.missions.carrying,
        banner: g.missions.bannerTimer > 0 ? g.missions.bannerText : '',
        prompt: g.prompt || '',
        speedo: document.getElementById('speedo').classList.contains('visible'),
        dialogs: {
          title: !!document.querySelector('#overlay.show'),
          pause: !!document.querySelector('#pause-overlay.show'),
          busted: !!document.querySelector('#busted-overlay.show'),
          wasted: !!document.querySelector('#wasted-overlay.show'),
        },
        buildings: g.city.buildings.length,
        cars: g.vehicles.cars.length,
        peds: g.traffic.peds.length,
        traffic: g.trafficManager.cars.length,
        clock: document.getElementById('clock').textContent,
        phase: document.getElementById('phase').textContent,
        ammoText: document.getElementById('weapon-ammo').textContent,
        objectiveJob: document.getElementById('objective-job').textContent,
        objectiveText: document.getElementById('objective-text').textContent,
        save: (() => { try { return localStorage.getItem('port-meridian-save-v1'); } catch (e) { return null; } })(),
      };
    })()`);
  }

  // Advance the game's own clock without any driver input.
  tick(frames = 60) {
    return this.ev(`window.__tick(${frames})`);
  }

  async waitFor(label, predicate, frames = 900, slice = 30) {
    let last = null;
    for (let spent = 0; spent < frames; spent += slice) {
      await this.tick(slice);
      last = await this.snap();
      if (await predicate(last)) return last;
    }
    throw new Error(`${label} — gave up after ${frames} frames; last ${JSON.stringify({
      mode: last?.mode, job: last?.job, step: last?.step, stars: last?.stars,
      px: last?.px, pz: last?.pz, units: last?.units, nearest: last?.nearest, cash: last?.cash,
    })}`);
  }

  // --- movement -----------------------------------------------------------

  async walkTo(x, z, tol = 2.2, cap = 5400) {
    await this.ev(`__pt.begin('walk', ${q(x)}, ${q(z)}, ${q(tol)})`);
    const s = await this.ev(`window.__runGoal(${cap})`);
    if (!s.arrived) {
      await this.ev('__pt.stop()');
      throw new Error(`walk to (${x.toFixed(1)}, ${z.toFixed(1)}) stopped ${s.dist} m short`);
    }
    return s;
  }

  async driveTo(x, z, tol = 9, cap = 9000) {
    await this.ev(`__pt.begin('drive', ${q(x)}, ${q(z)}, ${q(tol)})`);
    return this.ev(`window.__runGoal(${cap})`);
  }

  nearestCar(maxDist = 250) {
    return this.ev(`(() => {
      const g = window.__game;
      const p = g.player;
      const pick = (filter) => {
        let best = null, bd = ${maxDist};
        for (const c of g.vehicles.cars) {
          if (!filter(c)) continue;
          const d = Math.hypot(c.x - p.x, c.z - p.z);
          if (d < bd) { bd = d; best = c; }
        }
        return best ? { x: best.x, z: best.z, kind: best.kind, owned: best.owned, dist: Math.round(bd * 10) / 10 } : null;
      };
      return pick((c) => !c.wrecked && c.owned === 'parked')
        || pick((c) => !c.wrecked && c.owned !== 'police');
    })()`);
  }

  async takeCar(cap = 5400) {
    const s = await this.snap();
    if (s.inCar) return s;
    const car = await this.nearestCar(250);
    assert(car, 'no civilian car in the city to take');
    await this.walkTo(car.x, car.z, 2.8, cap);
    await this.ev(`__pt.tap('KeyE')`);
    await this.tick(3);
    return this.waitFor('entering the car', (v) => v.inCar, 240);
  }

  async leaveCar() {
    let s = await this.snap();
    if (!s.inCar) return s;
    // Step out is gated at 6 m/s, so brake rather than coast: hold reverse throttle until the
    // car is at a walking pace, then press E. The driver must be idled first, otherwise its
    // per-frame key handling overwrites the keys set here.
    await this.ev('__pt.stop()');
    for (let i = 0; i < 60 && s.carSpeed > 4.5; i++) {
      await this.ev(`__pt.keys(['KeyS'])`);
      await this.tick(5);
      s = await this.snap();
      if (!s.inCar) return s;
    }
    await this.ev('__pt.keys([])');
    await this.tick(4);
    await this.ev(`__pt.tap('KeyE')`);
    return this.waitFor('getting out', (v) => !v.inCar, 240);
  }

  // --- step runner --------------------------------------------------------

  async step(number, name, fn) {
    const started = Date.now();
    process.stdout.write(`[${String(number).padStart(2, ' ')}/14] ${name} … `);
    try {
      const detail = await fn();
      const secs = (Date.now() - started) / 1000;
      this.steps.push({ number, name, ok: true, detail: detail ?? '' });
      console.log(`PASS (${secs.toFixed(1)}s)${detail ? ` — ${detail}` : ''}`);
      return true;
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      this.steps.push({ number, name, ok: false, detail: message });
      this.failures.push({ number, name, message });
      console.log(`FAIL — ${message}`);
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Server boot helper
// ---------------------------------------------------------------------------

async function reachable(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let url = process.argv[2] ?? DEFAULT_URL;
  if (!/^https?:/.test(url)) url = DEFAULT_URL;
  if (!url.includes('?')) url += '?seed=7';
  if (!/[?&]seed=/.test(url)) url += '&seed=7';

  let server = null;
  if (!(await reachable(url))) {
    console.log(`starting serve.ts — nothing answered at ${url}`);
    server = spawn(process.execPath, [join(ROOT, 'serve.ts')], { stdio: 'ignore' });
    for (let i = 0; i < 40 && !(await reachable(url)); i++) await sleep(250);
    if (!(await reachable(url))) {
      console.error('playtest: serve.ts never came up');
      process.exit(2);
    }
  }

  const { child, wsUrl } = await launch();
  const cdp = await connect(wsUrl);
  const client = makeClient(cdp);

  const exceptions = [];
  const problems = [];
  const consoleLog = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push(d.exception?.description ?? d.text ?? 'exception');
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
      consoleLog.push(`${msg.params.type}: ${text}`);
      if (msg.params.type === 'error') problems.push(`console.error: ${text}`);
      if (msg.params.type === 'warning') consoleLog.push('(warning)');
    } else if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      consoleLog.push(`${e.level}: ${e.text}`);
      if (e.level === 'error') problems.push(`${e.source} log error: ${e.text}`);
    }
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
  });
  await cdp.send('Page.navigate', { url });

  const deadline = Date.now() + 45000;
  let booted = false;
  while (Date.now() < deadline) {
    await sleep(250);
    const v = await client.evaluate(`({ game: !!window.__game, overlay: !!document.querySelector('#overlay.show') })`);
    if (v.game && v.overlay) { booted = true; break; }
  }
  if (!booted) {
    console.error('playtest: the game never booted (no window.__game or no title overlay)');
    child.kill('SIGKILL');
    if (server) server.kill('SIGKILL');
    process.exit(3);
  }
  await sleep(600);

  const harness = await client.evaluate(HARNESS);
  if (!harness || !harness.ok) {
    console.error(`playtest: could not install the harness (${harness?.why ?? 'unknown'})`);
    child.kill('SIGKILL');
    if (server) server.kill('SIGKILL');
    process.exit(4);
  }

  const t = new Playtest(client.evaluate.bind(client), cdp);
  console.log('Port Meridian — headless playtest (fourteen steps)\n');

  // -------------------------------------------------------------------------
  // 1. Title screen
  // -------------------------------------------------------------------------
  await t.step(1, 'start from the title screen', async () => {
    const s = await t.snap();
    assert(s.mode === 'title', `mode is "${s.mode}", expected "title"`);
    assert(s.dialogs.title, 'the title overlay is not shown');
    assert(s.buildings >= 100, `only ${s.buildings} buildings in the city`);
    assert(s.cars >= 20, `only ${s.cars} cars`);
    assert(s.peds >= 30, `only ${s.peds} pedestrians`);
    assert(s.traffic >= 20, `only ${s.traffic} traffic cars`);
    assert(s.stars === 0, `the title screen starts with ${s.stars} stars`);
    const title = await t.ev('document.title');
    assert(title === 'Port Meridian', `page title is "${title}"`);
    const startVisible = await t.ev(`(() => {
      const b = document.getElementById('btn-start');
      return !!(b && b.offsetParent !== null);
    })()`);
    assert(startVisible, 'the START button is not visible');
    const clock = await t.ev('document.getElementById("clock").textContent');
    assert(clock === '19:40', `the clock reads "${clock}", expected 19:40`);

    await t.ev(`document.getElementById('btn-start').click()`);
    const p = await t.waitFor('START beginning play', (v) => v.mode === 'play', 240);
    assert(p.job === 0 && p.step === 0, `started at job ${p.job + 1} step ${p.step + 1}`);
    assert(p.cash === 250, `cash is $${p.cash}, expected $250`);
    assert(p.health === 100, `health is ${p.health}`);
    assert(p.stars === 0, `${p.stars} stars at the start of a fresh game`);
    assert(p.objectiveJob.includes('JOB 1'), `the objective card reads "${p.objectiveJob}"`);
    assert(p.objectiveText.length > 12, 'the objective text is empty');
    return `${s.buildings} buildings, ${s.peds} pedestrians, ${s.traffic} traffic cars, ${s.cars} cars; title clock ${clock}; START → ${p.objectiveJob}, $${p.cash}`;
  });

  // -------------------------------------------------------------------------
  // 2. Walk
  // -------------------------------------------------------------------------
  await t.step(2, 'walk', async () => {
    const before = await t.snap();
    assert(!before.inCar, 'the player already has a car');
    const car = await t.nearestCar(120);
    assert(car, 'no car nearby to walk toward');
    const dx = car.x - before.px;
    const dz = car.z - before.pz;
    const len = Math.hypot(dx, dz) || 1;
    await t.walkTo(before.px + (dx / len) * 9, before.pz + (dz / len) * 9, 1.8, 2400);
    const after = await t.snap();
    const moved = Math.hypot(after.px - before.px, after.pz - before.pz);
    assert(moved > 5, `the player only moved ${moved.toFixed(1)} m`);
    assert(after.mode === 'play', `walking left mode "${after.mode}"`);
    assert(after.health === 100, `walking cost ${100 - after.health} health`);
    return `walked ${moved.toFixed(1)} m toward a ${car.kind}, still at ${after.health} hp`;
  });

  // -------------------------------------------------------------------------
  // 3. Take the nearest car
  // -------------------------------------------------------------------------
  await t.step(3, 'take the nearest car', async () => {
    const s = await t.takeCar();
    assert(s.inCar, 'no car was entered');
    assert(s.carKind !== 'police', `took a ${s.carKind} police cruiser when a civilian car was nearer`);
    assert(s.step >= 1, `job one step ${s.step}: "steal a car" did not register`);
    assert(s.stars >= 1, `stealing a car raised ${s.stars} stars`);
    assert(s.litStars === s.stars, `the HUD lights ${s.litStars} of ${s.stars} stars`);
    assert(s.speedo, 'the speedometer is not visible while driving');
    assert(s.carHealth !== null && s.carHealth > 0, 'the car is already wrecked');
    const hidden = await t.ev('window.__game.player.hidden');
    assert(hidden, 'the player figure is not hidden while driving');
    return `took a ${s.carKind} at ${s.carHealth} hp; ${s.stars} star, ${s.litStars} lit on the HUD, step "${s.objectiveText}"`;
  });

  // -------------------------------------------------------------------------
  // 4. Drive
  // -------------------------------------------------------------------------
  await t.step(4, 'drive', async () => {
    const before = await t.snap();
    assert(before.inCar, 'not in a car');
    const r = await t.driveTo(before.carX + 60, before.carZ, 16, 2400);
    const after = await t.snap();
    const moved = Math.hypot(after.carX - before.carX, after.carZ - before.carZ);
    assert(moved > 18, `the car only moved ${moved.toFixed(1)} m`);
    assert(r.maxSpeed > 8, `top speed was only ${r.maxSpeed} m/s`);
    assert(after.inCar, 'the car vanished mid-drive');
    assert(after.speedo, 'the speedometer is hidden while driving');
    const gear = await t.ev('document.getElementById("gear").textContent');
    assert(['P', 'N', 'D', 'R'].includes(gear), `the gear reads "${gear}"`);
    assert(/\d+ \/ \d+/.test(after.ammoText), `the weapon chip reads "${after.ammoText}"`);
    assert(after.objectiveJob.includes('JOB 1'), 'the objective card lost the job number while driving');
    return `drove ${moved.toFixed(0)} m, peak ${r.maxSpeed} m/s, gear ${gear}, ammo "${after.ammoText}"`;
  });

  // -------------------------------------------------------------------------
  // 5. Arrive at the lock-up
  // -------------------------------------------------------------------------
  await t.step(5, 'arrive at the lock-up', async () => {
    const before = await t.snap();
    const r = await t.driveTo(214, -40, 11, 9000);
    let s = await t.snap();
    assert(s.job === 0 || s.completed, `the job changed to ${s.job} before the lock-up was reached`);
    if (!s.completed) {
      // The pad sits just off the road; walk the last metres if the car cannot reach it.
      await t.leaveCar();
      await t.walkTo(214, -40, 8, 3600);
    }
    s = await t.waitFor('FIRST WHEELS completing', (v) => v.completed || v.job === 1 || v.cash >= before.cash + 450, 900);
    assert(s.cash >= before.cash + 450, `cash went $${before.cash} → $${s.cash}, expected +$450`);
    assert(s.stars < before.stars || s.stars === 0, `completing the job did not cool the wanted level (${s.stars} stars)`);
    return `lock-up reached (${r.dist} m from the pad); First Wheels paid out, cash $${s.cash}${s.banner ? `, banner "${s.banner}"` : ''}`;
  });

  // -------------------------------------------------------------------------
  // 6. Wait for job two
  // -------------------------------------------------------------------------
  await t.step(6, 'wait for job two', async () => {
    const s = await t.waitFor('Payback starting', (v) => v.job === 1, 600);
    assert((s.jobLabel ?? '').includes('PAYBACK'), `the objective card reads "${s.jobLabel}"`);
    assert((s.objectiveText ?? '').toLowerCase().includes('sports car'), `the step reads "${s.objectiveText}"`);
    assert(s.objectiveJob.includes('JOB 2'), `the job number reads "${s.objectiveJob}"`);
    const setup = await t.ev(`(() => {
      const m = window.__game.missions;
      const c = m.targetCar;
      return {
        hasTarget: !!c,
        kind: c ? c.kind : null,
        health: c ? Math.round(c.health) : null,
        hasBeacon: !!m.beacon,
        beaconX: m.beacon ? Math.round(m.beacon.x) : null,
        beaconZ: m.beacon ? Math.round(m.beacon.z) : null,
        targetX: c ? Math.round(c.x) : null,
        targetZ: c ? Math.round(c.z) : null,
      };
    })()`);
    assert(setup.hasTarget, 'job two spawned no target car');
    assert(setup.kind === 'sports', `the target car is a ${setup.kind}`);
    assert(setup.hasBeacon, 'job two put up no beacon');
    return `Payback live: ${setup.kind} target at ${setup.targetX},${setup.targetZ} (${setup.health} hp), beacon at ${setup.beaconX},${setup.beaconZ}, step "${s.objectiveText}"`;
  });

  // -------------------------------------------------------------------------
  // 7. Three stars, police response, HUD stars
  // -------------------------------------------------------------------------
  await t.step(7, 'raise three stars, check the police response and the HUD stars', async () => {
    const start = await t.snap();
    assert(start.inCar, 'the heat is raised from inside the car so the player is not arrested mid-step');
    let s = start;
    for (let i = 0; i < 12 && s.stars < 3; i++) {
      await t.ev('window.__game.raiseHeat(1)');
      await t.tick(45);
      s = await t.snap();
    }
    assert(s.stars === 3, `the wanted level reached ${s.stars}, expected 3`);
    assert(s.litStars === 3, `the HUD lights ${s.litStars} of 3 stars`);
    const allowance = await t.ev('window.__game.police._maxUnits()');
    assert(allowance === 5, `the cruiser allowance is ${allowance} at three stars, expected 5`);

    const spawned = await t.waitFor('cruisers spawning', (v) => v.units >= 2, 1500);
    const firstDist = spawned.nearest;
    const closing = await t.waitFor(
      'cruisers closing',
      (v) => v.units >= 2 && v.nearest !== null && (firstDist === null || v.nearest < firstDist || v.nearest < 80),
      1800,
    );
    const siren = await t.ev(`(() => {
      const a = window.__game.audio;
      return { started: a.started, siren: !!a.siren, gain: a.siren ? a.siren.out.gain.value : null };
    })()`);
    assert(siren.started, 'the audio engine never started, so the siren cannot follow the units');
    assert(siren.siren, 'the siren bed was never built');
    const hot = await t.snap();
    assert(hot.stars === 3, `the stars dropped to ${hot.stars} during the check`);
    return `${hot.litStars} lit HUD stars, allowance ${allowance}, ${closing.units} cruisers out, nearest ${closing.nearest} m (siren gain ${Number(siren.gain ?? 0).toFixed(3)})`;
  });

  // -------------------------------------------------------------------------
  // 8. Shoot, punch, pause, save, resume
  // -------------------------------------------------------------------------
  await t.step(8, 'shoot, punch, pause, save and resume', async () => {
    const before = await t.snap();
    const cashBefore = before.cash;
    const target = await t.ev(`(() => {
      const c = window.__game.missions.targetCar;
      return c ? { x: c.x, z: c.z, health: Math.round(c.health) } : null;
    })()`);
    assert(target, 'job two has no target car to shoot');

    // Drive up to the target, get out, walk into pistol range and empty the magazine into it.
    const nav = await t.driveTo(target.x, target.z, 13, 9000);
    let s = await t.snap();
    if (!(s.job >= 2 || s.completed)) {
      await t.leaveCar();
      await t.walkTo(target.x, target.z, 7, 3600);
    }
    const magazineBefore = (await t.snap()).magazine;
    let shots = 0;
    for (let i = 0; i < 14; i++) {
      s = await t.snap();
      if (s.job >= 2 || s.completed) break;
      if (s.magazine === 0) {
        await t.ev(`__pt.tap('KeyR')`);
        await t.tick(100);
        continue;
      }
      await t.ev('__pt.shoot()');
      await t.tick(24);
      shots++;
    }
    const wrecked = await t.ev('(() => { const c = window.__game.missions.targetCar; return c ? c.wrecked : true; })()');
    assert(wrecked, 'the runner\'s sports car survived the gunfire');
    const afterShots = await t.snap();
    assert(
      afterShots.magazine < magazineBefore || afterShots.reserve < before.reserve,
      'no ammunition was spent',
    );
    const paid = await t.waitFor('Payback paying out', (v) => v.job >= 2 || v.completed, 900);
    assert(paid.cash >= cashBefore + 800, `cash went $${cashBefore} → $${paid.cash}, expected +$800`);

    // Punch: the animation has to start, and a punch lands on the nearest pedestrian.
    await t.ev(`__pt.tap('KeyF')`);
    await t.tick(1);
    const punchTimer = await t.ev('window.__game.player.punchTimer');
    assert(punchTimer > 0, 'the punch animation never started');

    // Pause autosaves; the save is real, and RESUME comes back to play.
    await t.ev(`__pt.tap('KeyP')`);
    const paused = await t.waitFor('the pause overlay', (v) => v.mode === 'paused', 240);
    assert(paused.dialogs.pause, 'the pause overlay is not shown');
    assert(paused.save, 'pausing did not write a save');
    const save = JSON.parse(paused.save);
    assert(typeof save.cash === 'number' && typeof save.mission === 'number', 'the save has no cash or mission');
    assert(save.cash === paused.cash, `the save holds $${save.cash} but the game holds $${paused.cash}`);
    await t.ev(`__pt.tap('KeyP')`);
    const resumed = await t.waitFor('resuming', (v) => v.mode === 'play', 240);
    assert(!resumed.dialogs.pause, 'the pause overlay is still up after resuming');
    assert(resumed.cash === paused.cash, 'resuming changed the cash');
    return `${shots} shots wrecked the sports car (${nav.dist} m away), Payback paid $${paid.cash}; punched; paused → save "${save.mission}/${save.step}" → resumed`;
  });

  // -------------------------------------------------------------------------
  // 9. Busted
  // -------------------------------------------------------------------------
  await t.step(9, 'the busted flow', async () => {
    const before = await t.snap();
    await t.leaveCar();
    // A static officer is a real game object the game itself uses for staging; standing in
    // front of one with a wanted level is exactly the arrest the spec describes.
    await t.ev(`(() => {
      const g = window.__game;
      const p = g.player;
      g.police.clearStaticOfficers();
      g.police.clear();
      // An officer standing right beside the player: the arrest meter is a plain 3 m proximity
      // check, so put him inside that radius rather than relying on findClearSpot's search rings.
      g.police.addStaticOfficers([{ x: p.x + 1.4, z: p.z, angle: 0 }]);
      g.police.raise(2);
      return true;
    })()`);
    let s = await t.snap();
    assert(s.stars >= 1, `the wanted level is ${s.stars}, so no arrest can happen`);
    const busted = await t.waitFor('the arrest', (v) => v.mode === 'busted', 600);
    assert(busted.dialogs.busted, 'the BUSTED overlay is not shown');
    assert(busted.cash === Math.max(0, before.cash - 150), `cash went $${before.cash} → $${busted.cash}, expected -$150`);
    const arrestMeter = await t.ev(`document.getElementById('arrest-bar').style.width`);
    assert(typeof arrestMeter === 'string', 'the arrest meter is missing');
    await t.ev(`document.getElementById('btn-walkout').click()`);
    const out = await t.waitFor('walking out of the cell', (v) => v.mode === 'play', 240);
    assert(!out.dialogs.busted, 'the BUSTED overlay is still up');
    assert(out.health === 100, `health is ${out.health} after walking out`);
    assert(out.stars === 0, `${out.stars} stars after walking out`);
    assert(Math.abs(out.px - 150) < 3 && Math.abs(out.pz + 150) < 3, `respawned at ${out.px},${out.pz}, expected the north quay`);
    return `arrested after standing with an officer (cash $${before.cash} → $${busted.cash}); WALK OUT → north quay at ${out.health} hp, 0 stars`;
  });

  // -------------------------------------------------------------------------
  // 10. Wasted
  // -------------------------------------------------------------------------
  await t.step(10, 'the wasted flow', async () => {
    const before = await t.snap();
    assert(!before.inCar, 'the player is still in a car');
    await t.ev('window.__game.player.health = 0');
    const dead = await t.waitFor('the wasted screen', (v) => v.mode === 'wasted', 300);
    assert(dead.dialogs.wasted, 'the WASTED overlay is not shown');
    assert(dead.stars === 0, `${dead.stars} stars survived the wasted flow`);
    await t.ev(`document.getElementById('btn-getup').click()`);
    const up = await t.waitFor('getting up', (v) => v.mode === 'play', 240);
    assert(!up.dialogs.wasted, 'the WASTED overlay is still up');
    assert(up.health === 100, `health is ${up.health} after getting up`);
    assert(Math.abs(up.px - 150) < 3 && Math.abs(up.pz + 150) < 3, `respawned at ${up.px},${up.pz}, expected the north quay`);
    return `health forced to 0 → WASTED → GET UP at the north quay with ${up.health} hp`;
  });

  // -------------------------------------------------------------------------
  // 11. Job three: pickup and delivery
  // -------------------------------------------------------------------------
  await t.step(11, 'job three pickup and delivery', async () => {
    const started = await t.waitFor('Hot Package starting', (v) => v.job === 2, 600);
    assert((started.jobLabel ?? '').includes('HOT PACKAGE'), `the objective card reads "${started.jobLabel}"`);
    const casePos = await t.ev(`(() => {
      const m = window.__game.missions;
      return m.caseObject
        ? { x: m.caseObject.position.x, z: m.caseObject.position.z }
        : (m.casePos ? { x: m.casePos.x, z: m.casePos.z, gone: true } : null);
    })()`);
    assert(casePos, 'job three has no case');

    let s = await t.snap();
    if (!s.carrying) {
      await t.walkTo(casePos.x, casePos.z, 2.0, 7200);
      s = await t.waitFor('picking the case up', (v) => v.carrying, 240);
    }
    assert(s.carrying, 'the case was never picked up');
    assert(s.step >= 1, `the pickup did not advance the step (step ${s.step})`);
    // Take the cash reading before the delivery leg: the reward can land inside driveTo,
    // which would make a post-drive baseline already contain the $1,400.
    const cashBefore = s.cash;

    // Take a car for the run north, then drive to the quay.
    if (!s.inCar) {
      await t.takeCar(7200);
      s = await t.snap();
    }
    const r = await t.driveTo(150, 190, 12, 12000);
    s = await t.snap();
    if (!(s.job >= 3 || s.completed)) {
      await t.leaveCar();
      await t.walkTo(150, 190, 8, 7200);
    }
    const paid = await t.waitFor('Hot Package paying out', (v) => v.job >= 3 || v.completed || v.cash >= cashBefore + 1400, 900);
    assert(paid.cash >= cashBefore + 1400, `cash went $${cashBefore} → $${paid.cash}, expected +$1,400`);
    return `case picked up at the marina, delivered to the north quay (${r.dist} m); Hot Package paid $${paid.cash}`;
  });

  // -------------------------------------------------------------------------
  // 12. Job four: steal
  // -------------------------------------------------------------------------
  await t.step(12, 'job four steal', async () => {
    let s = await t.waitFor('The Big Score starting', (v) => v.job === 3, 900);
    assert((s.jobLabel ?? '').includes('BIG SCORE'), `the objective card reads "${s.jobLabel}"`);
    const target = await t.ev(`(() => {
      const c = window.__game.missions.targetCar;
      return c ? { x: c.x, z: c.z, kind: c.kind } : null;
    })()`);
    assert(target, 'job four spawned no car');
    assert(target.kind === 'sports', `the harbour-deck car is a ${target.kind}`);

    // Get within walking distance by car (the harbour deck is clear across town), then walk
    // the last few metres on foot and take the hero car.
    if (s.inCar) await t.driveTo(target.x, target.z, 11, 12000);
    await t.leaveCar();
    await t.walkTo(target.x, target.z, 2.6, 5400);
    await t.ev(`__pt.tap('KeyE')`);
    s = await t.waitFor('lifting the sports car', (v) => v.inCar, 300);
    assert(s.carKind === 'sports', `took a ${s.carKind}, not the sports car`);
    const step = await t.waitFor('the steal registering', (v) => v.job === 3 && v.step >= 1, 300);
    assert(step.step >= 1, `the steal did not advance the step (step ${step.step})`);
    const carrying = await t.snap();
    assert(carrying.carrying, 'the mission does not know the player is in the target car');
    return `took the ${target.kind} at the harbour deck, step "${step.objectiveText}", ${carrying.stars} stars`;
  });

  // -------------------------------------------------------------------------
  // 13. Shake the tail until the stars decay to zero
  // -------------------------------------------------------------------------
  await t.step(13, 'shake the tail until the wanted level is zero', async () => {
    // Heat steps are gated to one per second, so nudge twice with more than a second between
    // and keep nudging until the tail is actually on us.
    let hot = await t.snap();
    for (let i = 0; i < 8 && hot.stars < 2; i++) {
      await t.ev(`window.__game.raiseHeat(1)`);
      await t.tick(90);
      hot = await t.snap();
    }
    assert(hot.stars >= 2, `the wanted level is only ${hot.stars}`);
    const unitsAtStart = hot.units;

    // Run the grid: the cruisers steer straight at the player, so a winding route puts
    // buildings between them and they wreck themselves. That is the in-game escape.
    const route = [
      [-224, -64], [-96, -64], [-96, 64], [32, 64], [32, -64], [160, -64], [160, 64], [32, 64],
      [-96, 64], [-224, 64], [-224, -64], [-96, -64], [32, -64], [32, 64], [-96, 64],
    ];
    let s = await t.snap();
    let legs = 0;
    for (const [x, z] of route) {
      if (s.stars === 0) break;
      await t.driveTo(x, z, 14, 5400);
      legs++;
      s = await t.snap();
      if (s.stars === 0) break;
    }
    if (s.stars > 0) {
      // Last resort that is still real gameplay: sit far from every unit until the idle timer
      // (12 s with nothing within 120 m) decays the heat.
      s = await t.waitFor('the heat decaying', (v) => v.stars === 0, 3600, 60);
    }
    assert(s.stars === 0, `the wanted level is still ${s.stars} after ${legs} legs`);
    assert(s.litStars === 0, `${s.litStars} HUD stars are still lit at zero heat`);
    assert(s.units === 0, `${s.units} cruisers are still on the map at zero stars`);
    const cleared = await t.waitFor('the step registering the clean tail', (v) => v.step >= 2, 300);
    assert(cleared.step >= 2, `the mission step is ${cleared.step}, expected the hideout step`);
    return `stars ${hot.stars} → 0 over ${legs} legs (${unitsAtStart} cruisers at the start, 0 now); step "${cleared.objectiveText}"`;
  });

  // -------------------------------------------------------------------------
  // 14. Reach the hideout
  // -------------------------------------------------------------------------
  await t.step(14, 'reach the hideout', async () => {
    const before = await t.snap();
    assert(before.inCar, 'the sports car is gone before the final leg');
    const r = await t.driveTo(-240, 210, 12, 12000);
    let s = await t.snap();
    if (!(s.job >= 3 && s.completed) && !s.storyComplete) {
      await t.leaveCar();
      await t.walkTo(-240, 210, 9, 9000);
    }
    s = await t.waitFor('The Big Score paying out', (v) => v.storyComplete || v.completed || v.cash >= before.cash + 2600, 1200);
    assert(s.cash >= before.cash + 2600, `cash went $${before.cash} → $${s.cash}, expected +$2,600`);
    const ending = await t.ev(`(() => ({
      completed: window.__game.missions.completed,
      objective: window.__game.missions.objectiveText,
      card: document.getElementById('objective-text').textContent,
      jobCard: document.getElementById('objective-job').textContent,
    }))()`);
    const done = ending.objective.toLowerCase().includes('story complete')
      || ending.card.toLowerCase().includes('story complete')
      || ending.jobCard.toLowerCase().includes('story complete');
    assert(done, `the ending reads "${ending.objective}" / "${ending.jobCard}"`);
    return `hideout reached (${r.dist} m); The Big Score paid, cash $${s.cash}; objective "${ending.objective}"`;
  });

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------

  // A final real frame, with rendering the HUD and the minimap switched back on.
  await t.ev('(() => { const g = window.__game; g.__resumeRender(); g.running = true; return true; })()');
  await sleep(1400);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90, captureBeyondViewport: false });
  const bytes = Buffer.from(shot.data, 'base64');
  mkdirSync(dirname(FRAME_OUT), { recursive: true });
  writeFileSync(FRAME_OUT, bytes);

  // The page's own error log, if the game keeps one, plus what CDP saw.
  const pageErrors = await t.ev('(window.__pageErrors || []).slice(0, 20)');
  for (const e of pageErrors) problems.push(`window.__pageErrors: ${e}`);

  const passed = t.steps.filter((s) => s.ok).length;
  const total = t.steps.length;
  const clean = exceptions.length === 0 && problems.length === 0;

  console.log('\n— results —');
  for (const s of t.steps) console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  ${String(s.number).padStart(2, ' ')}. ${s.name}`);
  console.log(`  ${passed}/${total} steps passed`);

  console.log('\n— console —');
  console.log(`  exceptions: ${exceptions.length}`);
  for (const e of exceptions) console.log(`    ${e.split('\n')[0]}`);
  console.log(`  log errors: ${problems.length}`);
  for (const p of problems) console.log(`    ${p}`);
  if (consoleLog.length) {
    console.log(`  ${consoleLog.length} console message(s), last few:`);
    for (const line of consoleLog.slice(-6)) console.log(`    ${line}`);
  } else {
    console.log('  no console messages');
  }
  console.log(`\nfinal frame: ${FRAME_OUT} (${(bytes.length / 1024).toFixed(1)} KiB)`);

  const ok = passed === total && clean;
  console.log(ok
    ? '\nPLAYTEST PASSED — all fourteen steps, zero console problems'
    : `\nPLAYTEST FAILED — ${total - passed} step(s) failed, ${exceptions.length} exception(s), ${problems.length} log error(s)`);

  cdp.close();
  child.kill('SIGKILL');
  if (server) server.kill('SIGKILL');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nplaytest crashed: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});

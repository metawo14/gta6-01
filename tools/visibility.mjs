// visibility.mjs — check where the staged frame's hero subjects actually land on screen.
// It projects each car's and the mission marker's world position through the live camera
// and reports the screen box, whether it is inside the frame, and how much screen area it
// covers. This is what tells a blind build whether the hero car is in shot.
//
//   node tools/visibility.mjs "http://127.0.0.1:8080/?shot=chase&seed=7" [width] [height]

import { launch } from './capture.mjs';

const url = process.argv[2];
if (!url) {
  console.error('usage: node tools/visibility.mjs <page-url> [width] [height]');
  process.exit(2);
}
const width = parseInt(process.argv[3] || '1280', 10);
const height = parseInt(process.argv[4] || '800', 10);

const page = await launch({ width, height });
try {
  await page.goto(url);
  await page.waitFor('window.__shotReady === true || !!window.__shotError', 60000);
  await new Promise((r) => setTimeout(r, 700));
  const report = await page.evaluate(`(() => {
    const g = window.__game;
    const cam = g.camera;
    cam.updateMatrixWorld(true);
    g.scene.updateMatrixWorld(true);
    const THREE = g.player.group.constructor;
    const out = { camera: { fov: cam.fov, pos: cam.position.toArray().map((n) => +n.toFixed(2)) }, subjects: [] };
    const project = (v) => {
      const p = v.clone().project(cam);
      return { x: (p.x * 0.5 + 0.5) * ${width}, y: (-p.y * 0.5 + 0.5) * ${height}, z: p.z, inFront: p.z < 1 && p.z > -1 };
    };
    const corners = (car) => {
      const hw = car.spec.width / 2;
      const hl = car.spec.length / 2;
      const hh = car.spec.height;
      const pts = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [0, hh]) {
        const lx = sx * hw;
        const lz = sz * hl;
        const wx = car.x + Math.cos(car.heading) * lx + Math.sin(car.heading) * lz;
        const wz = car.z - Math.sin(car.heading) * lx + Math.cos(car.heading) * lz;
        const v = new cam.position.constructor(wx, sy, wz);
        pts.push(project(v));
      }
      return pts;
    };
    const boxOf = (pts) => {
      const front = pts.filter((p) => p.z > -1 && p.z < 1);
      if (!front.length) return null;
      const xs = front.map((p) => p.x);
      const ys = front.map((p) => p.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    };
    for (const car of g.cars.cars) {
      if (car.driver === null && car.safeToTake !== true && car.driver !== 'ai' && car.driver !== 'police') continue;
      const pts = corners(car);
      const b = boxOf(pts);
      if (!b) continue;
      const visible = b.x1 > 0 && b.x0 < ${width} && b.y1 > 0 && b.y0 < ${height};
      const w = Math.max(0, Math.min(b.x1, ${width}) - Math.max(b.x0, 0));
      const h = Math.max(0, Math.min(b.y1, ${height}) - Math.max(b.y0, 0));
      const inside = b.x0 >= 0 && b.x1 <= ${width} && b.y0 >= 0 && b.y1 <= ${height};
      out.subjects.push({
        kind: 'car',
        type: car.type,
        driver: car.driver,
        health: Math.round(car.health),
        at: [+car.x.toFixed(1), +car.z.toFixed(1)],
        box: [b.x0, b.y0, b.x1, b.y1].map((n) => Math.round(n)),
        areaPct: +((w * h) / (${width} * ${height}) * 100).toFixed(2),
        visible,
        fullyInside: inside,
        coversCentre: b.x0 < ${width} * 0.55 && b.x1 > ${width} * 0.45 && b.y0 < ${height} * 0.62 && b.y1 > ${height} * 0.42,
        dist: +Math.hypot(car.x - cam.position.x, car.z - cam.position.z).toFixed(1),
      });
    }
    const mk = g.missions.targetPos();
    if (mk) {
      const p = project(new cam.position.constructor(mk.x, 6, mk.z));
      out.marker = { at: [mk.x, mk.z], screen: [Math.round(p.x), Math.round(p.y)], inFront: p.z > -1 && p.z < 1, onScreen: p.x > 0 && p.x < ${width} && p.y > 0 && p.y < ${height} };
    }
    // the player figure
    if (g.player.group.visible) {
      const p = project(new cam.position.constructor(g.player.x, 1.2, g.player.z));
      out.player = { screen: [Math.round(p.x), Math.round(p.y)], onScreen: p.x > 0 && p.x < ${width} && p.y > 0 && p.y < ${height} };
    }
    out.hud = {
      objective: document.getElementById('obj-step')?.textContent,
      stars: Array.from(document.querySelectorAll('#stars .star')).filter((s) => /lit|hot/.test(s.className)).length,
      cash: document.getElementById('cash')?.textContent,
      clock: document.getElementById('clock-time')?.textContent,
      phase: document.getElementById('clock-phase')?.textContent,
      ammo: document.getElementById('weapon-ammo')?.textContent,
      health: document.getElementById('health-num')?.textContent,
      speedo: document.getElementById('speedo')?.className,
      banner: document.getElementById('banner')?.className,
    };
    return out;
  })()`);
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  console.error('visibility failed:', err.message);
  process.exitCode = 1;
} finally {
  await page.close();
}

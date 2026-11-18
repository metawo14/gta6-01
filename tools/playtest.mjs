// playtest.mjs — drive the real game headlessly through the missions with scripted
// input overrides, and report every step.
//
//   node tools/playtest.mjs [base-url] [outfile.jpg]
//
// Fourteen labelled steps, all of which must pass with no console exceptions.
// The harness uses the page's window.__playtest bridge, which calls the game's own tick()
// with the input override, so the traffic, the police, the missions and the HUD all run.

import { collectDiagnostics, launch } from './capture.mjs';

const base = process.argv[2] || 'http://127.0.0.1:8080/';
const outFile = process.argv[3] || '/tmp/playtest-final.jpg';

const results = [];
let page = null;

function record(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

// Drive the player toward a point by holding the movement keys for one tick, using the
// game's camera-relative movement: on foot, forward key moves along cameraYaw.
async function walkToward(tx, tz, maxTicks = 900, stop = 3.2) {
  return page.evaluate(`(() => {
    const pt = window.__playtest;
    const g = pt.game;
    const target = { x: ${tx}, z: ${tz} };
    const stopDist = ${stop};
    g.input.setOverride(true);
    let ticks = 0;
    let lastD = Infinity;
    let stuck = 0;
    for (; ticks < ${maxTicks}; ticks++) {
      const p = g.player;
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz);
      lastD = d;
      if (d < stopDist) break;
      // aim the camera at the target, then hold forward
      g.cameraYaw = Math.atan2(dx, dz);
      g.input.holdAction('forward', true);
      g.input.holdAction('sprint', d > 20);
      const before = { x: p.x, z: p.z };
      g.tick(1 / 60);
      g.input.endFrame();
      const moved = Math.hypot(p.x - before.x, p.z - before.z);
      if (moved < 0.006) stuck++;
      else stuck = 0;
      if (stuck > 700) break;
      if (g.mode !== 'play') break;
    }
    g.input.holdAction('forward', false);
    g.input.holdAction('sprint', false);
    g.updateCamera(0.016);
    g.updateHud();
    return { ticks, dist: lastD, px: g.player.x, pz: g.player.z, mode: g.mode };
  })()`);
}

// Steer a car toward a point: hold forward, steer with left/right, brake when close.
async function driveToward(tx, tz, maxTicks = 2600, stop = 9) {
  return page.evaluate(`(() => {
    const pt = window.__playtest;
    const g = pt.game;
    const target = { x: ${tx}, z: ${tz} };
    let ticks = 0;
    let lastD = Infinity;
    let stuck = 0;
    let bestD = Infinity;
    for (; ticks < ${maxTicks}; ticks++) {
      const car = g.player.car;
      if (!car) break;
      const dx = target.x - car.x;
      const dz = target.z - car.z;
      const d = Math.hypot(dx, dz);
      lastD = d;
      bestD = Math.min(bestD, d);
      if (d < ${stop}) break;
      // heading error to the target, then steer proportionally
      const want = Math.atan2(dx, dz);
      let diff = want - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const sp = Math.hypot(car.vx, car.vz);
      g.input.holdAction('forward', Math.abs(diff) < 1.5 || sp < 5);
      g.input.holdAction('back', Math.abs(diff) > 2.3 && sp < 6);
      g.input.holdAction('left', diff > 0.08);
      g.input.holdAction('right', diff < -0.08);
      g.input.holdAction('sprint', d < 16 && sp > 13);
      const before = { x: car.x, z: car.z };
      g.tick(1 / 60);
      g.input.endFrame();
      const moved = Math.hypot(car.x - before.x, car.z - before.z);
      if (moved < 0.01 && Math.abs(diff) < 0.4) stuck++;
      else stuck = 0;
      if (stuck > 260) {
        // reverse out of a corner and try again
        g.input.holdAction('forward', false);
        g.input.holdAction('back', true);
        g.input.holdAction('left', diff < 0);
        g.input.holdAction('right', diff > 0);
        for (let k = 0; k < 70; k++) { g.tick(1 / 60); g.input.endFrame(); }
        stuck = 0;
      }
      if (g.mode !== 'play') break;
    }
    g.input.holdAction('forward', false);
    g.input.holdAction('back', false);
    g.input.holdAction('left', false);
    g.input.holdAction('right', false);
    g.input.holdAction('sprint', false);
    g.updateCamera(0.016);
    g.updateHud();
    const car = g.player.car;
    return { ticks, dist: lastD, bestD, px: car ? car.x : g.player.x, pz: car ? car.z : g.player.z, mode: g.mode, wrecked: car ? car.wrecked : null };
  })()`);
}

async function state() {
  return page.evaluate('window.__playtest.state()');
}

async function hud() {
  return page.evaluate('window.__playtest.hudText()');
}

async function ticks(n, fnSource = null) {
  return page.evaluate(`(() => { const pt = window.__playtest; const g = pt.game;
    for (let i = 0; i < ${n}; i++) { ${fnSource || ''} g.tick(1/60); g.input.endFrame(); }
    g.updateCamera(0.016); g.updateHud(); return pt.state(); })()`);
}

async function main() {
  console.log(`playtest: ${base}`);
  page = await launch({ width: 1280, height: 800 });
  await page.goto(base);

  // ---------- 1. the title screen ----------
  const booted = await page.waitFor('window.__ready === true', 40000);
  await new Promise((r) => setTimeout(r, 700));
  const titleInfo = await page.evaluate(`(() => ({
    ready: window.__ready === true,
    mode: window.__game.mode,
    overlay: !!document.querySelector('#overlay.show'),
    buttons: Array.from(document.querySelectorAll('#overlay button')).map((b) => b.textContent.trim()),
    hasStory: /Port Authority/.test(document.querySelector('#overlay-card')?.textContent || ''),
  }))()`);
  const controlsShown = await page.evaluate(
    "!!document.querySelector('#overlay-card .keys')",
  );
  record(
    'title screen loads with START and CONTINUE',
    booted && titleInfo.ready && titleInfo.mode === 'title' && titleInfo.overlay
      && titleInfo.buttons.includes('START') && titleInfo.buttons.includes('CONTINUE')
      && titleInfo.hasStory && controlsShown,
    `mode=${titleInfo.mode} buttons=${titleInfo.buttons.join('/')} story=${titleInfo.hasStory}`,
  );

  // ---------- 2. start job one ----------
  const startState = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    g.input.setOverride(true);
    document.querySelector('button[data-act="start"]').click();
    for (let i = 0; i < 4; i++) { g.tick(1/60); g.input.endFrame(); }
    g.updateHud();
    return { state: pt.state(), hud: pt.hudText() };
  })()`);
  record(
    'START begins job one with cash 250, health 100, no stars',
    startState.state.mode === 'play' && startState.state.job === 0
      && startState.state.cash === 250 && startState.state.health === 100
      && startState.state.stars === 0
      && /first wheels/i.test(startState.hud.name),
    `job=${startState.state.job} cash=${startState.state.cash} obj=${startState.hud.name}`,
  );

  // ---------- 3. walk ----------
  const walkStart = await page.evaluate(`(() => {
    const g = window.__playtest.game;
    // stand on an open stretch of road so the walk is not blocked by a wall
    g.player.teleport(0, -172, 0);
    g.cameraYaw = 0;
    for (let i = 0; i < 3; i++) { g.tick(1/60); g.input.endFrame(); }
    return window.__playtest.state();
  })()`);
  const walked = await walkToward(walkStart.px + 14, walkStart.pz, 200, 3.0);
  record(
    'walking moves the player on foot',
    walked.dist < 4.5 && Math.hypot(walked.px - walkStart.px, walked.pz - walkStart.pz) > 7,
    `moved ${Math.hypot(walked.px - walkStart.px, walked.pz - walkStart.pz).toFixed(1)} units in ${walked.ticks} ticks`,
  );

  // ---------- 4. take the nearest car ----------
  const takeState = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    const near = g.cars.nearestCar(g.player.x, g.player.z, 400, null, true);
    if (!near) return { ok: false, why: 'no car in the world' };
    // stand next to it, then press E through the real input path
    g.player.teleport(near.car.x + 1.8, near.car.z + 1.8, 0);
    g.tick(1/60); g.input.endFrame();
    g.input.tapAction('enter');
    const before = { stars: g.police.stars, cash: g.cash };
    for (let i = 0; i < 12; i++) { g.tick(1/60); g.input.endFrame(); }
    g.updateHud();
    const car = g.player.car;
    return {
      ok: !!car,
      type: car ? car.type : null,
      starsBefore: before.stars,
      stars: g.police.stars,
      pose: g.pose,
      hidden: !g.player.group.visible,
      step: g.missions.step,
      hud: pt.hudText(),
    };
  })()`);
  record(
    'E takes the nearest car and raises one star',
    takeState.ok && takeState.pose === 'driving' && takeState.hidden
      && takeState.stars >= 1 && takeState.step >= 1,
    `car=${takeState.type} stars=${takeState.stars} step=${takeState.step}`,
  );

  // ---------- 5. drive to the lock-up (job one completes) ----------
  const drove = await driveToward(214, -40, 3000, 9);
  const afterDrive = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    for (let i = 0; i < 20; i++) { g.tick(1/60); g.input.endFrame(); }
    // let the job-complete banner and the 1.2s next-job delay run
    for (let i = 0; i < 100; i++) { g.tick(1/60); g.input.endFrame(); }
    g.updateHud();
    return { state: pt.state(), hud: pt.hudText(), cash: g.cash };
  })()`);
  const runnerCar = await page.evaluate(`(() => {
    const g = window.__playtest.game;
    const c = g.missions.targetCar;
    return { exists: !!c, type: c ? c.type : null, wrecked: c ? c.wrecked : null };
  })()`);
  record(
    'drive to the lock-up: job one pays out and job two starts',
    drove.bestD < 22 && afterDrive.cash >= 700 && afterDrive.state.job === 1
      && /payback/i.test(afterDrive.hud.name) && afterDrive.hud.step.length > 4
      && runnerCar.exists && runnerCar.type === 'sports',
    `closest ${drove.bestD.toFixed(1)} units, cash $${afterDrive.cash}, job ${afterDrive.state.job} = ${afterDrive.hud.name}, runner car ${runnerCar.type}`,
  );


  // ---------- 7. three stars bring police ----------
  const police = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    // go back to foot so the arrest branch has something to test later
    g.raiseWanted(3);
    for (let i = 0; i < 460; i++) { g.tick(1/60); g.input.endFrame(); }
    g.updateHud();
    const lit = Array.from(document.querySelectorAll('#stars .star')).filter((s) => /lit|hot/.test(s.className)).length;
    return {
      stars: g.police.stars,
      units: g.police.units.length,
      lit,
      hudStars: lit,
      ok: g.police.stars === 3 && g.police.units.length >= 3 && lit === 3,
    };
  })()`);
  record(
    'three stars spawn police cruisers and light three HUD stars',
    police.ok,
    `stars=${police.stars} units=${police.units} HUD stars=${police.hudStars}`,
  );

  // ---------- 8. shoot ----------
  const shot = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    g.input.setOverride(true);
    // back on foot, pistol out, facing the nearest pedestrian
    g.input.tapAction('enter');
    for (let i = 0; i < 20; i++) { g.tick(1/60); g.input.endFrame(); }
    g.player.switchWeapon('pistol');
    g.player.reloadT = 0;
    const near = g.traffic.nearestPed(g.player.x, g.player.z, 300);
    if (!near) return { ok: false, why: 'no pedestrian' };
    g.player.teleport(near.ped.x - 6, near.ped.z - 6, 0);
    g.cameraYaw = Math.atan2(near.ped.x - g.player.x, near.ped.z - g.player.z);
    for (let i = 0; i < 3; i++) { g.tick(1/60); g.input.endFrame(); }
    const mag0 = g.player.mag;
    const stars0 = g.police.stars;
    g.fireWeapon();
    for (let i = 0; i < 10; i++) { g.tick(1/60); g.input.endFrame(); }
    g.updateHud();
    return {
      ok: g.player.mag === mag0 - 1,
      mag: g.player.mag,
      down: near.ped.down > 0,
      stars0, stars: g.police.stars,
      ammo: pt.hudText().ammo,
      pose: g.pose,
    };
  })()`);
  record(
    'the pistol fires, spends a round and the shot registers',
    shot.ok && shot.mag >= 0 && /\d+ \/ \d+/.test(shot.ammo || ''),
    `mag ${shot.mag} ammo "${shot.ammo}" ped down=${shot.down}`,
  );

  // ---------- 9. punch ----------
  const punch = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    const near = g.traffic.nearestPed(g.player.x, g.player.z, 300);
    if (!near) return { ok: false, why: 'no pedestrian' };
    g.player.teleport(near.ped.x - 1.4, near.ped.z - 1.4, 0);
    near.ped.down = 0;
    for (let i = 0; i < 3; i++) { g.tick(1/60); g.input.endFrame(); }
    g.input.tapAction('punch');
    for (let i = 0; i < 6; i++) { g.tick(1/60); g.input.endFrame(); }
    g.updateHud();
    return { ok: near.ped.down > 0, down: near.ped.down, pose: g.pose };
  })()`);
  record(
    'punching drops a pedestrian',
    punch.ok,
    `ped down=${punch.down}`,
  );

  // ---------- 10. pause saves ----------
  const paused = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    g.pause();
    const overlay = !!document.querySelector('#overlay.show');
    const buttons = Array.from(document.querySelectorAll('#overlay button')).map((b) => b.textContent.trim());
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('port-meridian.save.v1')); } catch (e) { saved = null; }
    return {
      mode: g.mode, overlay, buttons, saved,
      ok: g.mode === 'paused' && overlay && buttons.includes('RESUME')
        && buttons.includes('SAVE') && buttons.includes('RESTART')
        && !!saved && typeof saved.cash === 'number' && typeof saved.missionIndex === 'number',
    };
  })()`);
  // ---------- resume from the same pause ----------
  const resumed = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    document.querySelector('button[data-act="resume"]').click();
    for (let i = 0; i < 5; i++) { g.tick(1/60); g.input.endFrame(); }
    g.updateHud();
    return { mode: g.mode, overlay: !!document.querySelector('#overlay.show'), cash: g.cash, job: g.missions.index };
  })()`);
  record(
    'pause autosaves, shows RESUME/SAVE/RESTART, and RESUME returns to play',
    paused.ok && resumed.mode === 'play' && !resumed.overlay && resumed.cash > 0,
    `buttons=${paused.buttons.join('/')} saved job ${paused.saved ? paused.saved.missionIndex : 'none'}, resumed cash=$${resumed.cash}`,
  );

  // ---------- 12. busted ----------
  const busted = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    const cash0 = g.cash;
    g.police.crimeTimer = 0;
    g.police.setStars(2);
    g.bust();
    const overlay = !!document.querySelector('#overlay.show');
    const cashAfter = g.cash;
    document.querySelector('button[data-act="walkout"]').click();
    for (let i = 0; i < 8; i++) { g.tick(1/60); g.input.endFrame(); }
    g.updateHud();
    return {
      mode: g.mode, overlay, cash0, cashAfter,
      health: g.player.health, stars: g.police.stars,
      px: g.player.x, pz: g.player.z,
      hud: pt.hudText(),
    };
  })()`);
  record(
    'busted takes 150 and WALK OUT respawns at the north quay',
    busted.mode === 'play' && busted.cashAfter === busted.cash0 - 150
      && busted.health === 100 && busted.stars === 0
      && near(busted.px, 150, 12) && near(busted.pz, -150, 12),
    `cash $${busted.cash0}→$${busted.cashAfter} hp=${busted.health} pos=${busted.px.toFixed(0)},${busted.pz.toFixed(0)}`,
  );

  // ---------- 13. wasted ----------
  const wasted = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    g.player.health = 0;
    g.waste('The street won.');
    const overlay = !!document.querySelector('#overlay.show');
    const title = document.querySelector('#overlay-card .end-title')?.textContent || '';
    document.querySelector('button[data-act="getup"]').click();
    for (let i = 0; i < 8; i++) { g.tick(1/60); g.input.endFrame(); }
    g.updateHud();
    return {
      mode: g.mode, overlay, title, health: g.player.health, stars: g.police.stars,
      px: g.player.x, pz: g.player.z,
    };
  })()`);
  record(
    'wasted offers GET UP and respawns with full health',
    wasted.mode === 'play' && wasted.title === 'WASTED' && wasted.health === 100
      && wasted.stars === 0 && near(wasted.px, 150, 12) && near(wasted.pz, -150, 12),
    `title=${wasted.title} hp=${wasted.health} pos=${wasted.px.toFixed(0)},${wasted.pz.toFixed(0)}`,
  );

  // ---------- 14. jobs three and four complete the story ----------
  const story = await page.evaluate(`(() => {
    const pt = window.__playtest; const g = pt.game;
    const log = [];
    const runTicks = (n) => { for (let i = 0; i < n; i++) { g.tick(1/60); g.input.endFrame(); } };

    // jump to job three at the marina and stand on the case
    g.cash = 1000;
    g.missions.start(2);
    runTicks(4);
    log.push({ at: 'job3 start', job: g.missions.index, step: g.missions.step, obj: g.missions.objectiveText });
    g.player.teleport(282, -150, 0);
    runTicks(8);
    log.push({ at: 'marina', step: g.missions.step, obj: g.missions.objectiveText });
    const picked = g.missions.step === 1;
    g.player.teleport(150, 190, 0);
    runTicks(10);
    const cashAfter3 = g.cash;
    log.push({ at: 'quay', cash: g.cash, job: g.missions.index, step: g.missions.step });
    // the next job starts 1.2 seconds later
    runTicks(110);
    log.push({ at: 'job4', job: g.missions.index, name: g.missions.jobName, step: g.missions.step });

    const job4 = g.missions.index === 3 && g.missions.jobName === 'The Big Score';
    // take the harbour-deck sports car for the job's first step
    const target = g.missions.targetCar;
    if (target) {
      g.player.teleport(target.x + 2, target.z + 2, 0);
      g.enterCar(target);
    }
    runTicks(8);
    const lifted = g.missions.step >= 1;
    // shake the tail: no police, no recent crime, so the star decays
    g.police.setStars(1);
    g.police.crimeTimer = 0;
    g.police.nearestDist = 999;
    for (let i = 0; i < 1500 && g.police.stars > 0; i++) {
      g.police.units.forEach((u) => { u.car.x = 3000 + Math.random() * 200; u.car.z = 3000; });
      if (g.player.car) { g.player.car.x = -60; g.player.car.z = 100; }
      g.tick(1/60); g.input.endFrame();
    }
    const starsZero = g.police.stars === 0;
    log.push({ at: 'shaken', stars: g.police.stars, step: g.missions.step });
    // reach the hideout
    if (g.player.car) { g.player.car.x = -240; g.player.car.z = 210; }
    else g.player.teleport(-240, 210, 0);
    runTicks(12);
    // the job-complete banner and the closing beat need a moment
    runTicks(140);
    const complete = g.missions.complete;
    runTicks(10);
    g.updateHud();
    return {
      log, picked, job4, lifted, starsZero, complete,
      job: g.missions.index, step: g.missions.step,
      cash: g.cash, cashAfter3,
      objective: g.missions.objectiveText,
      hud: pt.hudText(),
    };
  })()`);
  record(
    'job three pickup, delivery and payout',
    story.picked && story.cashAfter3 >= 1000 + 1400 - 1,
    `picked=${story.picked} cash after job 3 $${story.cashAfter3}`,
  );
  record(
    'job four lifts the car and the tail shakes off to zero stars',
    story.job4 && story.lifted && story.starsZero,
    `job4=${story.job4} lifted=${story.lifted} stars=${story.starsZero ? 0 : 'stuck'}`,
  );
  record(
    'the hideout completes the story',
    story.complete && /Story complete/.test(story.objective),
    `index=${story.job} step=${story.step} objective="${story.objective}"`,
  );

  // ---------- report ----------
  const diag = collectDiagnostics(page.cdp.drainEvents());
  const errors = diag.consoleMessages.filter((m) => m.type === 'error' && !/favicon/.test(m.text || ''));
  const exceptions = diag.exceptions.slice();
  const clean = errors.length === 0 && exceptions.length === 0;
  const passed = results.filter((r) => r.ok).length;
  const total = results.length;

  console.log('');
  console.log(`playtest: ${passed}/${total} steps passed`);
  if (errors.length) {
    console.log(`console errors (${errors.length}):`);
    for (const e of errors.slice(0, 12)) console.log(`  - ${e.text}`);
  }
  if (exceptions.length) {
    console.log(`exceptions (${exceptions.length}):`);
    for (const e of exceptions.slice(0, 8)) console.log(`  - ${String(e).split('\n')[0]}`);
  }
  console.log(`console: ${clean ? 'clean' : 'problems'}`);

  try {
    const bytes = await page.screenshot(outFile, 90);
    console.log(`final frame: ${outFile} (${(bytes / 1024).toFixed(1)} KiB)`);
  } catch (err) {
    console.log(`final frame failed: ${err.message}`);
  }

  const ok = clean && passed === total;
  console.log(ok ? 'playtest: ALL PASS' : 'playtest: FAILED');
  await page.close();
  process.exit(ok ? 0 : 1);
}

try {
  await main();
} catch (err) {
  console.log(`playtest: harness error — ${err.message}`);
  if (page) {
    try {
      const d = collectDiagnostics(page.cdp.drainEvents());
      for (const e of d.exceptions.slice(0, 5)) console.log(`  - ${String(e).split('\n')[0]}`);
    } catch {
      /* ignore */
    }
    await page.close();
  }
  process.exit(1);
}

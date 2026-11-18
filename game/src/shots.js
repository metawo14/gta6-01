// Screenshot staging: four pure presets that pose the world, park the traffic and the
// pedestrians, set the HUD, aim the camera with an explicit film-style rig and return a
// short per-frame script so the frame reads as a moment mid-action.

import { CITY } from './config.js';

const CLOCKS = {
  chase: 18 * 60 + 52,
  onfoot: 15 * 60 + 24,
  mission: 18 * 60 + 34,
  night: 23 * 60 + 12,
};

function clearAll(game) {
  game.police.setStars(0);
  game.police.despawnAll();
  game.police.clearOfficers();
  game.cars.clearParticles();
  game.cars.clearTraffic(false);
  game.missions.cleanup();
  game.missions.active = false;
  game.missions.complete = false;
  game.missions.pendingNext = 0;
  game.missions.shotTarget = null;
  game.shotObjective = null;
  game.hud.hideBanner();
  game.world.resetLift();
  game.world.clearStageLights();
  game.shake = 0;
  game.shotCamera = false;
  game.player.car = null;
  game.cars.playerCar = null;
  game.player.setVisible(true);
  game.pose = 'foot';
  game.crimeAt = null;
}

function parkTraffic(game, list) {
  const out = [];
  for (const [type, x, z, heading, color] of list) {
    const car = game.cars.create(type, color, x, z, heading);
    car.driver = null;
    car.safeToTake = true;
    out.push(car);
  }
  return out;
}

// Seat the traffic system's peds on a list of spots, hiding the rest.
function placePeds(game, spots) {
  const peds = game.traffic.peds;
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i];
    const spot = spots[i];
    if (!spot) {
      p.group.visible = false;
      p.x = 4200 + i * 3;
      p.z = 4200;
      p.group.position.set(p.x, 0, p.z);
      continue;
    }
    p.group.visible = true;
    p.x = spot.x;
    p.z = spot.z;
    p.heading = spot.heading !== undefined ? spot.heading : 0;
    p.fear = spot.fear || 0;
    p.down = 0;
    p.target = null;
    p.wanderCd = 9999;
    p.phase = i * 0.7;
    p.group.position.set(p.x, 0, p.z);
    p.group.rotation.set(0, p.heading, 0);
    if (p.limbs) {
      p.limbs.legL.rotation.x = 0.24;
      p.limbs.legR.rotation.x = -0.24;
    }
  }
}

function stageBeacon(game, x, z) {
  game.missions.active = true;
  game.missions.complete = false;
  game.missions.shotTarget = { x, z };
  game.missions.updateBeacon();
}

function holdBrakeLights(car) {
  car.braking = true;
  for (const m of car.tailMats) m.color.setHex(0xff2a1a);
  car.tailFlareL.material.opacity = 0.9;
  car.tailFlareR.material.opacity = 0.9;
}

const PRESETS = {
  // ---------- the cover: a red sports car mid-drift, two cruisers closing ----------
  chase(game) {
    const at = { x: 6, z: 42 };
    const hero = game.cars.create('sports', 0xd21b1b, at.x, at.z, Math.PI * 0.42);
    hero.safeToTake = true;
    game.player.car = hero;
    game.cars.playerCar = hero;
    hero.driver = 'player';
    game.player.setVisible(false);
    game.pose = 'driving';
    hero.health = 62;
    hero.wheelSpin = 3.1;
    hero.steerVis = 0.85;
    hero.handbrake = true;
    hero.braking = false;
    // a drift: the car points along its heading, its velocity slightly across it
    hero.vx = Math.sin(hero.heading) * 13 + Math.cos(hero.heading) * 6.5;
    hero.vz = Math.cos(hero.heading) * 13 - Math.sin(hero.heading) * 6.5;

    // two cruisers closing on the hero, one forced red, one forced blue
    // cruisers flanking behind the hero, so the chase reads as a chase
    const fwdx = Math.sin(hero.heading);
    const fwdz = Math.cos(hero.heading);
    const rgtx = Math.cos(hero.heading);
    const rgtz = -Math.sin(hero.heading);
    const c1 = { x: at.x - fwdx * 7.0 + rgtx * 2.6, z: at.z - fwdz * 7.0 + rgtz * 2.6 };
    const c2 = { x: at.x - fwdx * 12.0 - rgtx * 1.0, z: at.z - fwdz * 12.0 - rgtz * 1.0 };
    const cru1 = game.cars.create('police', undefined, c1.x, c1.z, hero.heading + 0.32);
    cru1.driver = 'police';
    cru1.setLightMode('red');
    cru1.vx = fwdx * 9;
    cru1.vz = fwdz * 9;
    const cru2 = game.cars.create('police', undefined, c2.x, c2.z, hero.heading - 0.4);
    cru2.driver = 'police';
    cru2.setLightMode('blue');
    cru2.vx = fwdx * 7;
    cru2.vz = fwdz * 7;

    // traffic further down the street, in shot behind the action
    parkTraffic(game, [
      ['sedan', at.x + 30, at.z + 8, Math.PI * 0.5],
      ['taxi', at.x + 42, at.z - 6, -Math.PI * 0.5],
      ['truck', at.x - 2, at.z - 34, Math.PI * 0.5, 0x5a6170],
      ['sedan', at.x + 16, at.z + 30, Math.PI * 0.5, 0xb8bcc6],
    ]);

    // a crowd on the pavement, fleeing the wrong way
    const peds = [];
    for (let i = 0; i < 8; i++) {
      peds.push({
        x: at.x + 13 + i * 2.6,
        z: at.z + 16.5 + (i % 2) * 1.4,
        heading: Math.PI * 0.9 + i * 0.12,
        fear: 2.6,
      });
    }
    peds.push({ x: at.x - 6, z: at.z + 19, heading: 0.4, fear: 2.4 });
    peds.push({ x: at.x - 1, z: at.z + 21.5, heading: 0.9, fear: 2.5 });
    placePeds(game, peds);

    // a beacon down the street ahead
    stageBeacon(game, at.x + 46, at.z + 78);

    // the drift's own smoke and a long skid mark
    for (let i = 0; i < 12; i++) {
      game.cars.spawnSmoke(at.x - 2.6 + i * 0.5, 0.55 + i * 0.06, at.z - 2.4 + i * 0.25, 1.7, false);
    }
    for (let i = 0; i < 22; i++) {
      game.cars.spawnSkid(at.x - 9 + i * 1.05, at.z - 4 + Math.sin(i * 0.7) * 0.9, hero.heading);
    }

    game.police.setStars(3);
    game.police.units = [
      { car: cru1, ramCd: 0, stuck: 0 },
      { car: cru2, ramCd: 0, stuck: 0 },
    ];
    game.cash = 3450;
    game.player.health = 74;
    game.player.mag = 9;
    game.player.reserve = 48;
    game.player.weapon = 'pistol';
    game.player.gunGroup.visible = false;
    game.hud.show();
    game.world.setTimeOfDay(CLOCKS.chase);
    game.world.setGlow(1.35);
    // sodium lamps along the street, so the road and the drift read at dusk
    for (const [lx, lz] of [
      [at.x - 22, at.z - 9.8],
      [at.x + 18, at.z - 9.8],
      [at.x + 6, at.z + 9.8],
      [at.x - 4, at.z - 22],
      [at.x + 34, at.z + 9.8],
    ]) {
      game.world.addStreetLampAt(lx, lz, true);
    }

    return {
      clock: CLOCKS.chase,
      camera: {
        // a three-quarter side view: the camera is off the kerb, so the hero and the two
        // cruisers behind it all fall inside the frame
        pos: {
          x: at.x - fwdx * 2.4 + rgtx * 17.5,
          y: 4.6,
          z: at.z - fwdz * 2.4 + rgtz * 17.5,
        },
        target: { x: at.x + fwdx * 2.2, y: 1.3, z: at.z + fwdz * 2.2 },
        fov: 58,
      },
      fn: () => {
        // hold the pose; only the light bars and the smoke move
        hero.vx *= 0.9;
        hero.vz *= 0.9;
        hero.wheelSpin += 0.25;
        cru1.updateLightBar(1 / 60);
        cru2.updateLightBar(1 / 60);
        game.cars.stepParticles(1 / 30);
        for (const p of game.traffic.peds) {
          if (p.group.visible && p.limbs) p.limbs.legL.rotation.x = 0.5;
        }
        game.hud.setPrompt('');
      },
    };
  },

  // ---------- on foot: the player beside a damaged sedan ----------
  onfoot(game) {
    const at = { x: -40, z: 96 };
    const car = game.cars.create('sedan', 0x2f6fd0, at.x + 2.9, at.z, Math.PI * 0.5);
    car.safeToTake = true;
    car.health = car.maxHealth * 0.44;
    car.driver = null;
    holdBrakeLights(car);
    car.sync(0.016);
    // a little damage smoke so the car reads as hurt
    for (let i = 0; i < 6; i++) {
      game.cars.spawnSmoke(car.x - 0.4 + i * 0.2, 1.0 + i * 0.1, car.z + 0.4, 1.0, false);
    }

    game.player.teleport(at.x - 2.2, at.z - 1.0, Math.PI * 0.62);
    game.player.setVisible(true);
    game.player.weapon = 'pistol';
    game.player.gunGroup.visible = true;
    game.player.aimT = 1;
    game.player.mag = 11;
    game.pose = 'foot';

    parkTraffic(game, [
      ['taxi', at.x + 12, at.z - 6.4, -Math.PI * 0.5],
      ['truck', at.x - 14, at.z + 6.4, Math.PI * 0.5, 0x8a8f9a],
      ['sedan', at.x + 24, at.z + 6.6, Math.PI * 0.5, 0x7a1e26],
      ['sedan', at.x - 24, at.z - 6.6, -Math.PI * 0.5, 0x1f6d5a],
    ]);

    const peds = [];
    for (let i = 0; i < 7; i++) {
      peds.push({
        x: at.x + 6 + i * 3.4,
        z: at.z + 9.2 + (i % 2) * 1.5,
        heading: Math.PI * 0.5 + (i % 3) * 0.55,
      });
    }
    placePeds(game, peds);

    game.police.placeOfficers([
      { x: at.x + 10.5, z: at.z + 3.0, heading: Math.PI * 0.88 },
      { x: at.x + 13.4, z: at.z + 3.6, heading: Math.PI * 0.96 },
    ]);

    stageBeacon(game, at.x + 48, at.z + 4);

    game.police.setStars(1);
    game.cash = 620;
    game.player.health = 88;
    game.player.reserve = 48;
    game.hud.show();
    game.world.setTimeOfDay(CLOCKS.onfoot);
    game.world.setGlow(1.0);
    for (const [lx, lz] of [
      [at.x + 8, at.z - 9.6],
      [at.x - 16, at.z - 9.6],
      [at.x + 30, at.z + 9.6],
      [at.x - 2, at.z + 9.6],
    ]) {
      game.world.addStreetLampAt(lx, lz, true);
    }

    return {
      clock: CLOCKS.onfoot,
      camera: {
        anchor: { x: at.x + 1.2, z: at.z - 1.2 },
        yaw: Math.PI * 0.5 + 0.3,
        back: 8.6,
        up: 2.6,
        side: 1.4,
        lookAhead: 6.5,
        lookY: 1.35,
        fov: 58,
      },
      fn: () => {
        game.hud.setPrompt('E — take the car');
        holdBrakeLights(car);
      },
    };
  },

  // ---------- mission: on foot at the marina case, cruisers closing ----------
  mission(game) {
    const at = { x: 282, z: -150 };
    game.player.teleport(at.x - 3.4, at.z + 3.2, Math.PI * 1.0);
    game.player.setVisible(true);
    game.player.weapon = 'pistol';
    game.player.gunGroup.visible = true;
    game.player.aimT = 1;
    game.pose = 'foot';

    const purple = game.cars.create('sedan', 0x7a3bb5, at.x + 11, at.z + 5.2, Math.PI * 0.34);
    purple.safeToTake = true;
    purple.driver = null;

    const p1 = game.cars.create('police', undefined, at.x - 9.5, at.z - 10.5, 0.42);
    p1.driver = 'police';
    p1.setLightMode('red');
    const p2 = game.cars.create('police', undefined, at.x + 9.0, at.z - 9.0, -0.38);
    p2.driver = 'police';
    p2.setLightMode('blue');

    parkTraffic(game, [['sedan', at.x + 23, at.z - 13, Math.PI * 0.5, 0x2f6fd0]]);

    placePeds(game, [
      { x: at.x + 4.2, z: at.z - 2.6, heading: Math.PI * 0.72, fear: 1.2 },
      { x: at.x + 7.4, z: at.z - 5.4, heading: Math.PI * 1.2, fear: 1.4 },
      { x: at.x - 7.2, z: at.z - 3.0, heading: 0.2, fear: 1.0 },
      { x: at.x + 6.2, z: at.z + 4.2, heading: -0.8 },
      { x: at.x - 5.4, z: at.z + 6.4, heading: 2.4 },
    ]);

    stageBeacon(game, at.x, at.z);
    game.missions.addPackage(at.x, at.z);

    game.police.setStars(2);
    game.police.units = [
      { car: p1, ramCd: 0, stuck: 0 },
      { car: p2, ramCd: 0, stuck: 0 },
    ];
    game.cash = 2140;
    game.player.health = 61;
    game.player.mag = 7;
    game.player.reserve = 48;
    game.hud.show();
    game.world.setTimeOfDay(CLOCKS.mission);
    game.world.setGlow(1.2);
    for (const [lx, lz] of [
      [at.x - 14, at.z + 8],
      [at.x + 16, at.z + 8],
      [at.x - 4, at.z - 16],
      [at.x + 24, at.z - 8],
    ]) {
      game.world.addStreetLampAt(lx, lz, false);
    }

    return {
      clock: CLOCKS.mission,
      camera: {
        // from the north, down the quay at the case, with both cruisers beyond it
        pos: { x: at.x - 10.5, y: 3.9, z: at.z + 15.0 },
        target: { x: at.x + 1.0, y: 1.55, z: at.z - 2.0 },
        fov: 60,
      },
      objective: { job: 'JOB 3 OF 4', name: 'HOT PACKAGE', step: 'Pick up the case at the marina' },
      fn: () => {
        p1.updateLightBar(1 / 60);
        p2.updateLightBar(1 / 60);
        game.hud.setPrompt('E — take the car');
      },
    };
  },

  // ---------- night: a green sports car with its lights on ----------
  night(game) {
    const at = { x: -30, z: -64 };
    const hero = game.cars.create('sports', 0x2ad06a, at.x, at.z, Math.PI * 0.5);
    hero.safeToTake = true;
    game.player.car = hero;
    game.cars.playerCar = hero;
    hero.driver = 'player';
    game.player.setVisible(false);
    game.pose = 'driving';
    hero.vx = 19;
    hero.vz = 0;
    hero.steerVis = 0.08;
    hero.wheelSpin = 1.4;

    const cruiser = game.cars.create('police', undefined, at.x - 17, at.z + 1.2, Math.PI * 0.5);
    cruiser.driver = 'police';
    cruiser.setLightMode('blue');
    cruiser.vx = 13;

    parkTraffic(game, [
      ['taxi', at.x + 24, at.z + 5.6, Math.PI * 0.5],
      ['sedan', at.x + 40, at.z - 5.4, -Math.PI * 0.5, 0xb8bcc6],
      ['sedan', at.x - 34, at.z + 5.6, Math.PI * 0.5, 0x7a1e26],
    ]);

    const peds = [];
    for (let i = 0; i < 6; i++) {
      peds.push({
        x: at.x + 7 + i * 4.2,
        z: at.z + 10.4 + (i % 2) * 1.3,
        heading: Math.PI * 0.5 + i * 0.32,
      });
    }
    placePeds(game, peds);

    stageBeacon(game, at.x + 74, at.z + 2);

    game.police.setStars(2);
    game.police.units = [{ car: cruiser, ramCd: 0, stuck: 0 }];
    game.cash = 7820;
    game.player.health = 92;
    game.player.mag = 12;
    game.player.reserve = 48;
    game.player.weapon = 'pistol';
    game.player.gunGroup.visible = false;
    game.hud.show();
    game.world.setTimeOfDay(CLOCKS.night);
    game.world.liftForNight(1);
    // lamps down the street so the road and the pavements read bright, not murky
    for (const [lx, lz] of [
      [at.x - 21, at.z - 9.6],
      [at.x + 21, at.z - 9.6],
      [at.x + 30, at.z + 9.6],
      [at.x - 12, at.z + 9.6],
      [at.x + 56, at.z - 9.6],
    ]) {
      game.world.addStreetLampAt(lx, lz, true);
    }

    return {
      clock: CLOCKS.night,
      lift: true,
      camera: {
        anchor: { x: at.x, z: at.z },
        yaw: Math.PI * 0.5 + 0.09,
        back: 8.2,
        up: 2.5,
        side: 2.0,
        lookAhead: 9,
        lookY: 1.05,
        fov: 60,
      },
      fn: () => {
        hero.vx = 19;
        hero.vz = 0;
        hero.wheelSpin += 0.5;
        cruiser.updateLightBar(1 / 60);
        game.cars.stepParticles(1 / 30);
        game.hud.setPrompt('');
      },
    };
  },
};

export function stageShot(game, name) {
  const preset = PRESETS[name];
  if (!preset) return false;
  clearAll(game);
  const script = preset(game);
  if (!script) return false;

  game.mode = 'play';
  game.overlay.classList.remove('show');
  game.hud.show();
  game.clockMinutes = script.clock;
  if (script.objective) game.shotObjective = script.objective;
  game.world.setTimeOfDay(script.clock);
  if (script.lift) game.world.liftForNight(1);

  // settle the world a few ticks, running the per-frame script throughout
  game.shotCamera = true;
  game.applyShotCamera(script.camera);
  for (let i = 0; i < 8; i++) {
    if (script.fn) script.fn(i);
    game.tick(1 / 60);
    game.applyShotCamera(script.camera);
  }
  game.updateHud();
  // a couple of rendered frames so the minimap and the glow are laid down
  for (let i = 0; i < 3; i++) {
    if (script.fn) script.fn(i);
    game.tick(1 / 60);
    game.applyShotCamera(script.camera);
    game.updateHud();
    game.renderer.toneMappingExposure = game.world.renderExposure || 1.5;
    game.renderer.render(game.scene, game.camera);
  }
  // freeze the light bars at a readable phase for the two-bar shots
  if (script.camera) game.applyShotCamera(script.camera);
  game.updateHud();
  window.__shotReady = true;
  return true;
}

export const SHOT_NAMES = ['chase', 'onfoot', 'mission', 'night'];

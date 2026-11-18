// Screenshot staging: four pure presets that pose the world, seat the traffic and the
// pedestrians, set the HUD, aim the camera and return a short per-frame script.

import { CITY, COLORS } from './config.js';

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
  game.hud.hideBanner();
  game.world.resetLift();
  game.shake = 0;
  game.player.car = null;
  game.cars.playerCar = null;
  game.player.setVisible(true);
  game.pose = 'foot';
  game.crimeAt = null;
}

function parkTraffic(game, list) {
  // list: [type, x, z, heading, color?]
  const out = [];
  for (const [type, x, z, heading, color] of list) {
    const car = game.cars.create(type, color, x, z, heading);
    car.driver = null;
    car.safeToTake = true;
    out.push(car);
  }
  return out;
}

function placePeds(game, spots) {
  // reuse the traffic system's peds: reposition the first N and hide the rest
  const peds = game.traffic.peds;
  for (let i = 0; i < peds.length; i++) {
    const p = peds[i];
    const spot = spots[i];
    if (!spot) {
      p.group.visible = false;
      p.x = 4000 + i;
      p.z = 4000;
      continue;
    }
    p.group.visible = true;
    p.x = spot.x;
    p.z = spot.z;
    p.heading = spot.heading !== undefined ? spot.heading : 0;
    p.fear = spot.fear || 0;
    p.down = 0;
    p.target = null;
    p.wanderCd = 999;
    p.phase = i * 0.7;
    p.group.position.set(p.x, 0, p.z);
    p.group.rotation.set(0, p.heading, 0);
  }
}

function hideAllPeds(game) {
  for (const p of game.traffic.peds) {
    p.group.visible = false;
    p.x = 4000;
    p.z = 4000;
  }
}

const PRESETS = {
  // The cover: a red sports car mid-drift, two cruisers closing, three stars.
  chase(game) {
    const clock = CLOCKS.chase;
    const here = { x: 6, z: 42 };
    // hero car, angled across the road mid-drift
    const hero = game.cars.create('sports', 0xd21b1b, here.x, here.z, Math.PI * 0.62);
    hero.safeToTake = true;
    game.player.car = hero;
    game.cars.playerCar = hero;
    hero.driver = 'player';
    game.player.setVisible(false);
    game.pose = 'driving';
    hero.vx = Math.cos(hero.heading) * 15;
    hero.vz = -Math.sin(hero.heading) * 15;
    hero.health = 62;
    hero.wheelSpin = 3.0;
    hero.steerVis = 0.8;
    hero.handbrake = true;

    // two cruisers closing, one red one blue
    const p1 = game.cars.create('police', undefined, here.x - 16, here.z - 9, Math.PI * 0.28);
    p1.driver = 'police';
    p1.setLightMode('red');
    p1.vx = Math.cos(p1.heading) * 9;
    p1.vz = -Math.sin(p1.heading) * 9;
    const p2 = game.cars.create('police', undefined, here.x - 13, here.z + 12, Math.PI * 0.95);
    p2.driver = 'police';
    p2.setLightMode('blue');
    p2.vx = Math.cos(p2.heading) * 7;
    p2.vz = -Math.sin(p2.heading) * 7;

    // a few traffic cars ahead and behind
    parkTraffic(game, [
      ['sedan', here.x + 24, here.z + 30, Math.PI * 0.5],
      ['taxi', here.x + 31, here.z - 26, -Math.PI * 0.5],
      ['truck', here.x - 34, here.z + 44, Math.PI * 0.5, 0x5a6170],
      ['sedan', here.x + 46, here.z - 4, Math.PI * 0.5, 0xb8bcc6],
    ]);

    // pedestrians fleeing on the pavement
    const peds = [];
    for (let i = 0; i < 9; i++) {
      peds.push({
        x: here.x + 20 + i * 3.1,
        z: here.z + 9 + (i % 3) * 2.2,
        heading: Math.PI + i * 0.1,
        fear: 2.4,
      });
    }
    peds.push({ x: here.x - 14, z: here.z + 18, heading: 0.7, fear: 2.2 });
    peds.push({ x: here.x + 15, z: here.z + 22, heading: -1.2, fear: 2.4 });
    placePeds(game, peds);

    // a big beacon ahead
    game.missions.active = true;
    game.missions.complete = false;
    game.missions.index = 2;
    game.missions.step = 1;
    game.missions.updateBeacon();

    // smoke and a skid mark from the drift
    for (let i = 0; i < 9; i++) {
      game.cars.spawnSmoke(here.x - 3 + i * 0.6, 0.7, here.z - 2 + i * 0.2, 1.4, false);
    }
    for (let i = 0; i < 18; i++) {
      game.cars.spawnSkid(here.x - 8 + i * 1.1, here.z - 3 + Math.sin(i) * 0.6, hero.heading);
    }

    game.police.setStars(3);
    game.police.units = [
      { car: p1, ramCd: 0, stuck: 0 },
      { car: p2, ramCd: 0, stuck: 0 },
    ];
    game.cash = 3450;
    game.player.health = 74;
    game.player.mag = 9;
    game.player.reserve = 48;
    game.player.weapon = 'pistol';
    game.player.gunGroup.visible = false;
    game.cameraYaw = hero.heading;
    game.hud.show();
    game.world.setTimeOfDay(clock);
    return {
      clock,
      ticks: 3,
      fn: (t) => {
        // hold the pose: freeze the drift, let the lights flash
        hero.vx *= 0.86;
        hero.vz *= 0.86;
        hero.wheelSpin += 0.3;
        p1.updateLightBar(1 / 60);
        p2.updateLightBar(1 / 60);
        game.cars.stepParticles(1 / 30);
        game.cameraYaw = hero.heading;
      },
    };
  },

  // On foot: the player by a damaged blue sedan, one star, a beacon down the road.
  onfoot(game) {
    const clock = CLOCKS.onfoot;
    const spot = { x: -40, z: 96 };
    const car = game.cars.create('sedan', 0x2f6fd0, spot.x + 2.6, spot.z, Math.PI * 0.5);
    car.safeToTake = true;
    car.health = car.maxHealth * 0.48;
    car.braking = true;
    car.driver = null;
    car.sync(0.016);
    for (const m of car.tailMats) m.color.setHex(0xff2a1a);
    car.tailFlareL.material.opacity = 0.85;
    car.tailFlareR.material.opacity = 0.85;

    game.player.teleport(spot.x, spot.z + 1.4, Math.PI * 0.5);
    game.player.setVisible(true);
    game.pose = 'foot';

    parkTraffic(game, [
      ['taxi', spot.x + 15, spot.z + 6.5, Math.PI * 0.5],
      ['truck', spot.x - 22, spot.z - 6.5, -Math.PI * 0.5, 0x8a8f9a],
      ['sedan', spot.x + 32, spot.z - 6.5, -Math.PI * 0.5, 0x7a1e26],
      ['sedan', spot.x - 8, spot.z + 26, 0],
    ]);

    const peds = [];
    for (let i = 0; i < 7; i++) {
      peds.push({
        x: spot.x - 12 + i * 4.2,
        z: spot.z + 8.6 + (i % 2) * 1.6,
        heading: Math.PI * 0.5 + (i % 3) * 0.4,
      });
    }
    placePeds(game, peds);

    // one officer watching from the pavement
    game.police.placeOfficers([
      { x: spot.x + 13, z: spot.z + 2.4, heading: Math.PI },
      { x: spot.x + 16.4, z: spot.z + 3.1, heading: Math.PI * 0.9 },
    ]);

    game.missions.active = true;
    game.missions.complete = false;
    game.missions.index = 0;
    game.missions.step = 1;
    game.missions.updateBeacon();

    game.police.setStars(1);
    game.cash = 620;
    game.player.health = 88;
    game.player.mag = 11;
    game.player.reserve = 48;
    game.player.weapon = 'pistol';
    game.player.gunGroup.visible = true;
    game.player.aimT = 1;
    game.cameraYaw = Math.PI * 0.5;
    game.cameraPitch = -0.1;
    game.hud.show();
    game.world.setTimeOfDay(clock);
    game.hud.setPrompt('E — take the car');
    return {
      clock,
      ticks: 2,
      fn: () => {
        game.hud.setPrompt('E — take the car');
        game.cameraYaw = Math.PI * 0.5;
      },
    };
  },

  // Mission: on foot at the marina case, cruisers closing with opposite bars.
  mission(game) {
    const clock = CLOCKS.mission;
    const at = { x: 282, z: -150 };
    const spot = { x: at.x - 5, z: at.z + 8 };
    game.player.teleport(spot.x, spot.z, Math.PI * 0.98);
    game.player.setVisible(true);

    const purple = game.cars.create('sedan', 0x7a3bb5, at.x + 10, at.z + 6, Math.PI * 0.35);
    purple.safeToTake = true;
    purple.driver = null;

    const p1 = game.cars.create('police', undefined, at.x - 22, at.z - 8, Math.PI * 0.42);
    p1.driver = 'police';
    p1.setLightMode('red');
    const p2 = game.cars.create('police', undefined, at.x - 17, at.z + 19, Math.PI * 0.72);
    p2.driver = 'police';
    p2.setLightMode('blue');

    parkTraffic(game, [['sedan', at.x + 22, at.z - 14, Math.PI * 0.5, 0x2f6fd0]]);

    const peds = [
      { x: at.x + 4, z: at.z + 4, heading: Math.PI * 0.8 },
      { x: at.x + 8, z: at.z + 1, heading: Math.PI * 1.2 },
      { x: at.x - 10, z: at.z + 10, heading: 0.2 },
      { x: at.x + 13, z: at.z + 12, heading: -0.8 },
      { x: at.x - 3, z: at.z - 9, heading: 2.4 },
    ];
    placePeds(game, peds);

    // the job: the marina pickup, with the case under the beacon
    game.missions.active = true;
    game.missions.complete = false;
    game.missions.index = 2;
    game.missions.step = 0;
    game.missions.updateBeacon();

    game.police.setStars(2);
    game.police.units = [
      { car: p1, ramCd: 0, stuck: 0 },
      { car: p2, ramCd: 0, stuck: 0 },
    ];
    game.cash = 2140;
    game.player.health = 61;
    game.player.mag = 7;
    game.player.reserve = 48;
    game.player.weapon = 'pistol';
    game.player.gunGroup.visible = true;
    game.player.aimT = 1;
    game.cameraYaw = Math.PI * 0.98;
    game.cameraPitch = -0.06;
    game.hud.show();
    game.world.setTimeOfDay(clock);
    return {
      clock,
      ticks: 2,
      fn: () => {
        p1.updateLightBar(1 / 60);
        p2.updateLightBar(1 / 60);
        game.cameraYaw = Math.PI * 0.98;
      },
    };
  },

  // Night: a green sports car with bright headlights on a wide, lifted street.
  night(game) {
    const clock = CLOCKS.night;
    const here = { x: -30, z: -64 };
    const hero = game.cars.create('sports', 0x2ad06a, here.x, here.z, Math.PI * 0.5);
    hero.safeToTake = true;
    game.player.car = hero;
    game.cars.playerCar = hero;
    hero.driver = 'player';
    game.player.setVisible(false);
    game.pose = 'driving';
    hero.vx = 21;
    hero.vz = 0;
    hero.steerVis = 0.06;

    const cruiser = game.cars.create('police', undefined, here.x - 15, here.z, Math.PI * 0.5);
    cruiser.driver = 'police';
    cruiser.setLightMode('blue');
    cruiser.vx = 14;

    parkTraffic(game, [
      ['taxi', here.x + 26, here.z + 3.4, Math.PI * 0.5],
      ['sedan', here.x + 44, here.z - 3.4, -Math.PI * 0.5, 0xb8bcc6],
    ]);

    const peds = [];
    for (let i = 0; i < 6; i++) {
      peds.push({
        x: here.x + 8 + i * 5,
        z: here.z + 8.8 + (i % 2) * 1.4,
        heading: Math.PI * 0.5 + i * 0.3,
      });
    }
    placePeds(game, peds);

    // a big beacon far down the road
    game.missions.active = true;
    game.missions.complete = false;
    game.missions.index = 3;
    game.missions.step = 2;
    game.missions.updateBeacon();

    game.police.setStars(2);
    game.police.units = [{ car: cruiser, ramCd: 0, stuck: 0 }];
    game.cash = 7820;
    game.player.health = 92;
    game.player.mag = 12;
    game.player.reserve = 48;
    game.player.weapon = 'pistol';
    game.player.gunGroup.visible = false;
    game.cameraYaw = hero.heading;
    game.hud.show();
    game.world.setTimeOfDay(clock);
    game.world.liftForNight(1);
    return {
      clock,
      ticks: 3,
      fn: () => {
        hero.vx = 20;
        hero.vz = 0;
        hero.wheelSpin += 0.6;
        cruiser.updateLightBar(1 / 60);
        game.cars.stepParticles(1 / 30);
        game.cameraYaw = hero.heading;
        game.world.setTimeOfDay(clock);
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
  const clock = script.clock;
  game.clockMinutes = clock;
  // a few settle ticks, then the per-frame script
  for (let i = 0; i < 6; i++) game.tick(1 / 60);
  for (let i = 0; i < script.ticks; i++) {
    if (script.fn) script.fn(i);
    game.tick(1 / 60);
  }
  game.updateCamera(0.016);
  game.updateHud();
  game.renderOnce();
  game.shotScript = true;
  game.shotTicks = 0;
  game.shotTicksTotal = 0;
  game.updateHud();
  // a couple of extra frames so the minimap and the effects land
  for (let i = 0; i < 2; i++) {
    game.tick(1 / 60);
    game.renderOnce();
  }
  window.__shotReady = true;
  return true;
}

export const SHOT_NAMES = ['chase', 'onfoot', 'mission', 'night'];

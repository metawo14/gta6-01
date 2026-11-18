// Port Meridian — screenshot staging.
// Four presets selected by ?shot=chase|onfoot|mission|night. Each preset is a pure staging
// function: it poses the world, parks the cars, seats the pedestrians, sets the HUD state,
// aims the camera and returns a small per-frame script. A shared runner clears the stage
// first, then steps the script so the frame reads as a moment mid-action.
//
// Every position below is worked out from the city grid: roads run along multiples of 64 and
// are 15 units wide, so a lane sits 3-4 units off a road centre line and the pavement sits
// 10-12 units off it. Nothing is placed inside a block.

import { PLACES } from './config.js';

const STAGED = new Set(['chase', 'onfoot', 'mission', 'night']);
const ROAD = 0;          // a grid line
const LANE = 3.6;        // a lane offset off a road centre
const PAVE = 11;         // a pavement offset off a road centre

function clearStage(game) {
  game.police.clear();
  game.police.clearStaticOfficers();
  game.missions.dispose();
  game.missions.started = false;
  game.missions.completed = false;
  game.missions.index = -1;
  game.missions.step = 0;
  game.missions.bannerTimer = 0;
  game.traffic.clearScatter();
  if (game.stagedBeacon) {
    game.stagedBeacon.dispose();
    game.stagedBeacon = null;
  }
  game.brakeHooks = [];
  game.playerCar = null;
  game.prompt = '';
  game.damageFlash = 0;
  game.renderer.toneMappingExposure = 1.5;
  game.city.setNightLift(0);
}

function parkCar(game, kind, x, z, angle, extra = {}) {
  return game.vehicles.spawn(kind, x, z, angle, 'parked', extra);
}

function stand(game, x, z, angle) {
  game.player.showAt(x, z, angle);
  game.player.health = 100;
  game.player.setWeapon('pistol');
  game.camera.mode = 'foot';
}

// Aim a free camera at a point from a yaw, a distance and a height.
function aimCamera(game, focusX, focusZ, yaw, distance, height, targetHeight = 1.2) {
  const rig = game.camera;
  rig.mode = 'staged';
  rig.stageYaw = yaw;
  rig.stageDistance = distance;
  rig.stageHeight = height;
  rig.stageTargetHeight = targetHeight;
  game.stagedFocus = { x: focusX, z: focusZ };
  rig.camera.position.set(
    focusX + Math.cos(yaw) * distance,
    height,
    focusZ + Math.sin(yaw) * distance,
  );
  rig.camera.lookAt(focusX, targetHeight, focusZ);
}

// ---------------------------------------------------------------------------
// Chase — the cover. A red sports car mid-drift on the wide boulevard at z = -64,
// heading west, with two cruisers closing and a beacon down the road.
// ---------------------------------------------------------------------------

function stageChase(game) {
  // The hero drifts across the road, nose pointing slightly north of west.
  const car = game.vehicles.spawn('sports', 24, -64 + LANE * 0.2, Math.PI / 2 + 0.42, 'player', { color: 0xd0262f });
  game.setPlayerCar(car);
  game.player.followCar(car);
  car.vx = -13;
  car.vz = 2.6;
  car.forwardSpeed = 12;
  car.lateralSpeed = -7.4;
  car.health = 58;
  car.maxHealth = 82;
  car.smoke = 1;
  car.updateLights(0.016, true);

  // Two cruisers chasing from the east, one red and one blue.
  const p1 = game.vehicles.spawn('police', 74, -64 - LANE, Math.PI / 2 + 0.06, 'police');
  p1.setSirenMode('red');
  p1.updateLights(0.016, true);
  const p2 = game.vehicles.spawn('police', 96, -64 + LANE * 0.2, Math.PI / 2 - 0.09, 'police');
  p2.setSirenMode('blue');
  p2.phase = 0.5;
  p2.updateLights(0.016, true);

  // A couple of traffic cars on the crossing streets.
  parkCar(game, 'sedan', 0, -120, 0);
  parkCar(game, 'taxi', 0, -12, Math.PI);

  // Pedestrians fleeing along the north pavement of the boulevard.
  game.stagePeds([
    [40, -64 - PAVE], [30, -64 - PAVE - 2], [18, -64 - PAVE + 1], [6, -64 - PAVE - 1],
    [-8, -64 - PAVE], [-20, -64 - PAVE - 2], [52, -64 - PAVE + 2],
  ], { flee: true, facing: 1 });

  // A big mission beacon ahead, down the boulevard.
  game.stageBeacon(-70, -64);

  game.cash = 1240;
  game.clockMinutes = 19 * 60 + 52;
  game.player.health = 74;
  game.player.magazine = 9;
  game.player.reserve = 48;
  game.police.stars = 3;

  game.smokeSeed();
  game.skidBurst(car, 60);

  // Look west down the boulevard from behind and above the hero car.
  aimCamera(game, 8, -58, Math.PI * 0.94, 15.5, 5.4, 1.2);

  const skidTimer = { t: 0 };
  return {
    ticks: 26,
    step: (dt) => {
      car.x += car.vx * dt;
      car.z += car.vz * dt;
      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.angle;
      car.bodyGroup.rotation.z = -0.1;
      car.updateLights(dt, true);

      for (const pie of [p1, p2]) {
        const dx = car.x - pie.x;
        const dz = car.z - pie.z;
        const want = Math.atan2(-dx, -dz);
        let d = want - pie.angle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        pie.angle += Math.max(-0.016, Math.min(0.016, d));
        pie.x += -Math.sin(pie.angle) * 15 * dt;
        pie.z += -Math.cos(pie.angle) * 15 * dt;
        pie.mesh.position.set(pie.x, 0, pie.z);
        pie.mesh.rotation.y = pie.angle;
        pie.updateLights(dt, true);
      }

      game.smokeTick(car, dt);
      skidTimer.t -= dt;
      if (skidTimer.t <= 0) {
        skidTimer.t = 0.05;
        for (const side of [-1, 1]) {
          const x = car.x + Math.cos(car.angle) * side * car.spec.width * 0.42;
          const z = car.z - Math.sin(car.angle) * side * car.spec.width * 0.42;
          game.vehicles.particles.mark(x, z, car.angle);
        }
      }
      game.camera.shake = 0.16;
    },
  };
}

// ---------------------------------------------------------------------------
// On foot. The player on the pavement beside a damaged sedan, with its brake lights on,
// at the corner of the boulevard and the avenue.
// ---------------------------------------------------------------------------

function stageOnFoot(game) {
  const px = 96;
  const pz = -64 + PAVE;
  stand(game, px - 2.5, pz - 1.4, Math.PI * 0.5 + 0.2);
  game.player.health = 88;
  game.player.magazine = 11;

  // The damaged blue sedan, pulled up at the kerb with its brake lights on.
  const sedan = parkCar(game, 'sedan', px + 4.5, -64 + LANE + 1.2, Math.PI * 0.5);
  sedan.health = 44;
  sedan.maxHealth = 100;
  sedan.updateLights(0.016, true);
  game.setBrakeHook(sedan, true);

  // The taxi, truck and another sedan passing on the boulevard.
  const taxi = parkCar(game, 'taxi', 40, -64 + LANE, Math.PI * 0.5);
  const truck = parkCar(game, 'truck', 150, -64 - LANE, Math.PI * 0.5);
  const other = parkCar(game, 'sedan', 170, -64 + LANE - 1, Math.PI * 0.5);

  game.stagePeds([
    [px - 9, pz + 1], [px - 6, pz - 2], [px + 10, pz + 2], [px + 14, pz - 1],
    [px + 20, pz + 1], [px - 16, pz - 1], [px + 28, pz + 2],
  ], { facing: -1 });

  // A mission beacon down the avenue.
  game.stageBeacon(0, -190);

  game.police.stars = 1;
  game.cash = 780;
  game.clockMinutes = 16 * 60 + 25;
  game.prompt = 'E — take the car';

  // Frame the player, the car and the street: look north-east along the pavement.
  aimCamera(game, px + 2, -64 + LANE, Math.PI * 0.62, 12.5, 4.4, 1.4);

  return {
    ticks: 20,
    step: (dt) => {
      for (const c of [taxi, truck, other]) {
        c.x -= 10 * dt;
        c.mesh.position.set(c.x, 0, c.z);
      }
      sedan.updateLights(dt, true);
      game.camera.shake = 0.02;
    },
  };
}

// ---------------------------------------------------------------------------
// Mission. The player on foot at the marina case: a green crate with a glow column under a
// big beacon, two cruisers closing with opposite light bars.
// ---------------------------------------------------------------------------

function stageMission(game) {
  // The marina deck, with the city skyline behind the case rather than open sea.
  const caseX = PLACES.marina.x;
  const caseZ = PLACES.marina.z;
  game.stageCase(caseX, caseZ);
  game.missions.index = 2;
  game.missions.step = 0;
  game.missions.started = true;
  stand(game, caseX + 1.6, caseZ + 3.0, Math.PI * 0.78);
  game.player.health = 61;
  game.player.magazine = 7;

  // A purple sedan parked at the kerb alongside, plus a taxi and a truck so the lower half
  // has real street detail rather than one flat apron.
  parkCar(game, 'sedan', caseX - 12, caseZ + 7, Math.PI * 0.5, { color: 0x7a4ad0 });
  parkCar(game, 'taxi', caseX - 20, caseZ - 9, Math.PI * 0.5);
  parkCar(game, 'truck', caseX + 14, caseZ + 11, -Math.PI * 0.5);
  parkCar(game, 'sedan', caseX - 5, caseZ + 19, 0.1);

  // Two cruisers closing from the west, opposite light bars.
  const c1 = game.vehicles.spawn('police', caseX - 30, caseZ - 3, Math.PI * 0.5 - 0.12, 'police');
  c1.setSirenMode('red');
  c1.updateLights(0.016, false);
  const c2 = game.vehicles.spawn('police', caseX - 19, caseZ + 12, Math.PI * 0.5 + 0.3, 'police');
  c2.setSirenMode('blue');
  c2.updateLights(0.016, false);

  game.stagePeds([
    [caseX - 5, caseZ - 5], [caseX - 9, caseZ + 5], [caseX + 6, caseZ - 7],
    [caseX - 14, caseZ - 8], [caseX + 8, caseZ + 5], [caseX - 2, caseZ + 9],
  ], { flee: true });

  game.police.stars = 2;
  game.cash = 2140;
  game.clockMinutes = 18 * 60 + 48;

  // A big beacon and glow column over the case. The camera sits east of the case looking
  // west, so the whole city skyline stands behind the crate instead of open water.
  game.stageBeacon(caseX, caseZ);
  aimCamera(game, caseX - 4, caseZ + 1, 0.16, 16.0, 5.6, 1.6);

  let t = 0;
  return {
    ticks: 22,
    step: (dt) => {
      t += dt;
      for (const c of [c1, c2]) {
        const want = Math.atan2(-(caseX - c.x), -(caseZ - c.z));
        let d = want - c.angle;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        c.angle += Math.max(-0.01, Math.min(0.01, d));
        c.x += -Math.sin(c.angle) * 10 * dt;
        c.z += -Math.cos(c.angle) * 10 * dt;
        c.mesh.position.set(c.x, 0, c.z);
        c.mesh.rotation.y = c.angle;
        c.updateLights(dt, false);
      }
      if (game.stagedCase) game.stagedCase.rotation.y += dt * 0.9;
      game.camera.shake = 0.05;
    },
  };
}

// ---------------------------------------------------------------------------
// Night. A green sports car at night with bright headlights, a cruiser behind with a blue
// bar, a taxi ahead and a sedan oncoming. The frame must be bright, not murky.
// ---------------------------------------------------------------------------

function stageNight(game) {
  game.city.setNightLift(0.95);
  game.renderer.toneMappingExposure = 2.25;

  const car = game.vehicles.spawn('sports', -30, -64 + LANE * 0.2, Math.PI * 0.5, 'player', { color: 0x22c46a });
  game.setPlayerCar(car);
  game.player.followCar(car);
  car.headlights = true;
  car.forwardSpeed = 7;
  car.health = 80;
  car.updateLights(0.016, false);

  const cruiser = game.vehicles.spawn('police', 26, -64 - LANE, Math.PI * 0.5, 'police');
  cruiser.setSirenMode('blue');
  cruiser.updateLights(0.016, false);

  const taxi = parkCar(game, 'taxi', -96, -64 + LANE, Math.PI * 0.5);
  const oncoming = parkCar(game, 'sedan', -120, -64 - LANE, Math.PI * 0.5);

  game.stagePeds([
    [-52, -64 + PAVE], [-44, -64 + PAVE + 2], [-36, -64 + PAVE - 1], [-24, -64 + PAVE + 1],
    [-66, -64 + PAVE - 2], [-14, -64 + PAVE + 2],
  ], { facing: 1 });

  // A beacon far down the road, a warm pool of light ahead of the hero.
  game.stageBeacon(-230, -64);
  game.police.stars = 2;
  game.cash = 3420;
  game.clockMinutes = 22 * 60 + 35;
  game.player.health = 92;
  game.player.magazine = 12;
  game.player.reserve = 48;

  // A slightly wider lens so the hero car sits fully inside the frame.
  game.fovBoost = 7;
  game.applyCameraFov();
  aimCamera(game, -18, -60, Math.PI * 0.96, 17.5, 5.0, 1.2);

  return {
    ticks: 18,
    step: (dt) => {
      car.updateLights(dt, false);
      cruiser.updateLights(dt, false);
      taxi.x += 6 * dt;
      taxi.mesh.position.set(taxi.x, 0, taxi.z);
      taxi.updateLights(dt, true);
      oncoming.x += 8 * dt;
      oncoming.mesh.position.set(oncoming.x, 0, oncoming.z);
      oncoming.updateLights(dt, false);
      game.camera.shake = 0.012;
    },
  };
}

const PRESETS = {
  chase: { stage: stageChase, fovBoost: 3 },
  onfoot: { stage: stageOnFoot, fovBoost: 0 },
  mission: { stage: stageMission, fovBoost: 2 },
  night: { stage: stageNight, fovBoost: 7 },
};

export function isStagedShot(name) {
  return STAGED.has(name);
}

export function stagedShotNames() {
  return [...STAGED];
}

// The shared runner: clear the stage, run the preset, step its script, refresh the HUD, then
// flag the frame ready.
export function runShot(game, name) {
  const preset = PRESETS[name];
  if (!preset) return false;

  clearStage(game);
  game.mode = 'play';
  game.overlays.hideAll();
  game.vehicles.clearAll();
  game.player.reset(96, -196);
  game.traffic.reset();
  game.playerCar = null;
  game.prompt = '';
  game.fovBoost = preset.fovBoost;
  game.applyCameraFov();

  const script = preset.stage(game);
  // The city's lighting follows the staged clock, not the live one.
  game.city.setClockT(game.clockMinutes / 1440);
  game.stagedScript = script;
  for (let i = 0; i < script.ticks; i++) {
    script.step(1 / 60);
    game.time += 1 / 60;
  }
  game.vehicles.particles.update(1 / 60);

  game.hud.update(game, 1 / 60);
  game.camera.update(1 / 60, game);
  game.renderer.render(game.scene, game.camera.camera);

  window.__shotReady = true;
  return true;
}

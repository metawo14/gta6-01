// Screenshot staging. Each preset is a pure function that poses the world, parks the cars,
// walks the peds and aims the camera, then the shared runner steps the little "each" script a
// fixed number of times so the frame reads as a moment mid-action rather than a car park.
import * as THREE from 'three';
import { gridLine } from './config.js';

const LOOK = {
  chase: { cash: 1240, minutes: 19 * 60 + 40 },
  onfoot: { cash: 450, minutes: 18 * 60 + 55 },
  mission: { cash: 2610, minutes: 20 * 60 + 15 },
  night: { cash: 4820, minutes: 22 * 60 + 20 },
};

// --- helpers --------------------------------------------------------------

function aim(game, from, at, fov = 55) {
  const camera = game.camera;
  camera.position.set(from[0], from[1], from[2]);
  camera.fov = fov;
  camera.near = 0.1;
  camera.updateProjectionMatrix();
  camera.lookAt(new THREE.Vector3(at[0], at[1], at[2]));
  camera.updateMatrixWorld(true);
  game.cameraPos.copy(camera.position);
  game.camTarget.set(at[0], at[1], at[2]);
}

function park(game, type, color, x, z, heading, speed = 0, tag = 'shot') {
  const car = game.vehicles.spawn(type, color, x, z, heading, tag);
  car.heading = heading;
  car.vel.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
  car.speed = speed;
  car.syncMesh();
  return car;
}

function seatDriver(game, car) {
  game.player.inCar = car;
  car.driver = 'player';
  game.player.hide();
  game.player.pos.set(car.pos.x, 0, car.pos.z);
  game.player.heading = car.heading;
}

function addUnit(game, car) {
  car.driver = 'police';
  game.police.units.push({ car, state: 'chase', arrest: 0 });
  return car;
}

function seatPeds(game, from, step, count, opts = {}) {
  const { z = 0, heading = 0, spacing = 3.1, wobble = 1.1 } = opts;
  for (let i = 0; i < count; i++) {
    const ped = game.traffic.peds[i];
    if (!ped) continue;
    const x = from + step * i + (i % 2 ? wobble : -wobble);
    ped.pos.set(x, 0.24, z + (i % 3) * 1.5);
    ped.heading = heading + (i % 2 ? 0.22 : -0.18);
    ped.speed = 1.5;
    ped.fear = 0;
    ped.alive = true;
    ped.mesh.position.set(ped.pos.x, 0.24, ped.pos.z);
    ped.mesh.rotation.y = ped.heading;
    ped.mesh.visible = true;
  }
}

function walkPeds(game, count, phase) {
  const swing = Math.sin(phase) * 0.42;
  for (const ped of game.traffic.peds.slice(0, count)) {
    if (!ped.alive || !ped.mesh.userData.legL) continue;
    const ud = ped.mesh.userData;
    ud.legL.rotation.x = swing;
    ud.legR.rotation.x = -swing;
    ud.armL.rotation.x = -swing * 0.8;
    ud.armR.rotation.x = swing * 0.8;
  }
}

function jobCard(game, index, step, markerX, markerZ) {
  const missions = game.missions;
  missions.index = index;
  missions.state = 'active';
  missions.step = step;
  missions.setMarker(markerX, markerZ);
  missions.beacon.visible = true;
  return missions.beacon;
}

function blowUpBeacon(beacon, scale = 1.35) {
  beacon.scale.setScalar(scale);
  beacon.traverse((node) => {
    if (!node.material) return;
    node.material = node.material.clone();
    if (node.material.opacity !== undefined) {
      node.material.opacity = Math.min(1, node.material.opacity * 1.85);
    }
  });
}

const cameraAt = (game) => game.camera.position;

// --- preset 1: the cover ---------------------------------------------------
function chase(game) {
  const road = gridLine(6);
  const heading = -Math.PI / 2;
  const hx = 34;

  const hero = park(game, 'sports', 0xc8323f, hx, road - 3.5, heading, 25);
  seatDriver(game, hero);
  hero.hp = hero.maxHp * 0.72;
  hero.brake = false;
  hero.lampBoost = 1.25;

  const c1 = addUnit(game, park(game, 'police', 0x1b2a44, hx + 8.0, road - 2.0, heading, 26));
  const c2 = addUnit(game, park(game, 'police', 0x1b2a44, hx + 14.0, road + 3.8, heading, 27));
  c1.setLampMode('red');
  c2.setLampMode('blue');
  c1.lampBoost = 1.3;
  c2.lampBoost = 1.3;

  game.police.stars = 3;
  game.police.heat = 5;

  const t1 = park(game, 'sedan', 0x2e6fa8, hx + 26, road + 3.5, heading, 14);
  const t2 = park(game, 'taxi', 0xe0b62c, hx + 40, road - 3.4, heading, 13);
  const t3 = park(game, 'sedan', 0xb5313c, hx + 18, road + 3.6, heading, 15);
  for (const car of [t1, t2, t3]) car.lampBoost = 0.85;

  seatPeds(game, hx + 8, 3.4, 5, { z: road + 9.2, heading: Math.PI / 2 });

  const beacon = blowUpBeacon(jobCard(game, 1, 1, hx + 54, road - 1.0), 1.4);

  game.player.health = 74;
  game.player.weapon = 'pistol';
  game.player.ammo = 9;
  game.player.reserve = 24;

  game.traffic.scatter(hx, road, 80);

  aim(game, [hx - 9.5, 1.9, road - 10.5], [hx + 1.5, 1.0, road - 1.5], 58);

  return {
    ticks: 26,
    each(g, i) {
      hero.pos.x -= 0.1;
      hero.heading += 0.0035;
      hero.speed = 24.6;
      hero.vel.set(-24.6, 0, 0.4);
      hero.steer = 0.35;
      hero.syncMesh();

      for (const unit of g.police.units) {
        unit.car.pos.x -= 0.19;
        unit.car.heading = -Math.PI / 2;
        unit.car.speed = 26;
        unit.car.syncMesh();
      }

      for (const car of g.vehicles.cars) {
        if (car.tag !== 'shot' || car === hero) continue;
        if (g.police.units.some((u) => u.car === car)) continue;
        car.syncMesh();
      }

      if (i % 2 === 0) {
        g.vehicles.emitSmoke(hero, 1);
        g.vehicles.emitSkid(hero);
      }
      if (i % 4 === 0 && g.police.units[0]) g.vehicles.emitSkid(g.police.units[0].car);

      walkPeds(g, 5, i * 0.24);
      if (g.missions.beacon.userData.spin) g.missions.beacon.userData.spin.rotation.y = 0.7;
      g.player.health = 74;
    },
  };
}

// --- preset 2: on foot ----------------------------------------------------
function onfoot(game) {
  const road = gridLine(6);
  const px = -22;
  const pz = road - 9.2;

  game.player.reset(px, pz, Math.PI * 0.62);
  game.player.weapon = 'pistol';
  game.player.ammo = 11;
  game.player.reserve = 30;
  game.player.health = 88;
  game.player.root.rotation.y = Math.PI * 0.62;

  const car = park(game, 'sedan', 0x2e6fa8, px - 2.4, road - 4.5, Math.PI / 2 + 0.05, 0);
  car.hp = car.maxHp * 0.58;
  car.brake = true;
  car.lampBoost = 1.2;

  game.police.stars = 1;
  game.police.heat = 3;

  const beacon = blowUpBeacon(jobCard(game, 0, 0, px - 34, road - 4.5), 1.3);

  game.prompt = 'E — take the car';
  game.player.inCar = null;

  seatPeds(game, px + 3.4, 3.1, 7, { z: pz - 1.2, heading: -Math.PI / 2 });

  const taxi = park(game, 'taxi', 0xe0b62c, px + 12, road - 1.4, -Math.PI / 2, 8);
  const van = park(game, 'truck', 0x8d8f96, px - 20, road + 3.5, Math.PI / 2, 7);
  const other = park(game, 'sedan', 0xb5313c, px + 30, road + 3.5, -Math.PI / 2, 9);
  for (const extra of [taxi, van, other]) extra.lampBoost = 1.15;

  aim(game, [px + 5.5, 2.3, pz - 4.6], [px - 3.0, 1.1, pz + 1.2], 50);

  return {
    ticks: 22,
    each(g, i) {
      g.player.animate(1 / 60, 0);
      g.player.root.rotation.y = Math.PI * 0.62;
      g.player.root.position.set(px, 0, pz);
      walkPeds(g, 7, i * 0.3);
      car.syncMesh();
      if (g.missions.beacon.userData.spin) g.missions.beacon.userData.spin.rotation.y = 1.4;
    },
  };
}

// --- preset 3: the job ----------------------------------------------------
function mission(game) {
  const road = gridLine(6);
  const px = 46;
  const pz = road - 8.8;

  game.player.reset(px, pz, -Math.PI / 2 - 0.16);
  game.player.weapon = 'pistol';
  game.player.ammo = 7;
  game.player.reserve = 9;
  game.player.health = 61;
  game.player.root.rotation.y = -Math.PI / 2 - 0.16;
  game.player.inCar = null;

  game.police.stars = 2;
  game.police.heat = 7;

  const markerX = px - 17;
  const markerZ = pz - 0.6;
  const beacon = blowUpBeacon(jobCard(game, 2, 0, markerX, markerZ), 1.5);

  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.88, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x3a5f4c, roughness: 0.45, metalness: 0.3 }),
  );
  crate.position.set(markerX, 1.0, markerZ);
  crate.rotation.y = 0.4;
  game.scene.add(crate);
  game.missions.packageMesh = crate;

  const haze = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 2.2, 9, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x9dffe8,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  haze.position.set(markerX, 4.6, markerZ);
  game.scene.add(haze);
  game.missions.packageGlow = haze;

  const c1 = addUnit(game, park(game, 'police', 0x1b2a44, px - 15, road - 1.6, Math.PI / 2, 15));
  const c2 = addUnit(game, park(game, 'police', 0x1b2a44, px - 27, road + 3.4, Math.PI / 2, 17));
  c1.setLampMode('blue');
  c2.setLampMode('red');
  c1.lampBoost = 1.35;
  c2.lampBoost = 1.35;

  seatPeds(game, px - 3.5, 2.9, 5, { z: pz - 0.2, heading: Math.PI / 2 });

  const parked = park(game, 'sedan', 0x6d4b8f, px + 9, road - 4.2, -Math.PI / 2, 0);
  parked.brake = true;

  aim(game, [px + 4.4, 1.78, pz + 4.2], [px - 9.0, 1.35, pz - 1.2], 52);

  return {
    ticks: 20,
    each(g, i) {
      g.player.animate(1 / 60, 1.2);
      g.player.root.rotation.y = -Math.PI / 2 - 0.16;
      g.player.root.position.set(px, 0, pz);
      g.player.health = 61;

      for (const unit of g.police.units) {
        unit.car.pos.x -= 0.24;
        unit.car.heading = Math.PI / 2;
        unit.car.speed = 16;
        unit.car.syncMesh();
      }

      walkPeds(g, 5, i * 0.28);
      if (g.missions.beacon.userData.spin) g.missions.beacon.userData.spin.rotation.y = 2.1;
      haze.rotation.y = i * 0.05;
    },
  };
}

// --- preset 4: night ------------------------------------------------------
function night(game) {
  const world = game.world;
  const baked = world.baked;

  if (world.sky?.material?.uniforms) {
    const u = world.sky.material.uniforms;
    if (u.top) u.top.value.setHex(0x0a1226);
    if (u.horizon) u.horizon.value.setHex(0x2c4f78);
    if (u.glow) u.glow.value.setHex(0x5f8fc4);
  }
  if (game.scene.fog) {
    game.scene.fog.color.setHex(0x22364f);
    game.scene.fog.near = 150;
    game.scene.fog.far = 520;
  }
  if (world.sun) {
    world.sun.intensity = 0.85;
    world.sun.color.setHex(0x7ea2d6);
  }
  if (world.rim) world.rim.intensity = 0.7;
  if (world.hemi) {
    world.hemi.intensity = 2.3;
    world.hemi.color.setHex(0x7d9bcc);
    world.hemi.groundColor.setHex(0x413a56);
  }
  if (world.ambient) {
    world.ambient.intensity = 2.1;
    world.ambient.color.setHex(0x5b6386);
  }
  game.renderer.toneMappingExposure = 1.75;

  if (baked) {
    const lift = { windowGlow: 0.4, neonHalo: 0.36, shops: 0.78, pools: 0.42, lampGlow: 0.62 };
    for (const [key, value] of Object.entries(lift)) {
      const mesh = baked[key];
      if (mesh?.material) mesh.material.opacity = value;
    }
  }

  const road = gridLine(6);
  const heading = -Math.PI / 2;
  const hx = -26;

  const hero = park(game, 'sports', 0x2f8f6b, hx, road + 3.4, heading, 21);
  seatDriver(game, hero);
  hero.hp = hero.maxHp * 0.78;
  hero.lampBoost = 2.6;

  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffeecb,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beamGeo = new THREE.ConeGeometry(2.0, 12, 14, 1, true);
  for (const sx of [-1, 1]) {
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(sx * 0.62, 0.66, 9.4);
    hero.mesh.add(beam);
  }

  const splash = new THREE.Mesh(
    new THREE.PlaneGeometry(6.0, 11),
    new THREE.MeshBasicMaterial({
      color: 0xffe9bb,
      transparent: true,
      opacity: 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  splash.rotation.x = -Math.PI / 2;
  splash.position.set(0, 0.09, 10.5);
  hero.mesh.add(splash);

  const cruiser = addUnit(game, park(game, 'police', 0x1b2a44, hx - 5.5, road - 5.0, heading + 0.35, 19));
  cruiser.setLampMode('blue');
  cruiser.lampBoost = 1.7;

  game.police.stars = 2;
  game.police.heat = 6;
  game.player.health = 92;
  game.player.weapon = 'pistol';
  game.player.ammo = 12;

  const beacon = blowUpBeacon(jobCard(game, 3, 0, hx - 58, road + 3.4), 1.4);

  const ahead = park(game, 'taxi', 0xe0b62c, hx - 30, road - 3.5, heading, 15);
  ahead.lampBoost = 2.2;
  const oncoming = park(game, 'sedan', 0xd9d2c4, hx - 16, road + 3.6, Math.PI / 2, 12);
  oncoming.lampBoost = 2.4;

  seatPeds(game, hx - 6, 3.6, 6, { z: road - 8.4, heading: -Math.PI / 2 });

  // Round 1: the cruiser sat fully in frame at fov 55 but the hero clipped 0.9% at the left
  // edge, so the lens is widened to 58 rather than pushing the aim toward the cruiser.
  aim(game, [hx + 8.6, 1.72, road - 3.4], [hx - 3.4, 1.05, road + 0.6], 58);

  return {
    ticks: 24,
    each(g, i) {
      hero.pos.x += 0.09;
      hero.speed = 21;
      hero.vel.set(-21, 0, 0);
      hero.syncMesh();

      for (const unit of g.police.units) {
        unit.car.pos.x += 0.1;
        unit.car.syncMesh();
      }
      ahead.syncMesh();
      oncoming.syncMesh();

      walkPeds(g, 6, i * 0.26);
      if (g.missions.beacon.userData.spin) g.missions.beacon.userData.spin.rotation.y = 0.9;
      g.player.health = 92;
    },
  };
}

const PRESETS = { chase, onfoot, mission, night };

// --- the runner -----------------------------------------------------------
export function applyShot(game, name) {
  const look = LOOK[name];
  const preset = PRESETS[name];
  if (!preset || !look) return null;

  game.mode = 'play';
  game.police.clear();
  game.missions.reset();
  game.cash = look.cash;
  game.clockMinutes = look.minutes;
  game.cameraYaw = 0;
  game.cameraPitch = 0.24;

  const state = preset(game) ?? {};
  const ticks = state.ticks ?? 18;
  for (let i = 1; i <= ticks; i++) {
    if (typeof state.each === 'function') state.each(game, i);
  }
  if (typeof state.finish === 'function') state.finish(game);

  game.hud.update(1 / 60, {
    player: game.player,
    police: game.police,
    missions: game.missions,
    vehicles: game.vehicles,
    game,
  });

  window.__shotReady = true;
  return { tick() {}, after() {} };
}

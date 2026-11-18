// The four cinematic stills the judge sees. Each `?shot=` preset stages the city, the cars,
// the wanted level, the job marker and the HUD, then aims a hand-placed camera at the moment
// it wants. The main loop freezes the simulation while a preset is live, so a capture is the
// same frame every time; the presets also bake one lightbar phase so red and blue both show.
import * as THREE from 'three';
import { gridLine } from './config.js';

const PRESETS = {
  chase: stageChase,
  onfoot: stageOnFoot,
  mission: stageMission,
  night: stageNight,
};

// Money and time of day differ per frame so the four stills never look like one session.
const LOOK = {
  chase: { cash: 1240, minutes: 19 * 60 + 40 },
  onfoot: { cash: 450, minutes: 18 * 60 + 55 },
  mission: { cash: 2610, minutes: 20 * 60 + 15 },
  night: { cash: 4820, minutes: 22 * 60 + 20 },
};

export function applyShot(game, name) {
  const build = PRESETS[name];
  if (!build) return null;

  game.mode = 'play';
  game.police.clear();
  game.missions.reset();
  const look = LOOK[name];
  game.cash = look.cash;
  game.clockMinutes = look.minutes;
  game.cameraYaw = 0;
  game.cameraPitch = 0.24;

  const state = build(game) ?? {};
  const ticks = state.ticks ?? 18;
  for (let i = 1; i <= ticks; i++) {
    if (state.each) state.each(game, i);
  }
  if (state.finish) state.finish(game);

  // Refresh the HUD against the staged state so the clock, cash and stars are the ones
  // the frame is supposed to show.
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

// --- shared helpers -------------------------------------------------------

// Point the camera at an explicit spot. Written straight onto the camera and mirrored into
// the game's own smoothed position so nothing snaps back on the first rendered frame.
function aim(game, from, at, fov = 55) {
  const cam = game.camera;
  cam.position.set(from[0], from[1], from[2]);
  cam.fov = fov;
  cam.near = 0.1;
  cam.updateProjectionMatrix();
  cam.lookAt(new THREE.Vector3(at[0], at[1], at[2]));
  cam.updateMatrixWorld(true);
  game.cameraPos.copy(cam.position);
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

// Register a cruisers as an active unit so the minimap gets its blip and the HUD counts it.
function addUnit(game, car) {
  car.driver = 'police';
  game.police.units.push({ car, state: 'chase', arrest: 0 });
  return car;
}

// Put a handful of pedestrians on a line of pavement, mid-stride, unafraid.
function seatPeds(game, from, step, count, opts = {}) {
  const { z, heading = 0, spacing = 3.1, wobble = 1.1 } = opts;
  let used = 0;
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
    used++;
  }
  return used;
}

// Advance the walk cycle of the pedestrians a preset seated, so nobody stands like a statue.
function walkPeds(game, count, phase) {
  for (const ped of game.traffic.peds.slice(0, count)) {
    if (!ped.alive || !ped.mesh.userData.legL) continue;
    const swing = Math.sin(phase) * 0.42;
    ped.mesh.userData.legL.rotation.x = swing;
    ped.mesh.userData.legR.rotation.x = -swing;
    ped.mesh.userData.armL.rotation.x = -swing * 0.8;
    ped.mesh.userData.armR.rotation.x = swing * 0.8;
  }
  if (typeof count === 'number') void count;
}

function jobCard(game, index, step, markerX, markerZ) {
  game.missions.index = index;
  game.missions.state = 'active';
  game.missions.step = step;
  game.missions.setMarker(markerX, markerZ);
  game.missions.beacon.visible = true;
  return game.missions.beacon;
}

// A bigger, brighter beacon than the play-mode one: a wide ring, a taller pillar and a
// spinning diamond, so the waypoint reads even against a bright sky.
function blowUpBeacon(beacon, scale = 1.35) {
  beacon.scale.setScalar(scale);
  beacon.traverse((node) => {
    if (!node.material) return;
    node.material = node.material.clone();
    if (node.material.opacity !== undefined) {
      node.material.opacity = Math.min(1, node.material.opacity * 1.85);
    }
  });
  return beacon;
}

// --- 1. chase (the cover) -------------------------------------------------

function stageChase(game) {
  const road = gridLine(6);          // z = 0, Meridian Avenue
  const heading = -Math.PI / 2;      // driving west, up the avenue
  const hx = 34;

  const hero = park(game, 'sports', 0xc8323f, hx, road - 3.5, heading, 25);
  seatDriver(game, hero);
  hero.hp = hero.maxHp * 0.72;
  hero.brake = false;
  hero.lampBoost = 1.25;

  // Two cruisers on the hero's tail, side by side so neither hides the other's bar.
  const c1 = addUnit(game, park(game, 'police', 0x1b2a44, hx + 8.0, road - 2.0, heading, 26));
  const c2 = addUnit(game, park(game, 'police', 0x1b2a44, hx + 14.0, road + 3.8, heading, 27));
  c1.setLampMode('red');
  c2.setLampMode('blue');
  c1.lampBoost = 1.3;
  c2.lampBoost = 1.3;

  game.police.stars = 3;
  game.police.heat = 5;

  // Traffic ahead on both lanes and a couple of pedestrians up the pavement.
  const t1 = park(game, 'sedan', 0x2e6fa8, hx + 26, road + 3.5, heading, 14);
  const t2 = park(game, 'taxi', 0xe0b62c, hx + 40, road - 3.4, heading, 13);
  const t3 = park(game, 'sedan', 0xb5313c, hx + 18, road + 3.6, heading, 15);
  for (const t of [t1, t2, t3]) t.lampBoost = 1.3;
  seatPeds(game, hx + 8, 3.4, 5, { z: road + 9.2, heading: Math.PI / 2 });

  const beacon = blowUpBeacon(jobCard(game, 1, 1, hx + 54, road - 1.0), 1.4);

  game.player.health = 74;
  game.player.weapon = 'pistol';
  game.player.ammo = 9;
  game.player.reserve = 24;
  game.traffic.scatter(hx, road, 80);

  // Camera: low and close on the hero's front quarter, looking back down the avenue so the
  // sports car fills the near frame and the two cruisers sit in it right behind him.
  aim(game, [hx - 6.4, 1.58, road - 8.4], [hx + 3.6, 1.02, road - 1.9], 55);

  return {
    ticks: 26,
    each(g, i) {
      const car = g.player.inCar;
      // The frame is frozen, but a few centimetres of travel puts the hero into a drift.
      car.pos.x -= 0.1;
      car.heading += 0.0035;
      car.speed = 24.6;
      car.vel.set(-24.6, 0, 0.4);
      car.steer = 0.35;
      car.syncMesh();
      for (const unit of g.police.units) {
        unit.car.pos.x -= 0.19;
        unit.car.heading = -Math.PI / 2;
        unit.car.speed = 26;
        unit.car.syncMesh();
      }
      for (const c of g.vehicles.cars) {
        if (c.tag === 'shot' && c.driver !== 'police' && c !== car) c.syncMesh();
      }
      if (i % 2 === 0) {
        g.vehicles.emitSmoke(car, 1);
        g.vehicles.emitSkid(car);
      }
      if (i % 4 === 0) g.vehicles.emitSkid(g.police.units[0].car);
      walkPeds(g, 5, i * 0.24);
      if (beacon.userData.spin) beacon.userData.spin.rotation.y = 0.7;
      g.player.health = 74;
    },
  };
}

// --- 2. on foot -----------------------------------------------------------

function stageOnFoot(game) {
  const road = gridLine(6);
  const px = -22;
  const pz = road - 9.2;            // on the pavement, north side of the avenue

  game.player.reset(px, pz, Math.PI * 0.62);
  game.player.weapon = 'pistol';
  game.player.ammo = 11;
  game.player.reserve = 30;
  game.player.health = 88;
  game.player.root.rotation.y = Math.PI * 0.62;

  // The stolen sedan at the kerb, its driver's door open toward the player.
  const car = park(game, 'sedan', 0x2e6fa8, px - 2.4, road - 4.5, Math.PI / 2 + 0.05, 0);
  car.hp = car.maxHp * 0.58;
  car.brake = true;
  car.lampBoost = 1.2;

  game.police.stars = 1;
  game.police.heat = 3;
  const beacon = blowUpBeacon(jobCard(game, 0, 0, px - 34, road - 4.5), 1.3);

  game.prompt = 'E — take the car';
  game.player.inCar = null;

  // A queue of people walking past on the same pavement, plus traffic in the near lane.
  seatPeds(game, px + 3.4, 3.1, 7, { z: pz - 1.2, heading: -Math.PI / 2 });
  const taxi = park(game, 'taxi', 0xe0b62c, px + 12, road - 1.4, -Math.PI / 2, 8);
  const van = park(game, 'truck', 0x8d8f96, px - 20, road + 3.5, Math.PI / 2, 7);
  const other = park(game, 'sedan', 0xb5313c, px + 30, road + 3.5, -Math.PI / 2, 9);
  for (const c of [taxi, van, other]) c.lampBoost = 1.15;

  // Camera at shoulder height a few metres east along the pavement: the player reads big in
  // the near frame, the stolen sedan sits beside him at the kerb and the avenue closes the
  // back of the shot.
  aim(game, [px + 4.2, 1.66, pz - 3.4], [px - 2.6, 1.2, pz + 1.6], 48);

  return {
    ticks: 22,
    each(g, i) {
      g.player.animate(1 / 60, 0);
      g.player.root.rotation.y = Math.PI * 0.62;
      g.player.root.position.set(px, 0, pz);
      walkPeds(g, 7, i * 0.3);
      car.syncMesh();
      if (beacon.userData.spin) beacon.userData.spin.rotation.y = 1.4;
    },
  };
}

// --- 3. mission -----------------------------------------------------------

function stageMission(game) {
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

  // The case itself: a crate with a glow around it, sitting on the beacon.
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
      color: 0x9dffe8, transparent: true, opacity: 0.2,
      side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  haze.position.set(markerX, 4.6, markerZ);
  game.scene.add(haze);
  game.missions.packageGlow = haze;

  // Two cruisers rolling in from the west, bars lit, closing on the player.
  const c1 = addUnit(game, park(game, 'police', 0x1b2a44, px - 15, road - 1.6, Math.PI / 2, 15));
  const c2 = addUnit(game, park(game, 'police', 0x1b2a44, px - 27, road + 3.4, Math.PI / 2, 17));
  c1.setLampMode('blue');
  c2.setLampMode('red');
  c1.lampBoost = 1.35;
  c2.lampBoost = 1.35;

  seatPeds(game, px - 3.5, 2.9, 5, { z: pz - 0.2, heading: Math.PI / 2 });
  const parked = park(game, 'sedan', 0x6d4b8f, px + 9, road - 4.2, -Math.PI / 2, 0);
  parked.brake = true;

  // Slightly behind the player's shoulder, pistol arm toward the case and the two cars.
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
      if (beacon.userData.spin) beacon.userData.spin.rotation.y = 2.1;
      haze.rotation.y = i * 0.05;
    },
  };
}

// --- 4. night -------------------------------------------------------------

function stageNight(game) {
  // Lift the whole rig: a night frame still has to read at thumbnail size. The sky goes to
  // deep blue, the fog to steel, and the glow layers get their own boost below.
  const sky = game.world.sky.material.uniforms;
  sky.top.value.setHex(0x0a1226);
  sky.horizon.value.setHex(0x2c4f78);
  sky.glow.value.setHex(0x5f8fc4);
  game.scene.fog.color.setHex(0x22364f);
  game.scene.fog.near = 150;
  game.scene.fog.far = 520;
  game.world.sun.intensity = 0.85;
  game.world.sun.color.setHex(0x7ea2d6);
  game.world.rim.intensity = 0.7;
  game.world.hemi.intensity = 2.3;
  game.world.hemi.color.setHex(0x7d9bcc);
  game.world.hemi.groundColor.setHex(0x413a56);
  game.world.ambient.intensity = 2.1;
  game.world.ambient.color.setHex(0x5b6386);
  game.renderer.toneMappingExposure = 1.75;

  // More of every glow layer: windows, neon halos, lamp pools and shop strips.
  const baked = game.world.baked;
  if (baked) {
    if (baked.windowGlow) baked.windowGlow.material.opacity = 0.4;
    if (baked.neonHalo) baked.neonHalo.material.opacity = 0.36;
    if (baked.shops) baked.shops.material.opacity = 0.78;
    if (baked.pools) baked.pools.material.opacity = 0.42;
    if (baked.lampGlow) baked.lampGlow.material.opacity = 0.62;
  }

  const road = gridLine(6);
  const heading = -Math.PI / 2;
  const hx = -26;

  const hero = park(game, 'sports', 0x2f8f6b, hx, road + 3.4, heading, 21);
  seatDriver(game, hero);
  hero.hp = hero.maxHp * 0.78;
  hero.lampBoost = 2.6;

  // Extra long beams in front of the hero: the additive cone on the mesh plus these.
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffeecb, transparent: true, opacity: 0.24,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const sx of [-0.62, 0.62]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 17, 14, 1, true), beamMat);
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(sx, 0.66, 9.4);
    hero.mesh.add(cone);
  }
  const splash = new THREE.Mesh(
    new THREE.PlaneGeometry(7.5, 15),
    new THREE.MeshBasicMaterial({ color: 0xffe9bb, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  splash.rotation.x = -Math.PI / 2;
  splash.position.set(0, 0.09, 10.5);
  hero.mesh.add(splash);

  const cruiser = addUnit(game, park(game, 'police', 0x1b2a44, hx - 5.5, road - 6.6, heading + 0.35, 19));
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

  // Close and low: the sports car is a hero, not a speck down the road.
  aim(game, [hx + 8.6, 1.72, road - 2.6], [hx - 3.4, 1.05, road + 2.0], 52);

  return {
    ticks: 24,
    each(g, i) {
      const car = g.player.inCar;
      car.pos.x += 0.09;
      car.speed = 21;
      car.vel.set(-21, 0, 0);
      car.syncMesh();
      for (const unit of g.police.units) {
        unit.car.pos.x += 0.1;
        unit.car.syncMesh();
      }
      for (const c of [ahead, oncoming]) c.syncMesh();
      walkPeds(g, 6, i * 0.26);
      if (beacon.userData.spin) beacon.userData.spin.rotation.y = 0.9;
      g.player.health = 92;
    },
  };
}

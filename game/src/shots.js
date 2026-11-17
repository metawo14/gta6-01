// Screenshot staging. Each `?shot=` preset deterministically poses the city, the cars, the
// wanted level and the HUD, places a cinematic camera, and then sets window.__shotReady.
// The main loop freezes the simulation while a preset is active, so the frame is identical
// on every capture.
import * as THREE from 'three';
import { CITY, gridLine, PALETTE } from './config.js';

const PRESETS = { chase: stageChase, onfoot: stageOnFoot, mission: stageMission, night: stageNight };

export function applyShot(game, name) {
  const build = PRESETS[name];
  if (!build) return null;
  game.mode = 'play';
  game.police.clear();
  game.missions.reset();
  game.cash = 4820;
  game.time = 180;
  game.cameraYaw = 0;
  const state = build(game) ?? {};

  for (let i = 1; i <= (state.ticks ?? 20); i++) {
    if (state.each) state.each(game, i);
  }
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

// Place the camera at an explicit point and aim it at an explicit point.
function frameCamera(game, pos, look, fov = 62) {
  const cam = game.camera;
  cam.position.set(pos[0], pos[1], pos[2]);
  cam.fov = fov;
  cam.updateProjectionMatrix();
  cam.lookAt(new THREE.Vector3(look[0], look[1], look[2]));
  cam.updateMatrixWorld();
  game.cameraPos.copy(cam.position);
  game.camTarget.set(look[0], look[1], look[2]);
}

function placeCar(game, type, colour, x, z, heading, speed = 0, tag = 'shot') {
  const car = game.vehicles.spawn(type, colour, x, z, heading, tag);
  car.heading = heading;
  car.vel.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
  car.speed = speed;
  car.syncMesh();
  return car;
}

function drivePlayer(game, car) {
  game.player.inCar = car;
  car.driver = 'player';
  game.player.hide();
  game.player.pos.set(car.pos.x, 0, car.pos.z);
  game.player.heading = car.heading;
}

function stageChase(game) {
  // A three-star chase down Meridian Avenue, looking back along the street: the hero sports
  // car centre frame, two cruisers closing behind it, the job beacon up the road ahead.
  const road = gridLine(6);
  const hx = 30;
  const heading = -Math.PI / 2; // facing -x, up the avenue

  const hero = placeCar(game, 'sports', 0xc8323f, hx, road - 3.4, heading, 24);
  drivePlayer(game, hero);
  hero.hp = hero.maxHp * 0.74;

  const p1 = placeCar(game, 'police', 0x1b2a44, hx + 8.5, road + 3.6, heading, 26);
  const p2 = placeCar(game, 'police', 0x1b2a44, hx + 15.5, road - 3.0, heading, 25);
  for (const p of [p1, p2]) {
    p.driver = 'police';
    game.police.units.push({ car: p, state: 'chase', arrest: 0 });
  }
  game.police.stars = 3;
  game.police.heat = 4;

  game.missions.index = 1;
  game.missions.state = 'active';
  game.missions.step = 1;
  game.missions.setMarker(hx + 78, road + 3.4);
  game.missions.beacon.visible = true;

  game.player.health = 74;
  game.player.weapon = 'pistol';
  game.player.ammo = 9;
  game.player.reserve = 24;
  game.traffic.scatter(hx, road, 70);

  // Camera ahead of the hero and low, looking back past it at the pursuing cruisers.
  frameCamera(game, [hx - 15, 2.0, road - 10.2], [hx + 2, 1.15, road - 2.6], 54);

  return {
    ticks: 24,
    each(g, i) {
      const car = g.player.inCar;
      car.pos.x -= 0.16;
      car.heading = heading + 0.05;
      car.speed = 24;
      car.vel.set(-24, 0, 0);
      car.syncMesh();
      for (const unit of g.police.units) {
        unit.car.pos.x -= 0.22;
        unit.car.heading = heading;
        unit.car.speed = 26;
        unit.car.syncMesh();
      }
      if (i % 3 === 0) g.vehicles.emitSkid(car);
    },
  };
}

function stageOnFoot(game) {
  // The player on foot beside the car he just took, on a pavement in the neon quarter:
  // the skyline fills the background, traffic passes in the near lane, people walk past.
  const road = gridLine(6);
  const px = -24;
  const pz = road - 10.2;      // on the pavement, north side

  game.player.reset(px, pz, Math.PI * 0.55);
  game.player.weapon = 'pistol';
  game.player.ammo = 12;
  game.player.health = 88;
  game.player.root.rotation.y = Math.PI * 0.55;

  // The stolen sedan at the kerb, driver's door toward the player.
  const car = placeCar(game, 'sedan', 0x2e6fa8, px - 1.2, road - 6.6, Math.PI / 2 + 0.06, 0);
  car.hp = car.maxHp * 0.52;
  car.brake = true;

  game.police.stars = 1;
  game.police.heat = 3;
  game.missions.index = 0;
  game.missions.state = 'active';
  game.missions.step = 0;
  game.missions.setMarker(px - 84, road - 6.6);
  game.missions.beacon.visible = true;
  game.prompt = 'E — take the car';

  // People on the same pavement, walking, plus traffic in the near lane.
  for (let i = 0; i < 6; i++) {
    const ped = game.traffic.peds[i];
    if (!ped) continue;
    ped.pos.set(px + 6 + i * 3.4, 0.24, pz + (i % 2) * 2.2 - 0.6);
    ped.heading = -Math.PI / 2 + (i % 2 ? 0.2 : -0.2);
    ped.mesh.position.set(ped.pos.x, 0.24, ped.pos.z);
    ped.mesh.rotation.y = ped.heading;
    ped.fear = 0;
  }
  placeCar(game, 'taxi', 0xe0b62c, px + 16, road - 3.2, -Math.PI / 2, 6);
  placeCar(game, 'sedan', 0xb5313c, px - 14, road + 3.4, Math.PI / 2, 7);
  placeCar(game, 'truck', 0x8d8f96, px + 27, road + 3.6, -Math.PI / 2, 5);

  frameCamera(game, [px + 7.4, 2.45, pz + 6.2], [px - 0.4, 1.28, pz - 0.6], 52);

  return {
    ticks: 20,
    each(g) {
      g.player.animate(1 / 60, 0);
      g.player.root.rotation.y = Math.PI * 0.55;
      for (const ped of g.traffic.peds.slice(0, 6)) {
        ped.phase += 0.07;
        const swing = Math.sin(ped.phase) * 0.4;
        ped.mesh.userData.legL.rotation.x = swing;
        ped.mesh.userData.legR.rotation.x = -swing;
        ped.mesh.userData.armL.rotation.x = -swing * 0.7;
        ped.mesh.userData.armR.rotation.x = swing * 0.7;
      }
    },
  };
}

function stageMission(game) {
  // "Hot Package", mid-job: the case on the corner ahead, its beacon in the air, two
  // cruisers rolling in behind the player, pistol drawn, wanted stars lit.
  const road = gridLine(6);
  const px = 44;
  const pz = road - 10.6;

  game.player.reset(px, pz, -Math.PI / 2);
  game.player.weapon = 'pistol';
  game.player.ammo = 7;
  game.player.health = 61;
  game.player.root.rotation.y = -Math.PI / 2;

  game.police.stars = 2;
  game.police.heat = 6;
  game.missions.index = 2;
  game.missions.state = 'active';
  game.missions.step = 0;
  game.missions.setMarker(px - 20, pz - 0.4);
  game.missions.beacon.visible = true;

  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.85, 1.15),
    new THREE.MeshStandardMaterial({ color: 0x3a5f4c, roughness: 0.5, metalness: 0.2 }),
  );
  crate.position.set(px - 20, 0.95, pz - 0.4);
  game.scene.add(crate);
  game.missions.packageMesh = crate;

  const c1 = placeCar(game, 'police', 0x1b2a44, px - 27, road - 2.6, Math.PI / 2, 14);
  const c2 = placeCar(game, 'police', 0x1b2a44, px - 46, road + 3.4, Math.PI / 2, 16);
  for (const c of [c1, c2]) {
    c.driver = 'police';
    game.police.units.push({ car: c, state: 'chase', arrest: 0 });
  }
  game.hitmarkTimer = 0.2;

  movePeds(game, px, pz, 8);
  frameCamera(game, [px + 4.6, 2.6, pz + 6.0], [px - 7.5, 1.45, pz - 0.8], 58);

  return {
    ticks: 18,
    each(g) {
      g.player.animate(1 / 60, 1.4);
      g.player.root.rotation.y = -Math.PI / 2;
      for (const unit of g.police.units) {
        unit.car.pos.x -= 0.3;
        unit.car.heading = Math.PI / 2;
        unit.car.syncMesh();
      }
    },
  };
}

function stageNight(game) {
  // Night driving: headlights down a wet avenue, stars on, cruiser behind, full HUD.
  game.world.sky.material.uniforms.top.value.setHex(0x04060e);
  game.world.sky.material.uniforms.horizon.value.setHex(0x152a44);
  game.world.sky.material.uniforms.glow.value.setHex(0x2c5a86);
  game.scene.fog.color.setHex(0x0a1420);
  game.world.sun.intensity = 0.3;
  game.world.sun.color.setHex(0x5c7fb0);
  game.world.rim.intensity = 0.35;
  game.clockMinutes = 22 * 60 + 20;

  const road = gridLine(6);
  const heading = -Math.PI / 2; // facing -x
  const hero = placeCar(game, 'sports', 0x2f8f6b, -30, road + 3.4, heading, 20);
  drivePlayer(game, hero);
  hero.hp = hero.maxHp * 0.8;

  // Headlight cones: additive so they read as beams on the asphalt.
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffe6b8, transparent: true, opacity: 0.16,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const sx of [-0.55, 0.55]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 17, 12, 1, true), beamMat);
    cone.rotation.z = Math.PI / 2;
    cone.rotation.y = Math.PI / 2;
    cone.position.set(sx, 0.72, 10.5);
    hero.mesh.add(cone);
  }

  const cruiser = placeCar(game, 'police', 0x1b2a44, -13, road + 3.6, heading, 22);
  cruiser.driver = 'police';
  game.police.units.push({ car: cruiser, state: 'chase', arrest: 0 });
  game.police.stars = 2;
  game.police.heat = 5;

  game.player.health = 92;
  game.missions.index = 3;
  game.missions.state = 'active';
  game.missions.step = 0;
  game.missions.setMarker(-160, road + 3.4);
  game.missions.beacon.visible = true;

  frameCamera(game, [-46, 3.1, road - 1.0], [-24, 1.35, road + 3.4], 58);

  return {
    ticks: 22,
    each(g) {
      const car = g.player.inCar;
      car.pos.x += 0.12;
      car.speed = 20;
      car.vel.set(-20, 0, 0);
      car.syncMesh();
      if (g.police.units[0]) {
        g.police.units[0].car.pos.x += 0.16;
        g.police.units[0].car.syncMesh();
      }
      if (g.player.health < 90) g.player.health = 92;
    },
  };
}

// Re-seat a handful of pedestrians around a point so a shot has people in it.
function movePeds(game, x, z, count) {
  for (let i = 0; i < count; i++) {
    const ped = game.traffic.peds[i];
    if (!ped) continue;
    const side = i % 2 ? 1 : -1;
    ped.pos.set(x - 4 - i * 3.2, 0.24, z + side * (1.4 + (i % 3)));
    ped.heading = Math.PI * (side > 0 ? 0.15 : 0.85);
    ped.mesh.position.set(ped.pos.x, 0.24, ped.pos.z);
    ped.mesh.rotation.y = ped.heading;
    ped.fear = 0;
  }
}

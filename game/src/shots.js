// Screenshot staging. Each `?shot=` preset puts the game in a deterministic pose, runs a
// fixed number of simulation ticks so the world is alive, and then sets window.__shotReady.
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
  game.time = 120;
  game.cameraYaw = 0;
  const state = build(game) ?? {};
  game.hud.update(0, {
    player: game.player,
    police: game.police,
    missions: game.missions,
    vehicles: game.vehicles,
    game,
  });
  let ticks = 0;
  const total = state.ticks ?? 40;
  return {
    tick(dt) {
      ticks++;
      if (state.each) state.each(game, ticks);
      game.hud.update(dt, {
        player: game.player,
        police: game.police,
        missions: game.missions,
        vehicles: game.vehicles,
        game,
      });
    },
    after() {
      if (ticks >= total && !window.__shotReady) window.__shotReady = true;
    },
  };
}

function placeCar(game, type, colour, x, z, heading, speed = 0) {
  const car = game.vehicles.spawn(type, colour, x, z, heading, 'shot');
  car.heading = heading;
  car.vel.set(Math.sin(heading) * speed, 0, Math.cos(heading) * speed);
  car.speed = speed;
  car.syncMesh();
  return car;
}

function drivePlayer(game, car, yaw = 0) {
  game.player.inCar = car;
  car.driver = 'player';
  game.player.hide();
  game.player.pos.set(car.pos.x, 0, car.pos.z);
  game.cameraPos.set(
    car.pos.x - Math.sin(car.heading) * 9,
    3.8,
    car.pos.z - Math.cos(car.heading) * 9,
  );
  game.cameraYaw = yaw;
}

function stageChase(game) {
  // A wide neon street heading north along a main avenue, three stars, two cruisers behind.
  const road = gridLine(6);
  const heading = -Math.PI / 2 + Math.PI; // facing -x
  const hero = placeCar(game, 'sports', 0xc8323f, 40, road + 3.4, -Math.PI / 2, 26);
  drivePlayer(game, hero, -Math.PI / 2);
  hero.mesh.userData.lights.forEach((l) => l.material.color.setHex(0xff5a3c));

  const p1 = placeCar(game, 'police', 0x1b2a44, 58, road + 3.2, -Math.PI / 2, 27);
  const p2 = placeCar(game, 'police', 0x1b2a44, 68, road + 6.6, -Math.PI / 2, 26);
  p1.driver = 'police';
  p2.driver = 'police';
  game.police.units.push({ car: p1, state: 'chase', arrest: 0 });
  game.police.units.push({ car: p2, state: 'chase', arrest: 0 });
  game.police.stars = 3;

  game.missions.index = 1;
  game.missions.state = 'active';
  game.missions.setMarker(-140, 190);
  game.missions.beacon.visible = true;
  game.missions.step = 0;
  game.player.health = 74;
  game.player.weapon = 'pistol';
  game.player.ammo = 9;
  game.player.reserve = 24;
  game.cameraPitch = 0.1;
  return {
    ticks: 30,
    each(g) {
      // Keep the cars rolling so the speedometer and skid smoke read as motion.
      const car = g.player.inCar;
      if (car) {
        car.pos.x -= 0.45;
        car.speed = 26;
        car.vel.set(-26, 0, 0);
        car.syncMesh();
        if (Math.random() < 0.5) g.vehicles.emitSkid(car);
      }
      for (const unit of g.police.units) {
        unit.car.pos.x += 0.4;
        unit.car.speed = 27;
        unit.car.syncMesh();
      }
      g.updateCamera(1 / 60);
    },
  };
}

function stageOnFoot(game) {
  const road = gridLine(6);
  const car = placeCar(game, 'sedan', 0x2e6fa8, -30, road - 4.6, 0, 0);
  car.hp = 55;
  game.player.reset(-33.4, road - 8.4, 0.4);
  game.player.weapon = 'pistol';
  game.player.ammo = 12;
  game.player.health = 88;
  game.cameraYaw = 0.05;
  game.cameraPitch = 0.18;
  game.police.stars = 0;
  game.missions.index = 0;
  game.missions.state = 'active';
  game.missions.setMarker(120, 60);
  game.missions.beacon.visible = true;
  game.missions.step = 0;
  game.prompt = 'E — take the car';
  return {
    ticks: 26,
    each(g) {
      g.player.animate(1 / 60, 0);
      g.updateCamera(1 / 60);
    },
  };
}

function stageMission(game) {
  // Player on foot at the marina, package marker lit, police closing in with a cruiser.
  const quay = CITY.waterAt - 26;
  game.player.reset(quay, -120, Math.PI * 0.6);
  game.player.weapon = 'pistol';
  game.player.ammo = 7;
  game.player.health = 61;
  game.cameraYaw = Math.PI * 0.15;
  game.cameraPitch = 0.24;
  game.police.stars = 2;
  game.missions.index = 2;
  game.missions.state = 'active';
  game.missions.setMarker(quay + 12, -96);
  game.missions.beacon.visible = true;
  game.missions.step = 0;
  const pm = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.8, 1.1),
    new THREE.MeshStandardMaterial({ color: 0x3a5f4c, roughness: 0.55 }),
  );
  pm.position.set(quay + 12, 0.9, -96);
  game.scene.add(pm);
  game.missions.packageMesh = pm;

  for (let i = 0; i < 2; i++) {
    const cruiser = placeCar(game, 'police', 0x1b2a44, quay - 16 - i * 9, -138 + i * 7, Math.PI * 0.7, 11);
    cruiser.driver = 'police';
    game.police.units.push({ car: cruiser, state: 'chase', arrest: 0 });
  }
  game.hitmarkTimer = 0.2;
  return {
    ticks: 24,
    each(g) {
      g.player.animate(1 / 60, 2);
      for (const unit of g.police.units) {
        unit.car.pos.x += 0.12;
        unit.car.pos.z -= 0.06;
        unit.car.syncMesh();
      }
      g.updateCamera(1 / 60);
    },
  };
}

function stageNight(game) {
  // Night driving with headlights: darker sky, lit windows, full HUD.
  game.world.sky.material.uniforms.top.value.setHex(0x05070f);
  game.world.sky.material.uniforms.horizon.value.setHex(0x1a2a44);
  game.world.sky.material.uniforms.glow.value.setHex(0x3a6a9a);
  game.scene.fog.color.setHex(0x0c1220);
  game.world.sun.intensity = 0.18;
  game.world.sun.color.setHex(0x4a6a9a);
  game.clockMinutes = 22 * 60 + 15;

  const road = gridLine(6);
  const hero = placeCar(game, 'sports', 0x2f8f6b, 24, road - 3.4, Math.PI / 2, 22);
  drivePlayer(game, hero, Math.PI / 2);
  const p1 = placeCar(game, 'police', 0x1b2a44, 2, road - 3.2, Math.PI / 2, 23);
  p1.driver = 'police';
  game.police.units.push({ car: p1, state: 'chase', arrest: 0 });
  game.police.stars = 2;
  game.player.health = 92;
  game.missions.index = 3;
  game.missions.state = 'active';
  game.missions.step = 0;
  game.missions.setMarker(-120, -130);
  game.missions.beacon.visible = true;

  for (const lamp of game.world.lamps) lamp.intensity *= 2.1;
  return {
    ticks: 30,
    each(g) {
      const car = g.player.inCar;
      if (car) {
        car.pos.x += 0.5;
        car.speed = 22;
        car.vel.set(22, 0, 0);
        car.syncMesh();
      }
      if (g.police.units[0]) {
        g.police.units[0].car.pos.x += 0.44;
        g.police.units[0].car.syncMesh();
      }
      g.updateCamera(1 / 60);
    },
  };
}

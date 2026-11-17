// Traffic and pedestrians. Cars keep to their lane, slow for the junction ahead and turn
// now and then; people walk the pavements, cross at the corners and scatter from trouble.
import * as THREE from 'three';
import { CITY, PALETTE, CAR_TYPES, gridLine } from './config.js';

const LANE = 3.4;

function pedMesh(rng) {
  const g = new THREE.Group();
  const shirt = rng.pick([0xbe4a4a, 0x3f6fa8, 0xd9c25a, 0x4c8a63, 0x8f5aa8, 0xd9d2c4, 0x2f3540]);
  const trouser = rng.pick([0x24262e, 0x3a3f4c, 0x4a4238, 0x1e2026]);
  const skin = rng.pick([0xc99a76, 0x9a6b4c, 0x6e4a33, 0xe0b592]);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.6, 0.26), new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }));
  torso.position.y = 1.2;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.26), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.8 }));
  head.position.y = 1.65;
  g.add(head);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.18), new THREE.MeshStandardMaterial({ color: trouser, roughness: 0.9 }));
  legL.position.set(-0.11, 0.62, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.11;
  g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.14), new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.85 }));
  armL.position.set(-0.3, 1.2, 0);
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.3;
  g.add(armR);
  g.userData = { legL, legR, armL, armR };
  return g;
}

export class Traffic {
  constructor(scene, world, vehicles, rng, count = 24) {
    this.scene = scene;
    this.world = world;
    this.vehicles = vehicles;
    this.rng = rng;
    this.cars = [];
    this.peds = [];
    this.count = count;
    this.pedCount = 34;
    this.spawnAll();
  }

  lanePoint(axis, line, dir, along) {
    const offset = dir > 0 ? -LANE : LANE;
    if (axis === 'z') return { x: line + (dir > 0 ? LANE : -LANE), z: along };
    return { x: along, z: line + (dir > 0 ? -LANE : LANE) };
  }

  spawnAll() {
    const rng = this.rng;
    for (let i = 0; i < this.count; i++) {
      const axis = rng.chance(0.5) ? 'x' : 'z';
      const line = gridLine(rng.int(0, CITY.grid));
      const dir = rng.sign();
      const along = rng.range(-CITY.bound + 30, CITY.bound - 30);
      const p = this.lanePoint(axis, line, dir, along);
      if (this.world.blocked(p.x, p.z, 3)) continue;
      const type = rng.chance(0.16) ? 'taxi' : rng.chance(0.12) ? 'truck' : 'sedan';
      const color = type === 'taxi' ? 0xe0b62c : rng.pick(PALETTE.carColors);
      const car = this.vehicles.spawn(type, color, p.x, p.z, 0, 'traffic');
      car.driver = 'ai';
      car.aiMaxSpeed = rng.range(9, 15);
      car.aiThrottle = 0.5;
      car.aiHeading = 0;
      const entry = { car, axis, line, dir, along, laneOffset: 0, honk: 0 };
      this.align(entry);
      this.cars.push(entry);
    }

    for (let i = 0; i < this.pedCount; i++) {
      const bx = rng.int(0, CITY.grid - 1);
      const bz = rng.int(0, CITY.grid - 1);
      const mid = CITY.pitch / 2 - CITY.roadWidth / 2 - CITY.sidewalk / 2;
      const side = rng.int(0, 3);
      const cx = gridLine(bx) + CITY.roadWidth / 2 + CITY.sidewalk / 2 + rng.range(0, 2);
      const cz = gridLine(bz) + CITY.roadWidth / 2 + CITY.sidewalk / 2 + rng.range(0, 2);
      const mesh = pedMesh(rng);
      const heading = rng.range(0, Math.PI * 2);
      mesh.position.set(cx, 0.24, cz);
      this.scene.add(mesh);
      this.peds.push({
        mesh,
        pos: new THREE.Vector3(cx, 0.24, cz),
        heading,
        speed: rng.range(1.1, 1.8),
        phase: rng.range(0, 6),
        fear: 0,
        wander: rng.range(0, Math.PI * 2),
        alive: true,
        vy: 0,
      });
    }
  }

  align(entry) {
    const p = this.lanePoint(entry.axis, entry.line, entry.dir, entry.along);
    entry.car.pos.set(p.x, 0, p.z);
    entry.car.heading = entry.axis === 'z' ? (entry.dir > 0 ? 0 : Math.PI) : (entry.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    entry.car.aiHeading = entry.car.heading;
    entry.car.vel.set(0, 0, 0);
  }

  update(dt, player, crimes) {
    this.updateCars(dt, player);
    this.updatePeds(dt, player, crimes);
  }

  updateCars(dt, player) {
    for (const e of this.cars) {
      const car = e.car;
      if (car.driver !== 'ai') continue;
      let speed = car.aiMaxSpeed;
      // Slow for the junction ahead so turns look intentional.
      const posAlong = e.axis === 'z' ? car.pos.z : car.pos.x;
      const nextLine = gridLine(Math.round((posAlong + e.dir * 26) / CITY.pitch + CITY.grid / 2));
      const toJunction = Math.abs(nextLine - posAlong);
      if (toJunction < 16) speed *= 0.45;

      // Keep a gap from whatever is in front.
      for (const other of this.vehicles.cars) {
        if (other === car) continue;
        const dx = other.pos.x - car.pos.x;
        const dz = other.pos.z - car.pos.z;
        const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
        const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
        if (ahead > 0 && ahead < 12 && side < 2.4) speed = Math.min(speed, Math.max(0, (ahead - 6) * 1.6));
      }
      if (player && player.inCar) {
        const dx = player.pos.x - car.pos.x;
        const dz = player.pos.z - car.pos.z;
        const ahead = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
        const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
        if (ahead > 0 && ahead < 13 && side < 2.6) speed = Math.min(speed, Math.max(0, (ahead - 7) * 1.5));
      }

      const step = speed * dt * e.dir;
      if (e.axis === 'z') e.along = car.pos.z;
      else e.along = car.pos.x;
      e.along += step;

      // Turn at junctions now and then.
      const junctionIndex = Math.round((e.along / CITY.pitch) + CITY.grid / 2);
      const junctionCoord = gridLine(junctionIndex);
      const crossed = e.dir > 0 ? e.along >= junctionCoord : e.along <= junctionCoord;
      if (crossed && this.rng.chance(0.34) && Math.abs(e.along) < CITY.bound - 50) {
        const newAxis = e.axis === 'z' ? 'x' : 'z';
        e.axis = newAxis;
        e.line = junctionCoord;
        e.dir = this.rng.sign();
        e.along = junctionCoord + e.dir * 0.1;
        this.align(e);
        continue;
      }

      if (Math.abs(e.along) > CITY.bound - 24) {
        e.dir *= -1;
        this.align(e);
        continue;
      }

      const p = this.lanePoint(e.axis, e.line, e.dir, e.along);
      car.pos.set(p.x, 0, p.z);
      car.heading = e.axis === 'z' ? (e.dir > 0 ? 0 : Math.PI) : (e.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      car.aiHeading = car.heading;
      car.vel.set(Math.sin(car.heading) * speed, 0, Math.cos(car.heading) * speed);
      car.speed = speed * e.dir;
    }
  }

  updatePeds(dt, player, crimes) {
    const threat = player.inCar ? player.inCar.pos : new THREE.Vector3(player.pos.x, 0, player.pos.z);
    const threatSpeed = player.inCar ? Math.abs(player.inCar.vel.length()) : 0;
    for (const ped of this.peds) {
      if (!ped.alive) {
        ped.vy -= 18 * dt;
        ped.mesh.position.y = Math.max(0.1, ped.mesh.position.y + ped.vy * dt);
        ped.mesh.rotation.z = Math.min(Math.PI / 2, ped.mesh.rotation.z + dt * 4);
        continue;
      }
      const d = Math.hypot(ped.pos.x - threat.x, ped.pos.z - threat.z);
      if (crimes > 0 && d < 26) ped.fear = Math.max(ped.fear, 3.5);
      if (threatSpeed > 9 && d < 14) ped.fear = Math.max(ped.fear, 2.4);
      ped.fear = Math.max(0, ped.fear - dt);

      let speed = ped.speed;
      let heading = ped.heading;
      if (ped.fear > 0) {
        heading = Math.atan2(ped.pos.x - threat.x, ped.pos.z - threat.z);
        speed = 4.6;
      } else {
        ped.wander += (this.rng.next() - 0.5) * dt * 1.6;
        heading += Math.sin(ped.wander) * dt * 0.9;
      }
      ped.heading = heading;
      ped.pos.x += Math.sin(heading) * speed * dt;
      ped.pos.z += Math.cos(heading) * speed * dt;

      if (this.world.blocked(ped.pos.x, ped.pos.z, 0.5) || Math.abs(ped.pos.x) > CITY.bound - 8) {
        ped.heading += Math.PI * 0.68;
        ped.pos.x -= Math.sin(heading) * speed * dt;
        ped.pos.z -= Math.cos(heading) * speed * dt;
        ped.wander += 1.4;
      }

      const m = ped.mesh;
      m.position.set(ped.pos.x, 0.24, ped.pos.z);
      m.rotation.y = heading;
      ped.phase += dt * speed * 6.2;
      const swing = Math.sin(ped.phase) * (speed > 2 ? 0.55 : 0.42);
      m.userData.legL.rotation.x = swing;
      m.userData.legR.rotation.x = -swing;
      m.userData.armL.rotation.x = -swing * 0.8;
      m.userData.armR.rotation.x = swing * 0.8;
      m.position.y = 0.24 + Math.abs(Math.sin(ped.phase)) * 0.03;
    }
  }

  // Called when the player's car hits a pedestrian.
  checkPedHits(playerCar, onHit) {
    if (!playerCar) return;
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      const d = Math.hypot(ped.pos.x - playerCar.pos.x, ped.pos.z - playerCar.pos.z);
      if (d < 2.4 && Math.abs(playerCar.vel.length()) > 4) {
        ped.alive = false;
        ped.vy = 3.2;
        onHit(ped);
      }
    }
  }

  nearestPed(pos, radius) {
    let best = null;
    let bd = radius;
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      const d = Math.hypot(ped.pos.x - pos.x, ped.pos.z - pos.z);
      if (d < bd) {
        bd = d;
        best = ped;
      }
    }
    return best;
  }

  scatter(x, z, radius) {
    for (const ped of this.peds) {
      if (!ped.alive) continue;
      if (Math.hypot(ped.pos.x - x, ped.pos.z - z) < radius) ped.fear = 4;
    }
  }
}

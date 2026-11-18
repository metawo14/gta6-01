// Traffic and pedestrians: cars that keep to their lane, pause at junctions and
// sometimes turn; peds that walk the pavements, wander, cross, and flee from trouble.

import * as THREE from 'three';
import { ROADS, CITY } from './config.js';
import { Rand, clamp } from './random.js';

const LANE = 3.4;

export class TrafficSystem {
  constructor(scene, world, cars, audio) {
    this.scene = scene;
    this.world = world;
    this.cars = cars;
    this.audio = audio;
    this.rand = new Rand(world.seed * 7 + 11);
    this.traffic = [];
    this.peds = [];
    this.pedGroup = new THREE.Group();
    scene.add(this.pedGroup);
    this.pedTex = null;
    this.step_t = 0;
  }

  spawnAll(count = 24, pedCount = 34) {
    this.clear();
    for (let i = 0; i < count; i++) this.spawnTrafficCar();
    for (let i = 0; i < pedCount; i++) this.spawnPed();
  }

  clear() {
    for (const t of this.traffic) this.cars.remove(t.car);
    this.traffic.length = 0;
    for (const p of this.peds) this.pedGroup.remove(p.group);
    this.peds.length = 0;
  }

  randomRoadPoint() {
    const r = this.rand;
    const horiz = r.chance(0.5);
    const ri = r.int(0, ROADS.length - 1);
    const along = r.range(-CITY.bound + 30, CITY.bound - 30);
    const dir = r.sign();
    const lane = horiz ? LANE * (dir > 0 ? 1 : -1) : LANE * (dir > 0 ? 1 : -1);
    const x = horiz ? along : ROADS[ri] + lane;
    const z = horiz ? ROADS[ri] + lane : along;
    return { x, z, horiz, dir, road: ROADS[ri], roadIndex: ri, along };
  }

  spawnTrafficCar() {
    const r = this.rand;
    const types = ['sedan', 'sedan', 'sedan', 'taxi', 'truck', 'sports'];
    const type = r.pick(types);
    const p = this.randomRoadPoint();
    if (p.x > CITY.waterX - 16) return null;
    const car = this.cars.create(type, undefined, p.x, p.z, 0);
    car.driver = 'ai';
    const entry = {
      car,
      horiz: p.horiz,
      dir: p.dir,
      roadIndex: p.roadIndex,
      lane: p.horiz ? (p.dir > 0 ? LANE : -LANE) : p.dir > 0 ? LANE : -LANE,
      targetSpeed: 12 + r.range(0, 10),
      junctionCd: 0,
      turnIntent: 0,
      turnCd: r.range(0, 8),
      stuck: 0,
      avoid: 0,
      headingSet: false,
    };
    this.traffic.push(entry);
    this.updateCarHeading(entry);
    return entry;
  }

  updateCarHeading(entry) {
    const car = entry.car;
    // direction of travel along the road
    if (entry.horiz) {
      car.heading = entry.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      car.heading = entry.dir > 0 ? Math.PI : 0;
    }
  }

  spawnPed() {
    const r = this.rand;
    const p = this.world.randomSidewalkPoint('any') || { x: 0, z: 0 };
    const group = makePedFigure(r);
    group.position.set(p.x, 0, p.z);
    this.pedGroup.add(group);
    const ped = {
      group,
      x: p.x,
      z: p.z,
      heading: r.range(0, Math.PI * 2),
      speed: r.range(0.9, 1.5),
      target: null,
      wanderCd: r.range(0, 3),
      fear: 0,
      down: 0,
      downDir: new THREE.Vector3(),
      downVy: 0,
      downY: 0,
      phase: r.range(0, 6),
      shirt: r.pick([0xb5443c, 0x3f6f9a, 0xb8a24a, 0x2f7a63, 0x8a5bb5, 0xc9c9c9]),
    };
    colorPed(group, ped.shirt);
    this.peds.push(ped);
    return ped;
  }

  nearestPed(x, z, maxDist = 999) {
    let best = null;
    let bd = maxDist;
    for (const p of this.peds) {
      if (p.down > 0.15) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best ? { ped: best, dist: bd } : null;
  }

  nearestPedAny(x, z, maxDist = 999) {
    let best = null;
    let bd = maxDist;
    for (const p of this.peds) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best ? { ped: best, dist: bd } : null;
  }

  scatter(x, z, radius = 26, amount = 1) {
    for (const p of this.peds) {
      if (Math.hypot(p.x - x, p.z - z) < radius) {
        p.fear = Math.max(p.fear, 2.4 + amount * 1.4);
      }
    }
  }

  knockDown(ped, dirX, dirZ, force = 1) {
    if (ped.down > 0) return;
    ped.down = 0.001;
    ped.downVy = 3.2 * force;
    ped.downY = 0;
    const d = Math.hypot(dirX, dirZ) || 1;
    ped.downDir.set(dirX / d, 0, dirZ / d);
    ped.fear = 5;
  }

  // A fast player car knocks peds over; returns the peds hit.
  checkPedHits(playerCar, dt) {
    const hit = [];
    if (!playerCar) return hit;
    const sp = Math.hypot(playerCar.vx, playerCar.vz);
    if (sp < 4) return hit;
    for (const p of this.peds) {
      if (p.down > 0) continue;
      const dx = p.x - playerCar.x;
      const dz = p.z - playerCar.z;
      if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
      const along = dx * Math.sin(playerCar.heading) + dz * Math.cos(playerCar.heading);
      const side = dx * Math.cos(playerCar.heading) - dz * Math.sin(playerCar.heading);
      if (Math.abs(along) < playerCar.halfLength + 0.35 && Math.abs(side) < playerCar.halfWidth + 0.35) {
        this.knockDown(p, playerCar.vx, playerCar.vz, clamp(sp / 12, 0.6, 1.8));
        p.x += playerCar.vx * 0.06;
        p.z += playerCar.vz * 0.06;
        hit.push(p);
        this.scatter(p.x, p.z, 22, 1.2);
      }
    }
    return hit;
  }

  step(dt, playerPos, playerCar, world, crimeAt) {
    // ---- traffic cars ----
    for (const entry of this.traffic) {
      const car = entry.car;
      if (car.driver !== 'ai') continue;
      entry.turnCd -= dt;
      entry.junctionCd = Math.max(0, entry.junctionCd - dt);

      // lane keeping: aim at a point a little ahead on our lane
      let targetX;
      let targetZ;
      if (entry.horiz) {
        targetX = car.x + entry.dir * 14;
        targetZ = car.z + (entry.z - (ROADS[entry.roadIndex] + entry.lane)) * 0.1;
        targetZ = car.z + ((ROADS[entry.roadIndex] + entry.lane) - car.z) * 0.35;
      } else {
        targetZ = car.z + entry.dir * 14;
        targetX = car.x + ((ROADS[entry.roadIndex] + entry.lane) - car.x) * 0.35;
      }

      // junction slowdown
      let nearestJunction = Infinity;
      for (const r of ROADS) {
        if (entry.horiz) {
          const d = (r - car.x) * entry.dir;
          if (d > 0 && d < nearestJunction) nearestJunction = d;
        } else {
          const d = (r - car.z) * entry.dir;
          if (d > 0 && d < nearestJunction) nearestJunction = d;
        }
      }
      let wantSpeed = entry.targetSpeed;
      if (nearestJunction < 14) wantSpeed = Math.min(wantSpeed, 6.5);

      // gap from whatever is ahead
      let gap = 999;
      for (const other of this.traffic) {
        if (other === entry) continue;
        const dx = other.car.x - car.x;
        const dz = other.car.z - car.z;
        const dist = Math.hypot(dx, dz);
        if (dist > 22) continue;
        const fwd = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
        const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
        if (fwd > 0 && side < 3.4 && fwd < gap) gap = fwd;
      }
      if (playerCar) {
        const dx = playerCar.x - car.x;
        const dz = playerCar.z - car.z;
        const fwd = dx * Math.sin(car.heading) + dz * Math.cos(car.heading);
        const side = Math.abs(dx * Math.cos(car.heading) - dz * Math.sin(car.heading));
        if (fwd > 0 && side < 3.6 && fwd < gap) gap = fwd;
      }
      if (gap < 9) wantSpeed = Math.min(wantSpeed, Math.max(0, (gap - 4) * 1.6));

      const sp = car.forwardSpeed;
      const throttle = clamp((wantSpeed - sp) * 0.42, -1, 1);
      const desired = Math.atan2(targetX - car.x, targetZ - car.z);
      let diff = desired - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const steer = clamp(diff * 1.4, -1, 1);

      // occasionally turn at a junction onto the cross street
      let doTurn = false;
      if (nearestJunction < 9 && entry.turnCd <= 0 && this.rand.chance(0.03)) {
        doTurn = true;
      }
      if (doTurn) {
        entry.turnCd = 10;
        entry.horiz = !entry.horiz;
        entry.dir = this.rand.sign();
        entry.roadIndex = nearestRoadIndex(entry.horiz ? car.z : car.x);
        entry.lane = LANE * (entry.dir > 0 ? 1 : -1);
      }

      // turn around at the edge
      const lim = CITY.bound - 18;
      if (Math.abs(car.x) > lim || Math.abs(car.z) > lim) {
        entry.dir *= -1;
        entry.roadIndex = nearestRoadIndex(entry.horiz ? car.z : car.x);
        entry.lane = LANE * (entry.dir > 0 ? 1 : -1);
      }

      this.cars.stepAICar(car, dt, throttle, steer);
      if (car.wrecked) {
        car.driver = null;
        car.lightMode = 'off';
      }
    }

    // ---- pedestrians ----
    for (const p of this.peds) {
      if (p.down > 0) {
        // the fall: a little pop then a slow tip to the ground
        p.down += dt;
        p.downVy -= 9 * dt;
        p.downY += p.downVy * dt;
        if (p.downY < 0) {
          p.downY = 0;
          p.downVy = 0;
        }
        p.group.position.set(p.x, p.downY, p.z);
        const tip = Math.min(1, p.down * 2.4);
        p.group.rotation.x = tip * (Math.PI / 2) * 0.94;
        p.group.rotation.y = p.heading;
        p.fear = Math.max(0, p.fear - dt);
        continue;
      }
      p.fear = Math.max(0, p.fear - dt * 0.5);
      p.wanderCd -= dt;

      const fleeing = p.fear > 0.05;
      let speed = p.speed;
      if (fleeing) speed *= 3.4;

      if (fleeing) {
        // run away from the trouble (player)
        const dx = p.x - playerPos.x;
        const dz = p.z - playerPos.z;
        const d = Math.hypot(dx, dz) || 1;
        p.target = { x: p.x + (dx / d) * 22, z: p.z + (dz / d) * 22 };
      } else if (p.wanderCd <= 0) {
        p.wanderCd = 2 + this.rand.range(0, 4);
        if (this.rand.chance(0.55)) {
          const t = this.world.randomSidewalkPoint('any');
          if (t) p.target = { x: t.x, z: t.z };
        } else {
          const ang = this.rand.range(0, Math.PI * 2);
          p.target = { x: p.x + Math.cos(ang) * 24, z: p.z + Math.sin(ang) * 24 };
        }
      }

      // a fast car nearby scares them
      if (playerCar) {
        const d = Math.hypot(playerCar.x - p.x, playerCar.z - p.z);
        if (d < 16 && Math.hypot(playerCar.vx, playerCar.vz) > 16) {
          p.fear = Math.max(p.fear, 1.6);
        }
      }
      if (crimeAt && Math.hypot(crimeAt.x - p.x, crimeAt.z - p.z) < 30 && crimeAt.t > 0) {
        p.fear = Math.max(p.fear, 1.2);
      }

      if (p.target) {
        const dx = p.target.x - p.x;
        const dz = p.target.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) {
          p.target = null;
        } else {
          const nx = dx / d;
          const nz = dz / d;
          p.x += nx * speed * dt;
          p.z += nz * speed * dt;
          const want = Math.atan2(nx, nz);
          p.heading = p.heading + angleDiff(want, p.heading) * Math.min(1, 6 * dt);
        }
      }

      const res = this.world.resolveCircle(p.x, p.z, 0.4);
      p.x = res.x;
      p.z = res.z;
      p.x = clamp(p.x, -CITY.bound + 4, CITY.waterX - 6);
      p.z = clamp(p.z, -CITY.bound + 4, CITY.bound - 4);

      p.phase += dt * (fleeing ? 13 : 4.5);
      const swing = Math.sin(p.phase) * (fleeing ? 0.7 : 0.36);
      if (p.limbs) {
        p.limbs.legL.rotation.x = swing;
        p.limbs.legR.rotation.x = -swing;
        p.limbs.armL.rotation.x = -swing * 0.8;
        p.limbs.armR.rotation.x = swing * 0.8;
      }
      p.group.position.set(p.x, 0, p.z);
      p.group.rotation.set(0, p.heading, 0);
    }
  }

  get nearestAhead() {
    return (x, z, heading, range) => {
      let best = null;
      let bd = range;
      for (const p of this.peds) {
        if (p.down > 0) continue;
        const dx = p.x - x;
        const dz = p.z - z;
        const fwd = dx * Math.sin(heading) + dz * Math.cos(heading);
        const side = Math.abs(dx * Math.cos(heading) - dz * Math.sin(heading));
        if (fwd < 0) continue;
        const d = Math.hypot(dx, dz);
        if (d > bd) continue;
        if (Math.tan(0.5) * fwd < side) continue;
        bd = d;
        best = p;
      }
      return best;
    };
  }
}

function nearestRoadIndex(v) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < ROADS.length; i++) {
    const d = Math.abs(ROADS[i] - v);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

const pedMats = {
  skin: new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.75 }),
  legs: new THREE.MeshStandardMaterial({ color: 0x24262e, roughness: 0.9 }),
  shoe: new THREE.MeshStandardMaterial({ color: 0x121316, roughness: 0.95 }),
};

function makePedFigure(r) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: 0x3f6f9a, roughness: 0.8 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), shirt);
  torso.position.y = 1.06;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), pedMats.skin);
  head.position.y = 1.55;
  g.add(head);
  const hair = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.12, 0.3),
    new THREE.MeshStandardMaterial({ color: r.pick([0x1f1712, 0x3a2a1c, 0x6a5a44, 0x111114]), roughness: 0.95 }),
  );
  hair.position.y = 1.72;
  g.add(hair);
  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.24, 0.28), pedMats.legs);
  hips.position.y = 0.7;
  g.add(hips);

  const mkLimb = (x, y, w, h, d, mat) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.y = -h / 2;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  const legL = mkLimb(0.13, 0.66, 0.19, 0.6, 0.2, pedMats.legs);
  const legR = mkLimb(-0.13, 0.66, 0.19, 0.6, 0.2, pedMats.legs);
  const armL = mkLimb(0.32, 1.28, 0.15, 0.52, 0.16, shirt);
  const armR = mkLimb(-0.32, 1.28, 0.15, 0.52, 0.16, shirt);
  const footL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.11, 0.3), pedMats.shoe);
  footL.position.set(0, -0.63, 0.05);
  legL.add(footL);
  const footR = footL.clone();
  legR.add(footR);
  g.limbs = { legL, legR, armL, armR, torso, shirt };
  return g;
}

function colorPed(group, hex) {
  if (group.limbs && group.limbs.shirt) group.limbs.shirt.color.setHex(hex);
}

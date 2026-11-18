// Port Meridian — traffic and pedestrians.
// Traffic cars keep to their lane, slow for junctions, keep a gap, sometimes turn at a
// junction and turn around at the city edge. Pedestrians walk the pavements, drift, cross at
// corners and flee from trouble.

import * as THREE from 'three';
import { CITY, CAR_CLASSES, TRAFFIC_COUNT, PED_COUNT } from './config.js';
import { Rng, clamp } from './random.js';

const LANE_OFFSET = 3.4;

// Right-hand traffic: the lane sits to the right of the direction of travel.
// For travel along +x the right is +z; for travel along +z the right is -x.
function laneOffset(axis, dir) {
  if (axis === 'ew') return { x: 0, z: dir > 0 ? LANE_OFFSET : -LANE_OFFSET };
  return { x: dir > 0 ? -LANE_OFFSET : LANE_OFFSET, z: 0 };
}

function headingFor(axis, dir) {
  if (axis === 'ew') return dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  return dir > 0 ? Math.PI : 0;
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const PED_COLORS = [0x2f3a52, 0x4a3a34, 0x3a4a3e, 0x5a4a5e, 0x4d4d55, 0x6a5340, 0x334455];

function pedMaterialSet(rng) {
  return {
    coat: new THREE.MeshStandardMaterial({ color: rng.pick(PED_COLORS), roughness: 0.85 }),
    legs: new THREE.MeshStandardMaterial({ color: rng.pick([0x232831, 0x2e2a26, 0x2b3540]), roughness: 0.9 }),
    skin: new THREE.MeshStandardMaterial({
      color: rng.pick([0xd0a07a, 0xa8714b, 0x7d5136, 0xe0b994]), roughness: 0.8,
    }),
    hair: new THREE.MeshStandardMaterial({ color: rng.pick([0x14100c, 0x3a2a1a, 0x6a5a4a]), roughness: 0.95 }),
  };
}

class Pedestrian {
  constructor(rng, x, z) {
    this.x = x;
    this.z = z;
    this.y = 0;
    this.angle = rng.range(0, Math.PI * 2);
    this.speed = rng.range(1.1, 1.7);
    this.fear = 0;
    this.down = false;
    this.downTime = 0;
    this.fallVy = 0;
    this.fallVx = 0;
    this.fallVz = 0;
    this.phase = rng.range(0, Math.PI * 2);
    this.seed = rng.range(0, 100);
    this.driftTimer = rng.range(0, 3);
    this.mats = pedMaterialSet(rng);
    this.height = rng.range(0.94, 1.06);
    this.mesh = this._build();
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = this.angle;
  }

  _build() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.body = body;
    const m = this.mats;

    const add = (mat, w, h, d, x, y, z, parent) => {
      const mesh = new THREE.Mesh(BOX, mat);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      (parent ?? body).add(mesh);
      return mesh;
    };

    add(m.legs, 0.4, 0.18, 0.26, 0, 0.82, 0);
    const torso = new THREE.Group();
    torso.position.y = 0.9;
    body.add(torso);
    add(m.coat, 0.48, 0.56, 0.3, 0, 0.3, 0, torso);
    this.torso = torso;

    const head = add(m.skin, 0.27, 0.29, 0.26, 0, 1.1, 0);
    add(m.hair, 0.29, 0.1, 0.28, 0, 1.22, 0);
    this.headMesh = head;

    const legL = new THREE.Group();
    legL.position.set(-0.12, 0.8, 0);
    body.add(legL);
    add(m.legs, 0.17, 0.78, 0.2, 0, -0.39, 0, legL);

    const legR = new THREE.Group();
    legR.position.set(0.12, 0.8, 0);
    body.add(legR);
    add(m.legs, 0.17, 0.78, 0.2, 0, -0.39, 0, legR);

    const armL = new THREE.Group();
    armL.position.set(-0.29, 1.32, 0);
    body.add(armL);
    add(m.coat, 0.13, 0.5, 0.16, 0, -0.24, 0, armL);

    const armR = new THREE.Group();
    armR.position.set(0.29, 1.32, 0);
    body.add(armR);
    add(m.coat, 0.13, 0.5, 0.16, 0, -0.24, 0, armR);

    this.legL = legL;
    this.legR = legR;
    this.armL = armL;
    this.armR = armR;
    root.scale.setScalar(1.02);
    return root;
  }

  knock(wx, wz) {
    if (this.down) return;
    this.down = true;
    this.downTime = 0;
    this.fallVy = 2.6;
    const d = Math.hypot(this.x - wx, this.z - wz) || 1;
    this.fallVx = ((this.x - wx) / d) * 1.7;
    this.fallVz = ((this.z - wz) / d) * 1.7;
    this.fear = 6;
  }

  hit(power = 1) {
    this.knock(this.x - Math.sin(this.angle), this.z - Math.cos(this.angle));
    this.fallVy = 2.6 * power;
  }
}

export class Traffic {
  constructor(scene, city, seed) {
    this.scene = scene;
    this.city = city;
    this.rng = new Rng(`traffic:${seed}`);
    this.peds = [];
    this.pedGroup = new THREE.Group();
    scene.add(this.pedGroup);
    this.scatterPoints = [];
    this._buildPeds();
  }

  _buildPeds() {
    const rng = this.rng;
    for (let i = 0; i < PED_COUNT; i++) {
      const spot = this._findPavementSpot(rng);
      const p = new Pedestrian(rng, spot.x, spot.z);
      this.peds.push(p);
      this.pedGroup.add(p.mesh);
    }
  }

  _findPavementSpot(rng) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const g = rng.pick([-224, -160, -96, -32, 32, 96, 160, 224]);
      const along = rng.range(-CITY.bound + 30, CITY.bound - 30);
      const side = rng.sign();
      const off = CITY.roadWidth / 2 + 3.1;
      const horizontal = rng.chance(0.5);
      const x = horizontal ? along : g + side * off;
      const z = horizontal ? g + side * off : along;
      if (x > CITY.seaEdge - 12) continue;
      if (this.city.isBlocked(x, z, 0.8)) continue;
      if (Math.hypot(x - 96, z + 196) < 8) continue;    // do not stand on the spawn
      return { x, z };
    }
    return { x: 100, z: -180 };
  }

  // --- per-frame ---------------------------------------------------------

  update(dt, player, playerCar, police) {
    const crimeNear = this.scatterPoints.length > 0;
    for (const p of this.peds) {
      if (p.down) {
        p.downTime += dt;
        p.fallVy -= 14 * dt;
        p.y = Math.max(0, p.y + p.fallVy * dt);
        p.x += p.fallVx * dt;
        p.z += p.fallVz * dt;
        // Tip slowly to the ground.
        p.body.rotation.x = Math.min(Math.PI / 2, p.body.rotation.x + dt * 2.6);
        p.mesh.position.set(p.x, p.y, p.z);
        if (p.downTime > 6.5) {
          // Get back up and walk away, so the street does not fill with bodies.
          p.down = false;
          p.body.rotation.x = 0;
          p.y = 0;
          p.fear = 4;
        }
        continue;
      }

      // Fear: recent crime nearby, or a fast car coming.
      let danger = 0;
      if (crimeNear) {
        for (const pt of this.scatterPoints) {
          const d = Math.hypot(p.x - pt.x, p.z - pt.z);
          if (d < 26) danger = Math.max(danger, 1 - d / 26);
        }
      }
      if (playerCar) {
        const d = Math.hypot(p.x - playerCar.x, p.z - playerCar.z);
        const speed = Math.hypot(playerCar.vx, playerCar.vz);
        if (d < 15 && speed > 8) danger = Math.max(danger, 1 - d / 15);
      }
      if (player && !player.hidden) {
        const d = Math.hypot(p.x - player.x, p.z - player.z);
        if (d < 5 && p.fear > 1) danger = Math.max(danger, 0.5);
      }
      if (danger > 0.05) p.fear = Math.max(p.fear, 2.2 + danger * 3.5);
      p.fear = Math.max(0, p.fear - dt);

      let vx;
      let vz;
      if (p.fear > 0) {
        // Run away from the nearest danger point.
        let awayX = 0;
        let awayZ = 0;
        for (const pt of this.scatterPoints) {
          const dx = p.x - pt.x;
          const dz = p.z - pt.z;
          const d = Math.hypot(dx, dz) || 1;
          awayX += (dx / d) / d;
          awayZ += (dz / d) / d;
        }
        if (playerCar) {
          const dx = p.x - playerCar.x;
          const dz = p.z - playerCar.z;
          const d = Math.hypot(dx, dz) || 1;
          awayX += (dx / d) / Math.max(1, d / 3);
          awayZ += (dz / d) / Math.max(1, d / 3);
        }
        if (player && !player.hidden) {
          const dx = p.x - player.x;
          const dz = p.z - player.z;
          const d = Math.hypot(dx, dz) || 1;
          awayX += (dx / d) / Math.max(1, d / 3);
          awayZ += (dz / d) / Math.max(1, d / 3);
        }
        const len = Math.hypot(awayX, awayZ) || 1;
        const run = 3.6 + Math.min(2.4, p.fear * 0.4);
        vx = (awayX / len) * run;
        vz = (awayZ / len) * run;
        p.angle += this._turnToward(p.angle, Math.atan2(-vx, -vz), dt * 9);
      } else {
        // Wander the pavement with a slow drift.
        p.driftTimer -= dt;
        if (p.driftTimer <= 0) {
          p.driftTimer = this.rng.range(2.2, 5.5);
          p.angle += this.rng.range(-1.2, 1.2);
        }
        vx = -Math.sin(p.angle) * p.speed;
        vz = -Math.cos(p.angle) * p.speed;
      }

      const next = { x: p.x + vx * dt, z: p.z + vz * dt };
      // Pedestrians prefer the pavement but may cross at a corner: the resolver keeps them out
      // of buildings, and a soft rail keeps them near the street grid.
      this.city.resolveCircle(next, 0.4, { x: p.x, z: p.z });
      if (p.fear > 0 || this.city.isOnRoad(next.x, next.z) || !this._offPavement(next.x, next.z)) {
        p.x = next.x;
        p.z = next.z;
      } else {
        // Turn back rather than walk into a block.
        p.angle += Math.PI * 0.7;
      }

      if (Math.abs(p.x) > CITY.bound - 6 || Math.abs(p.z) > CITY.bound - 6) {
        p.angle += Math.PI;
        p.x = clamp(p.x, -CITY.bound + 6, CITY.bound - 6);
        p.z = clamp(p.z, -CITY.bound + 6, CITY.bound - 6);
      }

      // Walk cycle.
      const moving = p.fear > 0 ? 11 : 6.2;
      p.phase += dt * moving;
      const swing = Math.sin(p.phase) * (p.fear > 0 ? 0.86 : 0.5);
      p.legL.rotation.x = swing;
      p.legR.rotation.x = -swing;
      p.armL.rotation.x = -swing * 0.9;
      p.armR.rotation.x = swing * 0.9;
      p.body.position.y = Math.abs(Math.sin(p.phase * 2)) * 0.03;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.rotation.y = p.angle;
    }

    // Decay the scatter points so the crowd calms down after a while.
    for (const pt of this.scatterPoints) pt.life -= dt;
    this.scatterPoints = this.scatterPoints.filter((pt) => pt.life > 0);
  }

  _turnToward(current, target, maxStep) {
    let diff = target - current;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return clamp(diff, -maxStep, maxStep);
  }

  _offPavement(x, z) {
    // True when the point sits inside a block (not on a road and not on its pavement).
    const mod = (v) => {
      const m = ((v % CITY.pitch) + CITY.pitch) % CITY.pitch;
      return Math.min(m, CITY.pitch - m);
    };
    return mod(x) > CITY.roadWidth / 2 + CITY.pavement + 0.3 && mod(z) > CITY.roadWidth / 2 + CITY.pavement + 0.3;
  }

  // --- queries -----------------------------------------------------------

  nearestPedestrian(x, z, maxDist = Infinity) {
    let best = null;
    let bestD = maxDist;
    for (const p of this.peds) {
      if (p.down) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best ? { ped: best, distance: bestD } : null;
  }

  pedsInRadius(x, z, radius) {
    const out = [];
    for (const p of this.peds) {
      if (p.down) continue;
      if (Math.hypot(p.x - x, p.z - z) <= radius) out.push(p);
    }
    return out;
  }

  // A pedestrian hit by a fast player car falls over with a little upward pop.
  checkCarHits(car) {
    if (!car) return 0;
    const speed = Math.hypot(car.vx, car.vz);
    if (speed < 4.5) return 0;
    let hits = 0;
    const halfL = car.spec.length * 0.5;
    for (const p of this.peds) {
      if (p.down) continue;
      // A coarse capsule test against the car's footprint.
      const dx = p.x - car.x;
      const dz = p.z - car.z;
      const cos = Math.cos(car.angle);
      const sin = Math.sin(car.angle);
      const lx = dx * cos - dz * sin;
      const lz = dx * sin + dz * cos;
      if (Math.abs(lx) > car.spec.width * 0.62) continue;
      if (Math.abs(lz) > halfL + 0.3) continue;
      p.hit(clamp(speed / 12, 0.6, 1.8));
      this.scatter(car.x, car.z, 0.75);
      hits++;
    }
    return hits;
  }

  scatter(x, z, life = 1) {
    this.scatterPoints.push({ x, z, life });
    for (const p of this.peds) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < 24) p.fear = Math.max(p.fear, 2.4 + (1 - d / 24) * 3.2);
    }
  }

  clearScatter() {
    this.scatterPoints.length = 0;
    for (const p of this.peds) p.fear = 0;
  }

  reset() {
    for (const p of this.peds) {
      p.down = false;
      p.fear = 0;
      p.body.rotation.x = 0;
      p.y = 0;
    }
    this.scatterPoints.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Traffic cars
// ---------------------------------------------------------------------------

class TrafficCar {
  constructor(mgr, kind, x, z, angle, axis, dir) {
    this.mgr = mgr;
    this.spec = CAR_CLASSES[kind];
    this.x = x;
    this.z = z;
    this.angle = angle;
    this.vx = 0;
    this.vz = 0;
    this.speed = mgr.rng.range(7.5, 12.5);
    this.baseSpeed = this.speed;
    this.axis = axis;          // 'ns' or 'ew'
    this.dir = dir;            // +1 or -1 along the axis
    this.turnCooldown = mgr.rng.range(4, 12);
    this.car = mgr.vehicles.spawn(kind, x, z, angle, 'traffic', { headlights: true });
  }

  remove() {
    this.mgr.vehicles.remove(this.car);
  }

  update(dt) {
    const car = this.car;
    if (car.wrecked) {
      car.coast(dt);
      return;
    }
    const player = this.mgr.playerCar;
    let want = this.baseSpeed;

    // Keep a gap from whatever is ahead on the same line.
    for (const other of this.mgr.vehicles.cars) {
      if (other === car) continue;
      const dx = other.x - car.x;
      const dz = other.z - car.z;
      const ahead = dx * -Math.sin(this.angle) + dz * -Math.cos(this.angle);
      const side = Math.abs(dx * Math.cos(this.angle) - dz * Math.sin(this.angle));
      if (ahead > 0 && ahead < 15 && side < 2.6) {
        want = Math.min(want, Math.max(0, (ahead - 5.2) * 1.6));
      }
    }
    if (player) {
      const dx = player.x - car.x;
      const dz = player.z - car.z;
      const ahead = dx * -Math.sin(this.angle) + dz * -Math.cos(this.angle);
      const side = Math.abs(dx * Math.cos(this.angle) - dz * Math.sin(this.angle));
      if (ahead > 0 && ahead < 16 && side < 2.8) want = Math.min(want, Math.max(0, (ahead - 6) * 1.5));
    }

    // Slow to under half speed approaching a junction so turns look intentional.
    const nearJunction = this._junctionAhead();
    if (nearJunction) want = Math.min(want, this.baseSpeed * 0.45);

    this.speed += clamp(want - this.speed, -14 * dt, 9 * dt);
    if (this.speed < 0) this.speed = 0;

    // Sometimes turn at a junction onto a cross street.
    this.turnCooldown -= dt;
    if (nearJunction && this.turnCooldown <= 0 && this.mgr.rng.chance(0.28)) {
      this.turnCooldown = this.mgr.rng.range(8, 18);
      const newAxis = this.axis === 'ns' ? 'ew' : 'ns';
      const newDir = this.mgr.rng.sign();
      const jx = Math.round(this.x / CITY.pitch) * CITY.pitch;
      const jz = Math.round(this.z / CITY.pitch) * CITY.pitch;
      const off = laneOffset(newAxis, newDir);
      if (newAxis === 'ew') {
        this.x = jx;
        this.z = jz + off.z;
      } else {
        this.x = jx + off.x;
        this.z = jz;
      }
      this.axis = newAxis;
      this.dir = newDir;
      this.angle = headingFor(newAxis, newDir);
    }

    this.x += -Math.sin(this.angle) * this.speed * dt;
    this.z += -Math.cos(this.angle) * this.speed * dt;

    // Turn around at the city edge.
    if (this.x > CITY.seaEdge - 22 || this.x < -CITY.bound + 14 || this.z > CITY.bound - 14 || this.z < -CITY.bound + 14) {
      this.dir *= -1;
      this.angle += Math.PI;
      this.x = clamp(this.x, -CITY.bound + 16, CITY.seaEdge - 24);
      this.z = clamp(this.z, -CITY.bound + 16, CITY.bound - 16);
      this.turnCooldown = 4;
    }

    car.place(this.x, this.z, this.angle);
    car.updateLights(dt, this.speed < 1);
  }

  _junctionAhead() {
    const reach = 9 + this.speed * 0.55;
    const px = this.x - Math.sin(this.angle) * reach;
    const pz = this.z - Math.cos(this.angle) * reach;
    const jx = Math.round(px / CITY.pitch) * CITY.pitch;
    const jz = Math.round(pz / CITY.pitch) * CITY.pitch;
    if (this.axis === 'ew') return Math.abs(pz - jz) < 3 && Math.abs(jz - this.z) < reach;
    return Math.abs(px - jx) < 3 && Math.abs(jx - this.x) < reach;
  }
}

export class TrafficManager {
  constructor(scene, city, vehicles, seed) {
    this.scene = scene;
    this.city = city;
    this.vehicles = vehicles;
    this.rng = new Rng(`traffic-cars:${seed}`);
    this.cars = [];
    this.playerCar = null;
    this._spawnCars();
  }

  _spawnCars() {
    const rng = this.rng;
    const kinds = ['sedan', 'sedan', 'taxi', 'sedan', 'truck', 'sports'];
    const spots = [];
    for (const g of [-224, -160, -96, -32, 32, 96, 160, 224]) {
      for (let t = -CITY.bound + 40; t < CITY.bound - 40; t += 48) {
        spots.push({ g, t, horizontal: true });
        spots.push({ g, t, horizontal: false });
      }
    }
    for (let i = spots.length - 1; i > 0; i--) {
      const k = Math.floor(rng.next() * (i + 1));
      [spots[i], spots[k]] = [spots[k], spots[i]];
    }
    let made = 0;
    for (const spot of spots) {
      if (made >= TRAFFIC_COUNT) break;
      const kind = rng.pick(kinds);
      const dir = rng.sign();
      let x;
      let z;
      let axis;
      if (spot.horizontal) {
        axis = 'ew';
        x = spot.t;
        z = spot.g + laneOffset(axis, dir).z;
      } else {
        axis = 'ns';
        x = spot.g + laneOffset(axis, dir).x;
        z = spot.t;
      }
      const angle = headingFor(axis, dir);
      if (x > CITY.seaEdge - 10) continue;
      if (Math.hypot(x - 96, z + 196) < 22) continue;
      if (this.city.isBlocked(x, z, 2)) continue;
      let clash = false;
      for (const c of this.cars) {
        if (Math.hypot(c.x - x, c.z - z) < 12) { clash = true; break; }
      }
      if (clash) continue;
      this.cars.push(new TrafficCar(this, kind, x, z, angle, axis, dir));
      made++;
    }
  }

  update(dt, playerCar) {
    this.playerCar = playerCar;
    for (const c of this.cars) c.update(dt);
  }

  clear() {
    for (const c of this.cars) c.remove();
    this.cars.length = 0;
  }
}

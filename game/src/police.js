// Port Meridian — the harbour police.
// A zero-to-five-star wanted level. Stars are only raised by the game's crime feed, never
// here, and at most one step a second. Cruisers spawn at the edge of the map and steer at the
// player; on foot they close in and arrest.

import * as THREE from 'three';
import { CITY, HEAT } from './config.js';
import { Rng, clamp } from './random.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);

class PoliceUnit {
  constructor(mgr, car, officers) {
    this.mgr = mgr;
    this.car = car;
    this.officers = officers;
    this.ramCooldown = 1.2;
  }

  remove() {
    for (const o of this.officers) this.mgr.removeOfficer(o);
    this.officers.length = 0;
    this.mgr.vehicles.remove(this.car);
  }
}

export class Police {
  constructor(scene, city, vehicles, audio, seed) {
    this.scene = scene;
    this.city = city;
    this.vehicles = vehicles;
    this.audio = audio;
    this.rng = new Rng(`police:${seed}`);
    this.stars = 0;
    this.units = [];
    this.idle = 0;
    this.spawnTimer = 0;
    // Start far in the past so the first crime of a session is never swallowed by the
    // one-step-per-second gate.
    this.lastStarStep = -Infinity;
    this.clock = 0;
    this.bustTimer = 0;
    this.staticOfficers = [];
    this.onBusted = null;
    this.onArrestProgress = null;
    this.player = null;
    this.playerCar = null;
    this.nearestDistance = Infinity;
  }

  // --- wanted level ------------------------------------------------------

  raise(stars = 1) {
    if (this.clock - this.lastStarStep < HEAT.starStepCooldown) {
      // Queue at most one step past the cooldown rather than stacking.
      return false;
    }
    const next = clamp(this.stars + stars, 0, 5);
    if (next === this.stars) return false;
    this.stars = next;
    this.lastStarStep = this.clock;
    this.idle = 0;
    this.audio.wantedUp();
    return true;
  }

  cool(stars = 1) {
    this.stars = clamp(this.stars - stars, 0, 5);
    this.idle = 0;
    if (this.stars === 0) this.clearUnits();
  }

  clear() {
    this.stars = 0;
    this.idle = 0;
    this.bustTimer = 0;
    this.clearUnits();
  }

  clearUnits() {
    for (const u of this.units) u.remove();
    this.units.length = 0;
  }

  // --- spawning ----------------------------------------------------------

  _edgeSpawn() {
    // Put the cruiser on a road, just inside the city bound, far from the player.
    const p = this.player;
    for (let attempt = 0; attempt < 40; attempt++) {
      const edge = this.rng.int(0, 3);
      let x;
      let z;
      if (edge === 0) { x = this.rng.range(-CITY.bound + 20, CITY.bound - 20); z = -CITY.bound + 12; }
      else if (edge === 1) { x = this.rng.range(-CITY.bound + 20, CITY.seaEdge - 30); z = CITY.bound - 12; }
      else if (edge === 2) { x = -CITY.bound + 12; z = this.rng.range(-CITY.bound + 20, CITY.bound - 20); }
      else { x = this.city.seaEdge - 20; z = this.rng.range(-CITY.bound + 20, CITY.bound - 20); }
      // Snap onto the nearest road so the cruiser does not spawn inside a building.
      const road = this.city.nearestRoadPoint(x, z);
      x = road.x;
      z = road.z;
      if (this.city.isBlocked(x, z, 2.4)) continue;
      if (p && Math.hypot(x - p.x, z - p.z) < 90) continue;
      return { x, z };
    }
    const road = this.city.nearestRoadPoint(0, -CITY.bound + 16);
    return road;
  }

  _spawnUnit() {
    const spot = this._edgeSpawn();
    const angle = Math.atan2(-(this.player.x - spot.x), -(this.player.z - spot.z));
    const car = this.vehicles.spawn('police', spot.x, spot.z, angle, 'police', { headlights: true });
    // Each unit is a little tougher with more stars.
    car.health = car.spec.health * (1 + this.stars * 0.22);
    car.maxHealth = car.health;
    car.spec = { ...car.spec, topSpeed: car.spec.topSpeed * (0.9 + this.stars * 0.05) };
    car.unit = null;
    const unit = new PoliceUnit(this, car, []);
    car.unit = unit;
    this.units.push(unit);
    return unit;
  }

  _maxUnits() {
    return clamp(this.stars * HEAT.perStar - 1, 1, HEAT.maxUnits);
  }

  // --- officers on foot --------------------------------------------------

  _makeOfficer(x, z, angle) {
    const group = new THREE.Group();
    const navy = new THREE.MeshStandardMaterial({ color: 0x1b2540, roughness: 0.8 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x28345a, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc08a62, roughness: 0.8 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x131318, roughness: 0.85 });

    const add = (mat, w, h, d, px, py, pz, parent = group) => {
      const m = new THREE.Mesh(BOX, mat);
      m.scale.set(w, h, d);
      m.position.set(px, py, pz);
      parent.add(m);
      return m;
    };
    const legL = new THREE.Group();
    legL.position.set(-0.13, 0.88, 0);
    group.add(legL);
    add(navy, 0.19, 0.86, 0.22, 0, -0.44, 0, legL);
    add(shoe, 0.19, 0.1, 0.3, 0, -0.88, -0.04, legL);
    const legR = new THREE.Group();
    legR.position.set(0.13, 0.88, 0);
    group.add(legR);
    add(navy, 0.19, 0.86, 0.22, 0, -0.44, 0, legR);
    add(shoe, 0.19, 0.1, 0.3, 0, -0.88, -0.04, legR);
    add(shirt, 0.5, 0.6, 0.3, 0, 1.2, 0);
    add(navy, 0.54, 0.14, 0.34, 0, 0.92, 0);
    const armL = new THREE.Group();
    armL.position.set(-0.33, 1.44, 0);
    group.add(armL);
    add(shirt, 0.15, 0.5, 0.18, 0, -0.24, 0, armL);
    const armR = new THREE.Group();
    armR.position.set(0.33, 1.44, 0);
    group.add(armR);
    add(shirt, 0.15, 0.5, 0.18, 0, -0.24, 0, armR);
    add(skin, 0.28, 0.3, 0.27, 0, 1.65, 0);
    add(navy, 0.32, 0.13, 0.31, 0, 1.84, 0);
    // A small cap peak.
    add(navy, 0.3, 0.06, 0.16, 0, 1.82, -0.2);

    group.position.set(x, 0, z);
    group.rotation.y = angle;
    this.scene.add(group);
    const officer = {
      x, z, angle, group, legL, legR, armL, armR,
      phase: this.rng.range(0, 6), speed: 4.3, down: false,
    };
    return officer;
  }

  removeOfficer(o) {
    this.scene.remove(o.group);
    o.group.traverse((m) => {
      if (m.geometry && m.geometry !== BOX) m.geometry.dispose();
      if (m.material) m.material.dispose();
    });
  }

  addStaticOfficers(spots) {
    for (const s of spots) {
      const o = this._makeOfficer(s.x, s.z, s.angle ?? 0);
      o.static = true;
      this.staticOfficers.push(o);
    }
  }

  clearStaticOfficers() {
    for (const o of this.staticOfficers) this.removeOfficer(o);
    this.staticOfficers.length = 0;
  }

  // --- per-frame ---------------------------------------------------------

  update(dt, player, playerCar, mode) {
    this.clock += dt;
    this.player = player;
    this.playerCar = playerCar;

    if (mode !== 'play' && mode !== 'busted') {
      this.audio.updateSiren(999, false);
      return;
    }

    // Spawn up to the allowance, every few seconds.
    if (this.stars > 0) {
      this.spawnTimer -= dt;
      if (this.units.length < this._maxUnits() && this.spawnTimer <= 0) {
        this.spawnTimer = HEAT.spawnEvery;
        this._spawnUnit();
      }
    }

    let nearest = Infinity;
    for (const unit of this.units) {
      const d = this._updateUnit(unit, dt, player, playerCar);
      nearest = Math.min(nearest, d);
    }
    this.nearestDistance = nearest;

    // Heat decays when nothing is near and no crime has happened recently.
    if (this.stars > 0) {
      if (nearest > 120) this.idle += dt;
      else this.idle = Math.max(0, this.idle - dt * 0.6);
      if (this.idle >= HEAT.decayIdle) {
        this.cool(1);
        this.idle = 0;
      }
    }

    // On-foot arrest: standing within 3 units of an officer for 2.2 seconds.
    if (player && !player.hidden && this.stars > 0) {
      let close = false;
      for (const o of this.units) {
        for (const off of o.officers) {
          if (Math.hypot(off.x - player.x, off.z - player.z) < HEAT.bustRadius) close = true;
        }
      }
      for (const o of this.staticOfficers) {
        if (Math.hypot(o.x - player.x, o.z - player.z) < HEAT.bustRadius) close = true;
      }
      this.bustTimer = close ? this.bustTimer + dt : Math.max(0, this.bustTimer - dt * 1.8);
      if (this.onArrestProgress) this.onArrestProgress(this.bustTimer / HEAT.bustSeconds);
      if (this.bustTimer >= HEAT.bustSeconds) {
        this.bustTimer = 0;
        if (this.onBusted) this.onBusted();
      }
    } else {
      this.bustTimer = 0;
      if (this.onArrestProgress) this.onArrestProgress(0);
    }

    this.audio.updateSiren(nearest, this.stars > 0 && nearest < 190);
  }

  _updateUnit(unit, dt, player, playerCar) {
    const car = unit.car;
    const target = playerCar ?? player;
    if (!target) return Math.hypot(car.x, car.z);
    const dist = Math.hypot(target.x - car.x, target.z - car.z);

    if (car.wrecked) {
      // Wrecked cruisers spill their officers out.
      if (unit.officers.length === 0) {
        for (let i = 0; i < 2; i++) {
          const a = this.rng.range(0, Math.PI * 2);
          const o = this._makeOfficer(car.x + Math.cos(a) * 1.6, car.z + Math.sin(a) * 1.6, a);
          unit.officers.push(o);
        }
      }
      for (const o of unit.officers) this._stepOfficer(o, dt, player);
      return dist;
    }

    // Steer straight at the player, with a little lead on a moving car.
    let tx = target.x;
    let tz = target.z;
    if (playerCar) {
      tx += playerCar.vx * 0.35;
      tz += playerCar.vz * 0.35;
    }
    const desired = Math.atan2(-(tx - car.x), -(tz - car.z));
    let diff = desired - car.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const steer = clamp(diff * 1.8, -1, 1);

    // Slow down when the target is right in front, so the ram lands and the car does not
    // orbit the player forever.
    let throttle = 1;
    if (dist < 9 && !playerCar) throttle = 0.25;
    if (dist < 6) throttle = 0.1;

    const input = { throttle, brake: 0, steer, handbrake: 0 };
    this.vehicles.driveAi(car, input, dt);

    // Ram when close.
    unit.ramCooldown -= dt;
    if (playerCar && dist < 4.6 && unit.ramCooldown <= 0) {
      unit.ramCooldown = 1.6;
      const nx = (playerCar.x - car.x) / (dist || 1);
      const nz = (playerCar.z - car.z) / (dist || 1);
      playerCar.vx += nx * 5.2;
      playerCar.vz += nz * 5.2;
      const hitSpeed = Math.hypot(car.vx, car.vz);
      playerCar.applyDamage(7 + hitSpeed * 0.35);
      car.applyDamage(9);
      this.audio.crash(0.7);
      this.vehicles.crashShake = Math.max(this.vehicles.crashShake, 0.55);
      if (this.mgrOnRam) this.mgrOnRam(playerCar);
    }

    // Officers get out when the player is on foot nearby.
    if (!playerCar && dist < 17 && unit.officers.length === 0) {
      for (let i = 0; i < 2; i++) {
        const a = car.angle + (i === 0 ? 1.5 : -1.5);
        const o = this._makeOfficer(car.x + Math.cos(a) * 1.8, car.z + Math.sin(a) * 1.8, a);
        unit.officers.push(o);
      }
    }
    for (const o of unit.officers) this._stepOfficer(o, dt, player);
    return dist;
  }

  _stepOfficer(o, dt, player) {
    if (!player) return;
    const dx = player.x - o.x;
    const dz = player.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d > 2.6 && !player.hidden) {
      const step = Math.min(o.speed * dt, d);
      o.x += (dx / d) * step;
      o.z += (dz / d) * step;
      o.angle = Math.atan2(-dx, -dz);
      o.phase += dt * 9;
      const swing = Math.sin(o.phase) * 0.6;
      o.legL.rotation.x = swing;
      o.legR.rotation.x = -swing;
      o.armL.rotation.x = -swing * 0.85;
      o.armR.rotation.x = swing * 0.85;
    } else {
      o.legL.rotation.x *= 0.85;
      o.legR.rotation.x *= 0.85;
      o.armL.rotation.x *= 0.85;
      o.armR.rotation.x *= 0.85;
    }
    o.group.position.set(o.x, 0, o.z);
    o.group.rotation.y = o.angle;
  }
}

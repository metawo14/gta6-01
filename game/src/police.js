// Police and the wanted level. Stars are only ever raised by the crime feed in main.js;
// this module turns them into cruisers, chases, rams, arrests and decay.

import * as THREE from 'three';
import { CITY } from './config.js';
import { clamp } from './random.js';

const MAX_UNITS = 9;
const STAR_STEP_CD = 1.0;

export class PoliceSystem {
  constructor(scene, world, cars, audio) {
    this.scene = scene;
    this.world = world;
    this.cars = cars;
    this.audio = audio;
    this.stars = 0;
    this.pending = 0;
    this.starCd = 0;
    this.units = [];
    this.officers = [];
    this.spawnTimer = 0;
    this.heatTimer = 0;
    this.crimeTimer = 0;
    this.arrestT = 0;
    this.nearestDist = Infinity;
    this.onBusted = null;
    this.onStarChange = null;
    this._lastStars = 0;
  }

  setStars(n) {
    const v = clamp(Math.round(n), 0, 5);
    this.stars = v;
    this.pending = 0;
    this.starCd = 0;
    if (v === 0) this.despawnAll();
    if (this.onStarChange) this.onStarChange(v, this._lastStars);
    this._lastStars = v;
  }

  // The crime feed calls this; at most one step per second.
  raise(n = 1) {
    this.pending = Math.min(5, this.pending + n);
    this.crimeTimer = 13;
  }

  cool(n = 1) {
    this.stars = Math.max(0, this.stars - n);
    this.pending = Math.min(this.pending, this.stars);
    if (this.stars === 0) this.despawnAll();
    if (this.onStarChange) this.onStarChange(this.stars, this._lastStars);
    this._lastStars = this.stars;
  }

  get unitCount() {
    return Math.max(0, this.stars * 2 - 1);
  }

  wantedSpawnPoint() {
    // spawn at the edge of the map, behind the player when possible
    const a = Math.random() * Math.PI * 2;
    const r = CITY.bound - 25;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  spawnUnit(px, pz) {
    if (this.units.length >= Math.min(MAX_UNITS, this.unitCount)) return;
    let best = null;
    let bestD = -1;
    for (let i = 0; i < 8; i++) {
      const p = this.wantedSpawnPoint();
      if (this.world.isBlocked(p.x, p.z, 3)) continue;
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return;
    const car = this.cars.create('police', undefined, best.x, best.z, 0);
    car.driver = 'police';
    car.lightMode = 'auto';
    car.health = car.maxHealth + this.stars * 12;
    car.maxHealth = car.health;
    // face the player
    car.heading = Math.atan2(px - best.x, pz - best.z);
    car.place(best.x, best.z, car.heading);
    const unit = { car, ramCd: 0, stuck: 0 };
    this.units.push(unit);
    return unit;
  }

  despawnAll() {
    for (const u of this.units) {
      this.cars.remove(u.car);
    }
    this.units.length = 0;
    this.arrestT = 0;
  }

  // Static officers for the on-foot screenshot staging.
  placeOfficers(list) {
    this.clearOfficers();
    const suit = new THREE.MeshStandardMaterial({ color: 0x1b2c55, roughness: 0.8 });
    const light = new THREE.MeshStandardMaterial({ color: 0xd8dde8, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc9a184, roughness: 0.75 });
    for (const o of list) {
      const g = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.64, 0.32), suit);
      torso.position.y = 1.05;
      g.add(torso);
      const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.3, 0.34), light);
      vest.position.y = 1.16;
      g.add(vest);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.28), skin);
      head.position.y = 1.54;
      g.add(head);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.32), suit);
      cap.position.y = 1.72;
      g.add(cap);
      const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.7, 0.28), suit);
      legs.position.y = 0.4;
      g.add(legs);
      g.position.set(o.x, 0, o.z);
      g.rotation.y = o.heading || 0;
      this.scene.add(g);
      this.officers.push(g);
    }
  }

  clearOfficers() {
    for (const g of this.officers) this.scene.remove(g);
    this.officers.length = 0;
  }

  step(dt, player, playerCar, mode) {
    // star steps
    this.starCd = Math.max(0, this.starCd - dt);
    if (this.pending > this.stars && this.starCd <= 0) {
      const delta = Math.min(this.pending - this.stars, 1);
      this.stars += delta;
      this.starCd = STAR_STEP_CD;
      if (this.audio) this.audio.wantedUp();
      if (this.onStarChange) this.onStarChange(this.stars, this._lastStars);
      this._lastStars = this.stars;
    }
    this.crimeTimer = Math.max(0, this.crimeTimer - dt);

    if (this.stars === 0) {
      this.arrestT = 0;
      this.nearestDist = Infinity;
      if (this.units.length) this.despawnAll();
      return;
    }

    // spawn cruisers up to the cap for this star level
    this.spawnTimer -= dt;
    const want = Math.min(MAX_UNITS, this.unitCount);
    if (this.units.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = 1.25 - this.stars * 0.06;
      this.spawnUnit(playerCar ? playerCar.x : player.x, playerCar ? playerCar.z : player.z);
    }

    const px = playerCar && mode === 'driving' ? playerCar.x : player.x;
    const pz = playerCar && mode === 'driving' ? playerCar.z : player.z;
    let nearest = Infinity;
    let nearUnit = null;

    for (const u of this.units) {
      const car = u.car;
      u.ramCd = Math.max(0, u.ramCd - dt);
      if (car.wrecked) continue;
      const dx = px - car.x;
      const dz = pz - car.z;
      const dist = Math.hypot(dx, dz);
      if (dist < nearest) {
        nearest = dist;
        nearUnit = u;
      }
      // lead a moving target a little
      let tx = px;
      let tz = pz;
      if (playerCar && mode === 'driving') {
        const lead = clamp(dist / Math.max(6, this.stars * 8), 0, 0.8);
        tx += playerCar.vx * lead;
        tz += playerCar.vz * lead;
      }
      const desired = Math.atan2(tx - car.x, tz - car.z);
      let diff = desired - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      const steer = clamp(diff * 1.9, -1, 1);
      const maxSpeed = 26 + this.stars * 3.2;
      const fwd = car.forwardSpeed;
      let throttle = clamp((maxSpeed - fwd) * 0.6, -1, 1);
      // back off a hair when very close, so they do not park on the bumper
      if (dist < 5 && fwd > 6) throttle = -0.6;
      if (Math.abs(diff) > 1.8 && Math.abs(fwd) > 12) throttle = 0.35;

      // unstick: back up when jammed against something
      if (Math.abs(fwd) < 0.6 && throttle > 0.2) u.stuck += dt;
      else u.stuck = Math.max(0, u.stuck - dt * 2);
      if (u.stuck > 1.1) {
        throttle = -1;
        u.stuck = -0.4;
      }

      car.lightMode = 'auto';
      this.cars.stepAICar(car, dt, throttle, steer);

      // ramming
      if (mode === 'driving' && playerCar && dist < 4.6 && u.ramCd <= 0) {
        u.ramCd = 1.4;
        const d = Math.max(0.001, dist);
        playerCar.vx += (dx / d) * 6 * (0.6 + this.stars * 0.18);
        playerCar.vz += (dz / d) * 6 * (0.6 + this.stars * 0.18);
        playerCar.damage(4 + this.stars * 1.4);
        car.damage(6);
        car.vx -= (dx / d) * 3;
        car.vz -= (dz / d) * 3;
        if (this.cars.onCrash) this.cars.onCrash(car, 6);
      }

      // on foot: close in and arrest
      if (mode === 'foot' && dist < 3.0) {
        this.arrestT += dt;
        if (this.arrestT > 2.2 && this.onBusted) {
          this.arrestT = 0;
          this.onBusted();
        }
      }

      // heavily damaged police bail out
      if (car.health < car.maxHealth * 0.12) car.lightMode = 'red';
    }

    if (mode === 'foot') {
      const close = this.units.some((u) => !u.car.wrecked && Math.hypot(u.car.x - px, u.car.z - pz) < 3.0);
      if (!close) this.arrestT = Math.max(0, this.arrestT - dt * 1.5);
    }

    this.nearestDist = nearest;

    // heat builds when nothing is near and no crime is recent; then a star decays
    if (nearest > 46 && this.crimeTimer <= 0) {
      this.heatTimer += dt;
      if (this.heatTimer > 12) {
        this.heatTimer = 0;
        if (this.stars > 0) {
          this.stars -= 1;
          this.pending = Math.min(this.pending, this.stars);
          if (this.onStarChange) this.onStarChange(this.stars, this._lastStars);
          this._lastStars = this.stars;
          if (this.stars === 0) this.despawnAll();
        }
      }
    } else {
      this.heatTimer = Math.max(0, this.heatTimer - dt * 0.5);
    }

    // siren follows the nearest unit
    if (this.audio) {
      this.audio.setSiren(nearest < 220 ? 1 - nearest / 220 : 0, nearest < 60);
    }
  }

  get arrestProgress() {
    return clamp(this.arrestT / 2.2, 0, 1);
  }
}

// Vehicles: the car meshes, the arcade drivetrain, stealing and exiting, damage and
// the smoke/skid effects. One manager owns every car in the city, player-driven or not.
import * as THREE from 'three';
import { CAR_TYPES, CITY, PALETTE } from './config.js';

const ENGINE_DRAG = 0.55;
const LAT_GRIP = 6.4;

function mat(color, rough = 0.42, metal = 0.35) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

export function buildCarMesh(type, color, plate = 0) {
  const spec = CAR_TYPES[type];
  const g = new THREE.Group();
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;

  const bodyMat = mat(color);
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.55, L), bodyMat);
  body.position.y = H * 0.42;
  g.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, H * 0.55, L * 0.46), mat(0x1b2430, 0.18, 0.6));
  cabin.position.set(0, H * 0.86, type === 'truck' ? L * 0.18 : -L * 0.04);
  g.add(cabin);

  if (type === 'truck') {
    const box = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.9, L * 0.55), mat(0x8d8f96, 0.7, 0.1));
    box.position.set(0, H * 1.02, -L * 0.2);
    g.add(box);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
  const wheelMat = mat(0x15161a, 0.9, 0.05);
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(sx * (W / 2 - 0.06), 0.42, sz * (L / 2 - 0.85));
      g.add(w);
      wheels.push(w);
    }
  }

  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2cc });
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.1), lightMat);
    lamp.position.set(sx * (W / 2 - 0.35), H * 0.52, L / 2 - 0.02);
    g.add(lamp);
  }
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xd8342c });
  const tails = [];
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.09), tailMat);
    lamp.position.set(sx * (W / 2 - 0.32), H * 0.5, -L / 2 + 0.02);
    g.add(lamp);
    tails.push(lamp);
  }

  let bar = null;
  let barL = null;
  let barR = null;
  if (type === 'police') {
    const white = mat(0xe8ecf2, 0.5, 0.2);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 1.01, H * 0.22, L * 0.3), white);
    stripe.position.set(0, H * 0.55, 0);
    g.add(stripe);
    bar = new THREE.Mesh(new THREE.BoxGeometry(W * 0.72, 0.16, 0.3), mat(0x121822, 0.6, 0.2));
    bar.position.set(0, H * 1.16, -0.2);
    g.add(bar);
    barL = new THREE.Mesh(new THREE.BoxGeometry(W * 0.32, 0.18, 0.34), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    barL.position.set(-W * 0.2, H * 1.22, -0.2);
    g.add(barL);
    barR = new THREE.Mesh(new THREE.BoxGeometry(W * 0.32, 0.18, 0.34), new THREE.MeshBasicMaterial({ color: 0x2040ff }));
    barR.position.set(W * 0.2, H * 1.22, -0.2);
    g.add(barR);
  }
  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.24, 0.3), new THREE.MeshBasicMaterial({ color: 0xffcf4d }));
    sign.position.set(0, H * 1.2, -0.1);
    g.add(sign);
  }

  g.userData = { wheels, tails, barL, barR, lights: tails, spec };
  return g;
}

export class Vehicle {
  constructor(scene, type, color, x, z, heading, tag = 'parked') {
    this.type = type;
    this.spec = CAR_TYPES[type];
    this.tag = tag;
    this.mesh = buildCarMesh(type, color, 0);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.hp = this.spec.hp;
    this.maxHp = this.spec.hp;
    this.driver = null;
    this.wrecked = false;
    this.sirenPhase = 0;
    this.smokeTimer = 0;
    this.brake = false;
    this.throttle = 0;
    this.bumpCooldown = 0;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  get right() {
    return new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }

  get position() {
    return this.pos;
  }

  damage(amount) {
    if (this.wrecked) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.wrecked = true;
      return true;
    }
    return false;
  }

  syncMesh() {
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
    const u = this.mesh.userData;
    const spin = this.speed * 0.4;
    for (let i = 0; i < u.wheels.length; i++) {
      const w = u.wheels[i];
      w.rotation.x += spin * 0.06;
      if (i >= 2) w.rotation.y = this.steer * 0.4;
    }
    if (u.barL && u.barR) {
      this.sirenPhase += 0.22;
      const on = Math.sin(this.sirenPhase) > 0;
      u.barL.material.color.setHex(on ? 0xff2020 : 0x401010);
      u.barR.material.color.setHex(on ? 0x102040 : 0x2040ff);
    }
    if (u.tails) {
      const braking = this.brake || this.speed < -0.5;
      for (const t of u.tails) t.material.color.setHex(braking ? 0xff5a3c : 0x7a1a16);
    }
  }
}

export class VehicleManager {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.cars = [];
    this.rng = null;
    this.smoke = [];
    this.smokePool = [];
    this.skid = [];
    this.shake = 0;
  }

  attachRng(rng) {
    this.rng = rng;
  }

  spawn(type, color, x, z, heading, tag = 'parked') {
    const car = new Vehicle(this.scene, type, color, x, z, heading, tag);
    this.cars.push(car);
    return car;
  }

  remove(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    this.scene.remove(car.mesh);
  }

  nearest(pos, radius, filter = null) {
    let best = null;
    let bestD = radius;
    for (const c of this.cars) {
      if (filter && !filter(c)) continue;
      const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  step(dt, player, police, onCrash) {
    for (const car of this.cars) {
      if (car.driver === 'player') this.stepPlayerCar(dt, car, player);
      else if (car.driver) this.stepAiCar(dt, car);
      else this.stepCoast(dt, car);
      this.collideWorld(car, dt, onCrash);
      car.syncMesh();
      if (car.hp < car.maxHp * 0.45) this.emitSmoke(car, dt);
    }
    this.separate(onCrash);
    this.stepSmoke(dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
  }

  stepPlayerCar(dt, car, player) {
    const input = player.input;
    const spec = car.spec;
    const axis = input.axis();
    const accel = input.down('back') ? -1 : input.down('forward') ? 1 : 0;
    const handbrake = input.down('sprint') || input.down('jump');

    const fwd = car.forward;
    const right = car.right;
    let vLong = car.vel.dot(fwd);
    let vLat = car.vel.dot(right);

    if (accel > 0) vLong += spec.accel * dt * (vLong < 0 ? 2.0 : 1);
    else if (accel < 0) vLong -= spec.accel * dt * (vLong > 0 ? 2.2 : 0.7);
    else vLong *= 1 - 1.4 * dt;

    const top = spec.maxSpeed;
    vLong = Math.max(-top * 0.4, Math.min(top, vLong));
    vLong *= 1 - ENGINE_DRAG * dt * 0.1;
    if (handbrake) vLong *= 1 - 1.3 * dt;

    const grip = handbrake ? 0.55 : LAT_GRIP * spec.grip;
    vLat *= Math.max(0, 1 - grip * dt);

    const steerInput = (axis.x > 0 ? 1 : 0) - (axis.x < 0 ? 1 : 0) + (axis.x);
    const speedRatio = Math.min(1, Math.abs(vLong) / spec.maxSpeed);
    const turnRate = spec.turn * (0.35 + 0.65 * (1 - speedRatio)) * (vLong < 0 ? -1 : 1);
    car.heading += -Math.sign(axis.x || 0) * turnRate * dt * 0.55 * Math.min(1, Math.abs(vLong) / 4);
    if (handbrake && Math.abs(vLong) > 6) {
      car.heading += (axis.x || 0) * 0.9 * dt * Math.sign(vLong);
      vLat += (axis.x || 0) * Math.abs(vLong) * 1.4 * dt;
    }

    const nf = car.forward;
    const nr = car.right;
    car.vel.copy(nf).multiplyScalar(vLong).addScaledVector(nr, vLat);
    car.speed = vLong;
    car.brake = input.down('back') && vLong > 1;
    car.pos.addScaledVector(car.vel, dt);
    car.throttle = accel;
    car.steer += ((axis.x || 0) - car.steer) * Math.min(1, 8 * dt);

    if (Math.abs(vLat) > 5 && Math.abs(vLong) > 8) this.emitSkid(car);
  }

  stepAiCar(dt, car) {
    const fwd = car.forward;
    let vLong = car.vel.dot(fwd);
    vLong += car.spec.accel * dt * (car.aiThrottle ?? 0.3);
    vLong = Math.min(car.aiMaxSpeed ?? car.spec.maxSpeed * 0.55, vLong);
    car.vel.copy(fwd).multiplyScalar(vLong);
    car.speed = vLong;
    if (car.aiHeading !== undefined) {
      let diff = car.aiHeading - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      car.heading += Math.max(-1, Math.min(1, diff * 2)) * Math.min(1.6, Math.abs(vLong) * 0.12) * dt;
    }
    car.pos.addScaledVector(car.vel, dt);
  }

  stepCoast(dt, car) {
    car.vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
    car.pos.addScaledVector(car.vel, dt);
    car.speed = car.vel.length() * Math.sign(car.vel.dot(car.forward));
  }

  collideWorld(car, dt, onCrash) {
    car.bumpCooldown = Math.max(0, car.bumpCooldown - dt);
    const spec = car.spec;
    const points = [
      [0, spec.length * 0.42],
      [0, -spec.length * 0.42],
      [spec.width * 0.4, 0],
      [-spec.width * 0.4, 0],
    ];
    let hitSpeed = 0;
    for (const [lx, lz] of points) {
      const p = {
        x: car.pos.x + Math.cos(car.heading) * lx + Math.sin(car.heading) * lz,
        z: car.pos.z - Math.sin(car.heading) * lx + Math.cos(car.heading) * lz,
      };
      if (this.world.blocked(p.x, p.z, 0.25)) {
        hitSpeed = Math.max(hitSpeed, car.vel.length());
        const nx = car.pos.x - p.x;
        const nz = car.pos.z - p.z;
        const len = Math.hypot(nx, nz) || 1;
        car.pos.x += (nx / len) * 0.42;
        car.pos.z += (nz / len) * 0.42;
        car.vel.multiplyScalar(-0.18);
        car.speed *= -0.2;
        break;
      }
    }
    for (let i = 0; i < this.world.props.length; i++) {
      const prop = this.world.props[i];
      const d = Math.hypot(prop.x - car.pos.x, prop.z - car.pos.z);
      if (d < prop.r + spec.width * 0.5 && Math.abs(car.vel.length()) > 3) {
        hitSpeed = Math.max(hitSpeed, car.vel.length());
        if (prop.mesh) prop.mesh.visible = false;
        prop.r = 0.001;
        car.vel.multiplyScalar(0.82);
      }
    }
    if (hitSpeed > 6 && car.bumpCooldown <= 0) {
      car.bumpCooldown = 0.45;
      car.damage(hitSpeed * 1.2);
      this.shake = Math.min(1, this.shake + hitSpeed / 60);
      if (car.driver === 'player') this.audio.crash(Math.min(1.6, hitSpeed / 14));
      if (onCrash) onCrash(car, hitSpeed);
    }
    car.pos.x = Math.max(-CITY.bound, Math.min(CITY.bound, car.pos.x));
    car.pos.z = Math.max(-CITY.bound, Math.min(CITY.bound, car.pos.z));
    if (car.pos.x > CITY.waterAt - 3) {
      car.pos.x = CITY.waterAt - 3;
      car.vel.multiplyScalar(-0.3);
    }
  }

  separate(onCrash) {
    for (let i = 0; i < this.cars.length; i++) {
      const a = this.cars[i];
      for (let j = i + 1; j < this.cars.length; j++) {
        const b = this.cars[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const minD = (a.spec.width + b.spec.width) * 0.5 + 0.25;
        const d = Math.hypot(dx, dz);
        if (d < minD && d > 0.001) {
          const push = (minD - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.pos.x -= nx * push;
          a.pos.z -= nz * push;
          b.pos.x += nx * push;
          b.pos.z += nz * push;
          const rel = Math.abs(a.vel.length() + b.vel.length());
          if (rel > 8) {
            const dmg = rel * 0.7;
            a.damage(dmg);
            b.damage(dmg);
            if (onCrash) onCrash(a, rel, b);
            if (a.driver === 'player' || b.driver === 'player') {
              this.audio.crash(1);
              this.shake = Math.min(1, this.shake + 0.3);
            }
          }
        }
      }
    }
  }

  emitSmoke(car, dt) {
    car.smokeTimer -= dt;
    if (car.smokeTimer > 0) return;
    car.smokeTimer = car.wrecked ? 0.06 : 0.16;
    let puff = this.smokePool.pop();
    if (!puff) {
      puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 6, 5),
        new THREE.MeshBasicMaterial({ color: 0x3c3a40, transparent: true, opacity: 0.55 }),
      );
      this.scene.add(puff);
    }
    puff.visible = true;
    puff.material.opacity = 0.55;
    puff.scale.setScalar(1);
    puff.position.set(car.pos.x, 1.2, car.pos.z);
    puff.userData.life = 1.6;
    puff.userData.vy = 1.4;
    this.smoke.push(puff);
  }

  emitSkid(car) {
    let puff = this.smokePool.pop();
    if (!puff) {
      puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.28, 5, 4),
        new THREE.MeshBasicMaterial({ color: 0x9a9182, transparent: true, opacity: 0.4 }),
      );
      this.scene.add(puff);
    }
    puff.visible = true;
    puff.material.opacity = 0.35;
    puff.scale.set(0.9, 0.4, 0.9);
    puff.position.set(car.pos.x, 0.25, car.pos.z);
    puff.userData.life = 0.5;
    puff.userData.vy = 0.4;
    this.smoke.push(puff);
  }

  stepSmoke(dt) {
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.userData.life -= dt;
      p.position.y += p.userData.vy * dt;
      p.scale.multiplyScalar(1 + dt * 0.9);
      p.material.opacity = Math.max(0, p.userData.life * 0.3);
      if (p.userData.life <= 0) {
        p.visible = false;
        this.smoke.splice(i, 1);
        this.smokePool.push(p);
      }
    }
  }

  reset() {
    for (const car of [...this.cars]) {
      if (car.tag !== 'parked') this.remove(car);
    }
    for (const car of this.cars) {
      car.hp = car.maxHp;
      car.wrecked = false;
      car.driver = null;
      car.vel.set(0, 0, 0);
    }
  }
}

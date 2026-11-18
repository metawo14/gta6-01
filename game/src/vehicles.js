// Vehicles: the low-poly car builder, the arcade handling model, the AI driver used by traffic
// and police, and the smoke/skid particle pools that sell speed and damage.
//
// Lighting note: the headlight *lenses* and glow sprites stay bright, but the long additive
// cones and the road pool are deliberately dim (0.05 and 0.07 at boost 1). At the old 0.09/0.1
// they stacked with each other and washed the whole frame white in the night shot.
import * as THREE from 'three';
import { CAR_TYPES, CITY } from './config.js';

const ENGINE_DRAG = 0.55;
const LAT_GRIP = 6.4;
const TAU = Math.PI * 2;
const SIDE = THREE.DoubleSide;

function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

function paint(color, rough = 0.42, metal = 0.35) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function additive(color, opacity, extra = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    ...extra,
  });
}

function lightPool(w, d) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), additive(0xfff0cc, 0.16));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// A soft beam of light lying along the road ahead of the car. Kept short and faint.
function lightCone(radius, length) {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, length, 12, 1, true),
    additive(0xffe8b8, 0.07, { side: SIDE }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = length / 2 + 0.2;
  return mesh;
}

// --- the car itself -------------------------------------------------------
export function buildCarMesh(type, color) {
  const spec = CAR_TYPES[type];
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;
  const isTruck = type === 'truck';
  const isPolice = type === 'police';

  const root = new THREE.Group();
  const wheels = [];
  const tails = [];
  const heads = [];
  const headGlows = [];

  // Body: three stacked boxes so the silhouette has a shoulder and a dark sill.
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.54, L), paint(color, 0.4, 0.42));
  body.position.y = H * 0.44;
  root.add(body);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(W * 0.97, H * 0.2, L * 0.86), paint(color, 0.34, 0.5));
  shoulder.position.y = H * 0.72;
  root.add(shoulder);

  const sill = new THREE.Mesh(new THREE.BoxGeometry(W * 1.01, H * 0.14, L * 0.94), paint(0x14161c, 0.7, 0.2));
  sill.position.y = H * 0.2;
  root.add(sill);

  // Cabin glass.
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.84, H * 0.46, L * (isTruck ? 0.3 : 0.44)),
    paint(0x101820, 0.14, 0.72),
  );
  cabin.position.set(0, H * 0.82, isTruck ? L * 0.2 : -L * 0.05);
  root.add(cabin);

  if (isTruck) {
    const cargo = new THREE.Mesh(
      new THREE.BoxGeometry(W, H * 0.92, L * 0.52),
      paint(0x9a9ca4, 0.72, 0.12),
    );
    cargo.position.set(0, H * 0.98, -L * 0.19);
    root.add(cargo);
  }

  // Wheels: four dark cylinders with a lighter hub, in the order rear-left, rear-right,
  // front-left, front-right so indices 2 and 3 are the steered pair.
  const tyreGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.3, 12);
  const hubGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.32, 8);
  for (const z of [-L / 2 + 0.9, L / 2 - 0.9]) {
    for (const sx of [-1, 1]) {
      const tyre = new THREE.Mesh(tyreGeo, paint(0x14151a, 0.92, 0.04));
      tyre.rotation.z = Math.PI / 2;
      tyre.position.set(sx * (W / 2 - 0.05), 0.43, z);
      const hub = new THREE.Mesh(hubGeo, paint(0x8d919b, 0.5, 0.5));
      hub.rotation.z = Math.PI / 2;
      tyre.add(hub);
      root.add(tyre);
      wheels.push(tyre);
    }
  }

  // Headlights: a small bright lens, a soft glow card, and one dim beam cone each side.
  const lensGeo = new THREE.BoxGeometry(0.34, 0.17, 0.1);
  const glowGeo = new THREE.PlaneGeometry(0.8, 0.5);
  for (const sx of [-1, 1]) {
    const lx = sx * (W / 2 - 0.34);
    const lens = new THREE.Mesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xfffbe8 }));
    lens.position.set(lx, H * 0.54, L / 2 - 0.01);
    root.add(lens);
    heads.push(lens);

    const glow = new THREE.Mesh(glowGeo, additive(0xfff2cf, 0.5));
    glow.position.set(lx, H * 0.54, L / 2 + 0.03);
    root.add(glow);
    headGlows.push(glow);

    const beam = lightCone(1.5, isTruck ? 13 : 11);
    beam.position.x = sx * (W / 2 - 0.4);
    beam.position.y = H * 0.5;
    root.add(beam);
  }

  const pool = lightPool(W * 1.6, isTruck ? 15 : 12);
  pool.position.set(0, 0.07, L / 2 + (isTruck ? 7 : 5.5));
  root.add(pool);

  // Taillights: the lamp is cloned per side because its colour changes with braking.
  const tailGeo = new THREE.BoxGeometry(0.3, 0.15, 0.09);
  const auraGeo = new THREE.PlaneGeometry(0.62, 0.4);
  for (const sx of [-1, 1]) {
    const tx = sx * (W / 2 - 0.32);
    const lamp = new THREE.Mesh(tailGeo, new THREE.MeshBasicMaterial({ color: 0x8e1d17 }));
    lamp.position.set(tx, H * 0.52, -L / 2 + 0.01);
    const aura = new THREE.Mesh(auraGeo, additive(0xff3a26, 0.28));
    aura.position.set(tx, H * 0.52, -L / 2 - 0.03);
    aura.rotation.y = Math.PI;
    lamp.userData.aura = aura;
    root.add(lamp);
    root.add(aura);
    tails.push(lamp);
  }

  let barL = null;
  let barR = null;
  let barHaloL = null;
  let barHaloR = null;

  if (isPolice) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(W * 1.012, H * 0.2, L * 0.26), paint(0xeceff4, 0.5, 0.16));
    band.position.set(0, H * 0.52, 0.1);
    root.add(band);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 1.014, H * 0.06, L * 0.26), paint(0x1b2a44, 0.5, 0.16));
    stripe.position.set(0, H * 0.42, 0.1);
    root.add(stripe);

    const housing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.14, 0.34), paint(0x121822, 0.6, 0.25));
    housing.position.set(0, H * 1.12, -0.15);
    root.add(housing);

    const barGeo = new THREE.BoxGeometry(W * 0.34, 0.19, 0.36);
    barL = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0xff2b2b }));
    barL.position.set(-W * 0.2, H * 1.2, -0.15);
    root.add(barL);

    barR = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x2b46ff }));
    barR.position.set(W * 0.2, H * 1.2, -0.15);
    root.add(barR);

    const haloGeo = new THREE.SphereGeometry(0.78, 10, 8);
    barHaloL = new THREE.Mesh(haloGeo, additive(0xff2733, 0.45));
    barHaloL.position.copy(barL.position);
    barHaloL.scale.set(1.4, 0.7, 1.1);
    root.add(barHaloL);

    barHaloR = new THREE.Mesh(haloGeo, additive(0x2f52ff, 0.45));
    barHaloR.position.copy(barR.position);
    barHaloR.scale.set(1.4, 0.7, 1.1);
    root.add(barHaloR);

    const spill = lightPool(4.6, 5.2);
    spill.position.set(0, 0.08, -1.1);
    root.add(spill);
    barHaloL.userData.spill = spill;
  }

  if (type === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.24, 0.32), new THREE.MeshBasicMaterial({ color: 0xffd24d }));
    sign.position.set(0, H * 1.16, -0.1);
    root.add(sign);
  }

  root.userData = {
    wheels,
    tails,
    heads,
    headGlows,
    beam: root.children.filter((c) => c.geometry instanceof THREE.ConeGeometry),
    pool,
    barL,
    barR,
    barHaloL,
    barHaloR,
    spec,
  };
  return root;
}

// --- one simulated car ----------------------------------------------------
export class Vehicle {
  constructor(scene, type, color, x, z, heading, tag = 'parked') {
    this.scene = scene;
    this.type = type;
    this.tag = tag;
    this.spec = CAR_TYPES[type];
    this.mesh = buildCarMesh(type, color);
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = heading;
    scene.add(this.mesh);

    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.hp = this.maxHp = this.spec.hp;
    this.driver = null;
    this.wrecked = false;
    this.brake = false;
    this.throttle = 0;
    this.bumpCooldown = 0;
    this.smokeTimer = 0;
    this.sirenClock = Math.random() * 2;
    this.lampMode = 'auto';
    this.lampBoost = 1;
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

  get width() {
    return this.spec.width;
  }

  get length() {
    return this.spec.length;
  }

  damage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.wrecked = true;
      return true;
    }
    return false;
  }

  setLampMode(mode) {
    this.lampMode = mode;
    const ud = this.mesh.userData;
    if (mode === 'auto' || !ud.barL) return;
    const redOn = mode === 'red';
    const blueOn = mode === 'blue';
    ud.barL.material.color.setHex(redOn ? 0xff2b2b : 0x3a0d0d);
    ud.barR.material.color.setHex(blueOn ? 0x2b46ff : 0x0d1438);
    ud.barHaloL.material.opacity = redOn ? 0.72 : 0.06;
    ud.barHaloR.material.opacity = blueOn ? 0.72 : 0.06;
    const spill = ud.barHaloL.userData.spill;
    if (spill) {
      spill.material.color.setHex(redOn ? 0xff2733 : blueOn ? 0x2f52ff : 0x333333);
      spill.material.opacity = redOn || blueOn ? 0.2 : 0.02;
    }
  }

  syncMesh() {
    const ud = this.mesh.userData;
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.heading;

    for (let i = 0; i < ud.wheels.length; i++) {
      const wheel = ud.wheels[i];
      wheel.rotation.x += this.speed * 1.9 * 0.016;
      if (i >= 2) wheel.rotation.y = this.steer * 0.42;
    }

    const lit = this.lampMode === 'off' ? 0 : 1;
    const boost = this.lampBoost * (lit ? 1 : 0);
    if (ud.pool) ud.pool.material.opacity = 0.07 * boost;
    for (const beam of ud.beam) beam.material.opacity = 0.05 * boost;
    for (const glow of ud.headGlows) glow.material.opacity = 0.4 * boost;

    const braking = this.brake || this.speed < -0.5 || (!!this.driver && this.throttle < 0);
    for (const lamp of ud.tails) {
      lamp.material.color.setHex(braking ? 0xff4630 : 0x8e1d17);
      const aura = lamp.userData.aura;
      if (aura) aura.material.opacity = braking ? 0.55 : 0.22;
    }

    if (!ud.barL) return;
    const spill = ud.barHaloL.userData.spill;
    if (this.lampMode === 'auto') {
      this.sirenClock += 0.016;
      const phase = Math.floor(this.sirenClock * 3.4) % 2 === 0;
      ud.barL.material.color.setHex(phase ? 0xff2b2b : 0x3a0d0d);
      ud.barR.material.color.setHex(phase ? 0x0d1438 : 0x2b46ff);
      ud.barHaloL.material.opacity = phase ? 0.66 : 0.08;
      ud.barHaloR.material.opacity = phase ? 0.08 : 0.66;
      if (spill) {
        spill.material.color.setHex(phase ? 0xff2733 : 0x2f52ff);
        spill.material.opacity = 0.19;
      }
    } else {
      const redOn = this.lampMode === 'red';
      const blueOn = this.lampMode === 'blue';
      ud.barHaloL.material.opacity = redOn ? 0.66 : 0.08;
      ud.barHaloR.material.opacity = blueOn ? 0.66 : 0.08;
    }
  }
}

// --- the manager ----------------------------------------------------------
export class VehicleManager {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.cars = [];
    this.rng = null;
    this.smoke = [];
    this.smokePool = [];
    this.marks = [];
    this.markPool = [];
    this.shake = 0;
  }

  attachRng(rng) {
    this.rng = rng;
    return this;
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
    for (const car of this.cars) {
      if (filter && !filter(car)) continue;
      const d = Math.hypot(car.pos.x - pos.x, car.pos.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  step(dt, player, police, onCrash) {
    for (const car of this.cars) {
      if (car.driver === 'player') this.drivePlayer(dt, car, player);
      else if (car.driver) this.driveAi(dt, car);
      else this.coast(dt, car);

      this.hitWorld(car, dt, onCrash);
      car.syncMesh();
      if (car.hp < car.maxHp * 0.45) this.emitSmoke(car, dt);
    }
    this.pushApart(onCrash);
    this.stepParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
  }

  drivePlayer(dt, car, player) {
    const input = player.input;
    if (!input) return;
    const axis = input.axis();
    const throttleDown = input.down('forward');
    const brakeDown = input.down('back');
    const handbrake = input.down('sprint') || input.down('jump');
    const spec = car.spec;
    const fwd = car.forward;
    const rgt = car.right;
    let long = car.vel.dot(fwd);
    let lat = car.vel.dot(rgt);

    if (throttleDown) long += spec.accel * dt * (long < 0 ? 2 : 1);
    if (brakeDown) long -= spec.accel * dt * (long > 0 ? 2.2 : 0.7);
    else if (!throttleDown) long *= 1 - 1.4 * dt;

    long = Math.max(-spec.maxSpeed * 0.4, Math.min(spec.maxSpeed, long));
    long *= 1 - ENGINE_DRAG * dt * 0.1;
    if (handbrake) long *= 1 - 1.3 * dt;

    const grip = handbrake ? 0.55 : LAT_GRIP * spec.grip;
    lat *= Math.max(0, 1 - grip * dt);

    const limit = Math.min(1, Math.abs(long) / spec.maxSpeed);
    const rate = spec.turn * (0.42 + 0.58 * (1 - limit)) * (long < 0 ? -1 : 1);
    const steerSign = Math.sign(axis.x || 0);
    car.heading += -steerSign * rate * dt * 0.62 * Math.min(1, Math.abs(long) / 3.2);

    if (handbrake && Math.abs(long) > 6) {
      car.heading += axis.x * 0.95 * dt * Math.sign(long);
    }
    lat += axis.x * Math.abs(long) * 1.45 * dt;

    car.vel.copy(fwd).multiplyScalar(long).addScaledVector(rgt, lat);
    car.speed = long;
    car.brake = brakeDown && long > 1;
    car.throttle = throttleDown ? 1 : brakeDown ? -1 : 0;

    car.pos.addScaledVector(car.vel, dt);
    car.steer += (axis.x - car.steer) * Math.min(1, 9 * dt);

    if (Math.abs(lat) > 4.6 && Math.abs(long) > 7) this.emitSkid(car);
  }

  driveAi(dt, car) {
    const fwd = car.forward;
    let long = car.vel.dot(fwd);
    long += car.spec.accel * dt * (car.aiThrottle ?? 0.3);
    long = Math.min(car.aiMaxSpeed ?? car.spec.maxSpeed * 0.55, long);
    car.vel.copy(fwd).multiplyScalar(long);
    car.speed = long;

    if (car.aiHeading !== undefined) {
      const diff = wrapAngle(car.aiHeading - car.heading);
      const turn = Math.max(-1, Math.min(1, diff * 2));
      car.heading += turn * Math.min(1.6, Math.abs(long) * 0.12) * dt;
    }
    car.pos.addScaledVector(car.vel, dt);
  }

  coast(dt, car) {
    car.vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
    car.pos.addScaledVector(car.vel, dt);
    car.speed = car.vel.length() * Math.sign(car.vel.dot(car.forward));
  }

  hitWorld(car, dt, onCrash) {
    car.bumpCooldown = Math.max(0, car.bumpCooldown - dt);
    const w = car.width;
    const l = car.length;
    const cos = Math.cos(car.heading);
    const sin = Math.sin(car.heading);
    const probes = [
      [w * 0.4, 0],
      [-w * 0.4, 0],
      [0, l * 0.42],
      [0, -l * 0.42],
    ];
    let impact = 0;

    for (const [ox, oz] of probes) {
      const dx = ox * cos + oz * sin;
      const dz = -ox * sin + oz * cos;
      const x = car.pos.x + dx;
      const z = car.pos.z + dz;
      if (this.world.blocked(x, z, 0.25)) {
        impact = Math.max(impact, car.vel.length());
        const len = Math.hypot(dx, dz) || 1;
        car.pos.x += (dx / len) * 0.42;
        car.pos.z += (dz / len) * 0.42;
        car.vel.multiplyScalar(-0.18);
        car.speed *= -0.2;
        break;
      }
    }

    for (const prop of this.world.props) {
      if (prop.r <= 0.01) continue;
      const d = Math.hypot(prop.x - car.pos.x, prop.z - car.pos.z);
      if (d < prop.r + w * 0.5 && Math.abs(car.speed) > 3) {
        impact = Math.max(impact, Math.abs(car.speed));
        if (prop.mesh) prop.mesh.visible = false;
        prop.r = 0.001;
        car.vel.multiplyScalar(0.82);
      }
    }

    if (impact > 6 && car.bumpCooldown <= 0) {
      car.bumpCooldown = 0.45;
      car.damage(impact * 1.2);
      this.shake = Math.min(1, this.shake + impact / 60);
      this.audio.crash(min(1.6, impact / 14));
      if (onCrash) onCrash(car, impact);
    }

    const bound = CITY.bound;
    car.pos.x = Math.max(-bound, Math.min(bound - 2, car.pos.x));
    car.pos.z = Math.max(-bound, Math.min(bound, car.pos.z));
    if (car.pos.x > CITY.waterAt - 3) {
      car.pos.x = CITY.waterAt - 3;
      car.vel.multiplyScalar(-0.3);
    }
  }

  pushApart(onCrash) {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        let dx = b.pos.x - a.pos.x;
        let dz = b.pos.z - a.pos.z;
        let d = Math.hypot(dx, dz);
        const minD = (a.width + b.width) * 0.5 + 0.25;
        if (d >= minD) continue;
        if (d < 1e-3) {
          dx = Math.sin(a.heading);
          dz = Math.cos(a.heading);
          d = 1;
        }
        const overlap = minD - d;
        const nx = dx / d;
        const nz = dz / d;
        a.pos.x -= nx * overlap * 0.5;
        a.pos.z -= nz * overlap * 0.5;
        b.pos.x += nx * overlap * 0.5;
        b.pos.z += nz * overlap * 0.5;

        const rel = a.vel.length() + b.vel.length();
        if (rel > 8) {
          a.damage(rel * 0.7);
          b.damage(rel * 0.7);
          if (onCrash) onCrash(a, rel, b);
          if (a.driver === 'player' || b.driver === 'player') {
            this.audio.crash(1);
            this.shake = Math.min(1, this.shake + 0.3);
          }
        }
      }
    }
  }

  emitSmoke(car, dt) {
    car.smokeTimer -= dt;
    if (car.smokeTimer > 0) return;
    car.smokeTimer = car.wrecked ? 0.06 : 0.16;
    const puff = this.takePuff(0x3c3a40, 0.45);
    puff.material.color.setHex(car.wrecked ? 0x2a272c : 0x4a464c);
    puff.material.opacity = 0.6;
    puff.scale.setScalar(1.1);
    puff.position.set(car.pos.x, 1.2, car.pos.z);
    this.smoke.push({ mesh: puff, life: 1.7, grow: 1.1, vy: 1.5 });
  }

  emitSkid(car) {
    const mark = this.takeMark();
    const back = car.forward.multiplyScalar(-car.length * 0.34);
    mark.position.set(car.pos.x + back.x, 0.055, car.pos.z + back.z);
    mark.rotation.y = car.heading;
    mark.material.opacity = 0.5;
    this.marks.push({ mesh: mark, life: 9 });

    const puff = this.takePuff(0xb9b2a4, 0.3);
    puff.material.color.setHex(0xbdb6a8);
    puff.material.opacity = 0.34;
    puff.scale.set(1.1, 0.5, 1.1);
    puff.position.set(car.pos.x, 0.3, car.pos.z);
    this.smoke.push({ mesh: puff, life: 0.85, grow: 1.4, vy: 0.55 });
  }

  takePuff(color, opacity) {
    let puff = this.smokePool.pop();
    if (!puff) {
      puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 6, 5),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
      );
      this.scene.add(puff);
    }
    puff.material.color.setHex(color);
    puff.material.opacity = opacity;
    puff.visible = true;
    return puff;
  }

  takeMark() {
    let mark = this.markPool.pop();
    if (!mark) {
      mark = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, 1.7),
        new THREE.MeshBasicMaterial({ color: 0x1b1a1f, transparent: true, opacity: 0.45, depthWrite: false }),
      );
      mark.rotation.x = -Math.PI / 2;
      this.scene.add(mark);
    }
    mark.visible = true;
    return mark;
  }

  stepParticles(dt) {
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.life -= dt;
      p.mesh.position.y += p.vy * dt;
      const grow = p.grow ?? 1;
      p.mesh.scale.multiplyScalar(1 + dt * grow);
      p.mesh.material.opacity = Math.max(0, p.life * 0.3);
      if (p.life <= 0) {
        p.mesh.visible = false;
        this.smoke.splice(i, 1);
        this.smokePool.push(p.mesh);
      }
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.life -= dt;
      m.mesh.material.opacity = Math.max(0, m.life * 0.055);
      if (m.life <= 0) {
        m.mesh.visible = false;
        this.marks.splice(i, 1);
        this.markPool.push(m.mesh);
      }
    }
  }

  reset() {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const car = this.cars[i];
      if (car.tag === 'parked') continue;
      this.scene.remove(car.mesh);
      this.cars.splice(i, 1);
    }
    for (const car of this.cars) {
      car.hp = car.maxHp;
      car.wrecked = false;
      car.driver = null;
      car.vel.set(0, 0, 0);
      car.speed = 0;
      car.syncMesh();
    }
  }
}

function min(a, b) {
  return a < b ? a : b;
}

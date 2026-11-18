// Cars: the low-poly meshes (body, cabin, wheels, headlights with additive cones, taillights
// and the police lightbar), the arcade drivetrain, entering and exiting, damage, and the
// smoke and skid-mark effects. One manager owns every car on the street.
import * as THREE from 'three';
import { CAR_TYPES, CITY } from './config.js';

const ENGINE_DRAG = 0.55;
const LAT_GRIP = 6.4;

function paint(color, rough = 0.42, metal = 0.35) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

function additive(color, opacity, extra = {}) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false,
    ...extra,
  });
}

// A flat quad lying on the road, used for the pool of light under a headlight beam.
function lightPool(w, d) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), additive(0xfff0cc, 0.16));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// A cone lying along +z, squashed into a beam that widens with distance.
function lightCone(radius, length) {
  const mesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius, length, 12, 1, true),
    additive(0xffe8b8, 0.13, { side: THREE.DoubleSide }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = length / 2 + 0.2;
  return mesh;
}

// Builds every box a car is made of. Returns the group plus the handles the sim animates:
// wheels to spin, lamps to light, and the police bar halves to flash.
export function buildCarMesh(type, color) {
  const spec = CAR_TYPES[type];
  const root = new THREE.Group();
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;
  const isTruck = type === 'truck';
  const isPolice = type === 'police';

  // Chassis: a lower sill, the main body, and a slightly narrower shoulder so the profile
  // is not one flat slab.
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.54, L), paint(color, 0.4, 0.42));
  body.position.y = H * 0.44;
  root.add(body);

  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(W * 0.97, H * 0.2, L * 0.86), paint(color, 0.34, 0.5));
  shoulder.position.y = H * 0.72;
  root.add(shoulder);

  const sill = new THREE.Mesh(new THREE.BoxGeometry(W * 1.01, H * 0.14, L * 0.94), paint(0x14161c, 0.7, 0.2));
  sill.position.y = H * 0.2;
  root.add(sill);

  // Cabin with a glass band; the truck gets a short cab and a separate box body.
  const cabinZ = isTruck ? L * 0.2 : -L * 0.05;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(W * 0.84, H * 0.46, L * (isTruck ? 0.3 : 0.44)), paint(0x101820, 0.14, 0.72));
  cabin.position.set(0, H * 0.82, cabinZ);
  root.add(cabin);

  if (isTruck) {
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(W, H * 0.92, L * 0.52), paint(0x9a9ca4, 0.72, 0.12));
    cargo.position.set(0, H * 0.98, -L * 0.19);
    root.add(cargo);
  }

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.43, 0.43, 0.3, 12);
  const wheelMat = paint(0x14151a, 0.92, 0.04);
  const hubMat = paint(0x8d919b, 0.5, 0.5);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(sx * (W / 2 - 0.05), 0.43, sz * (L / 2 - 0.9));
      root.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.32, 8), hubMat);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      wheels.push(wheel);
    }
  }

  // Headlights: a bright white lens, an additive glow around it and a beam out front.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
  const headGlowMat = additive(0xfff2cf, 0.5);
  const heads = [];
  const glows = [];
  for (const sx of [-1, 1]) {
    const lens = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.17, 0.1), headMat);
    lens.position.set(sx * (W / 2 - 0.34), H * 0.54, L / 2 - 0.01);
    root.add(lens);
    heads.push(lens);

    const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), headGlowMat);
    glow.position.set(sx * (W / 2 - 0.34), H * 0.54, L / 2 + 0.03);
    root.add(glow);
    glows.push(glow);

    const beam = lightCone(1.5, isTruck ? 13 : 11);
    beam.position.x = sx * (W / 2 - 0.4);
    beam.position.y = H * 0.5;
    root.add(beam);
  }

  const pool = lightPool(W * 1.6, isTruck ? 15 : 12);
  pool.position.set(0, 0.07, L / 2 + (isTruck ? 7 : 5.5));
  root.add(pool);

  // Tail lamps: dim red at rest, brighter red when the pedal is down.
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x8e1d17 });
  const tails = [];
  for (const sx of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 0.09), tailMat.clone());
    lamp.position.set(sx * (W / 2 - 0.32), H * 0.52, -L / 2 + 0.01);
    root.add(lamp);
    tails.push(lamp);
    const aura = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), additive(0xff3a26, 0.28));
    aura.position.set(sx * (W / 2 - 0.32), H * 0.52, -L / 2 - 0.03);
    aura.rotation.y = Math.PI;
    root.add(aura);
    lamp.userData.aura = aura;
  }

  let barL = null;
  let barR = null;
  let barHaloL = null;
  let barHaloR = null;
  if (isPolice) {
    // Livery: a white door band and a dark roof, then the light bar on top.
    const band = new THREE.Mesh(new THREE.BoxGeometry(W * 1.012, H * 0.2, L * 0.26), paint(0xeceff4, 0.5, 0.16));
    band.position.set(0, H * 0.52, 0.1);
    root.add(band);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 1.014, H * 0.06, L * 0.26), paint(0x1b2a44, 0.5, 0.16));
    stripe.position.set(0, H * 0.42, 0.1);
    root.add(stripe);

    // The bar itself: a dark housing, then a red half on the left, a blue half on the right,
    // and an additive halo over each so the glow is visible from every angle.
    const housing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.78, 0.14, 0.34), paint(0x121822, 0.6, 0.25));
    housing.position.set(0, H * 1.12, -0.15);
    root.add(housing);

    barL = new THREE.Mesh(new THREE.BoxGeometry(W * 0.34, 0.19, 0.36), new THREE.MeshBasicMaterial({ color: 0xff2b2b }));
    barL.position.set(-W * 0.2, H * 1.2, -0.15);
    root.add(barL);

    barR = new THREE.Mesh(new THREE.BoxGeometry(W * 0.34, 0.19, 0.36), new THREE.MeshBasicMaterial({ color: 0x2b46ff }));
    barR.position.set(W * 0.2, H * 1.2, -0.15);
    root.add(barR);

    barHaloL = new THREE.Mesh(new THREE.SphereGeometry(0.78, 10, 8), additive(0xff2733, 0.45));
    barHaloL.position.copy(barL.position);
    barHaloL.scale.set(1.4, 0.7, 1.1);
    root.add(barHaloL);

    barHaloR = new THREE.Mesh(new THREE.SphereGeometry(0.78, 10, 8), additive(0x2f52ff, 0.45));
    barHaloR.position.copy(barR.position);
    barHaloR.scale.set(1.4, 0.7, 1.1);
    root.add(barHaloR);

    // A pool of coloured light thrown on the road right behind the cruiser.
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
    headGlows: glows,
    beam: root.children.filter((c) => c.geometry?.type === 'ConeGeometry'),
    pool,
    barL,
    barR,
    barHaloL,
    barHaloR,
    spec,
  };
  return root;
}

export class Vehicle {
  constructor(scene, type, color, x, z, heading, tag = 'parked') {
    this.type = type;
    this.spec = CAR_TYPES[type];
    this.tag = tag;
    this.mesh = buildCarMesh(type, color);
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
    this.brake = false;
    this.throttle = 0;
    this.bumpCooldown = 0;
    this.smokeTimer = 0;
    // Alternating bar phase in seconds; -1 means "flash from the start".
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

  // Freeze the bar into one phase for a screenshot: 'red', 'blue' or 'off'.
  setLampMode(mode) {
    this.lampMode = mode;
    const u = this.mesh.userData;
    if (mode === 'auto' || !u.barL) return;
    const redOn = mode === 'red';
    const blueOn = mode === 'blue';
    u.barL.material.color.setHex(redOn ? 0xff2b2b : 0x3a0d0d);
    u.barR.material.color.setHex(blueOn ? 0x2b46ff : 0x0d1438);
    if (u.barHaloL) {
      u.barHaloL.material.opacity = redOn ? 0.72 : 0.06;
      u.barHaloR.material.opacity = blueOn ? 0.72 : 0.06;
      u.barHaloL.userData.spill.material.color.setHex(redOn ? 0xff2733 : blueOn ? 0x2f52ff : 0x333333);
      u.barHaloL.userData.spill.material.opacity = redOn || blueOn ? 0.2 : 0.02;
    }
  }

  syncMesh() {
    this.mesh.position.set(this.pos.x, 0, this.pos.z);
    this.mesh.rotation.y = this.heading;
    const u = this.mesh.userData;

    // Wheels: spin with speed, front pair steers.
    const roll = this.speed * 1.9 * 0.016;
    u.wheels.forEach((wheel, i) => {
      wheel.rotation.x += roll;
      if (i >= 2) wheel.rotation.y = this.steer * 0.42;
    });

    // Headlights and their beams brighten at "night" and when the car is driving.
    const lit = this.lampMode === 'off' ? 0 : 1;
    const boost = this.lampBoost * (lit ? 1 : 0);
    if (u.pool) u.pool.material.opacity = 0.1 * boost;
    for (const beam of u.beam) beam.material.opacity = 0.09 * boost;
    for (const glow of u.headGlows) glow.material.opacity = 0.4 * boost;

    // Taillights: dark red parked, bright when braking or reversing.
    const braking = this.brake || this.speed < -0.5 || (this.driver && this.throttle < 0);
    for (const lamp of u.tails) {
      lamp.material.color.setHex(braking ? 0xff4630 : 0x8e1d17);
      if (lamp.userData.aura) lamp.userData.aura.material.opacity = braking ? 0.55 : 0.22;
    }

    // Police bar: alternate red and blue twice a second.
    if (u.barL && u.barR && this.lampMode === 'auto') {
      this.sirenClock = (this.sirenClock ?? 0) + 0.016;
      const phase = Math.floor(this.sirenClock * 3.4) % 2 === 0;
      u.barL.material.color.setHex(phase ? 0xff2b2b : 0x3a0d0d);
      u.barR.material.color.setHex(phase ? 0x0d1438 : 0x2b46ff);
      if (u.barHaloL) {
        u.barHaloL.material.opacity = phase ? 0.66 : 0.08;
        u.barHaloR.material.opacity = phase ? 0.08 : 0.66;
        const spill = u.barHaloL.userData.spill;
        spill.material.color.setHex(phase ? 0xff2733 : 0x2f52ff);
        spill.material.opacity = 0.19;
      }
    } else if (u.barL && this.lampMode !== 'auto') {
      if (u.barHaloL) {
        u.barHaloL.material.opacity = this.lampMode === 'red' ? 0.66 : 0.08;
        u.barHaloR.material.opacity = this.lampMode === 'blue' ? 0.66 : 0.08;
      }
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
    this.marks = [];
    this.markPool = [];
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

  // The player's drivetrain: longitudinal acceleration, lateral grip that the handbrake
  // loosens for a drift, and speed-sensitive steering.
  drivePlayer(dt, car, player) {
    const input = player.input;
    const spec = car.spec;
    const axis = input.axis();
    const throttleDown = input.down('forward');
    const brakeDown = input.down('back');
    const handbrake = input.down('sprint') || input.down('jump');

    const fwd = car.forward;
    const rgt = car.right;
    let long = car.vel.dot(fwd);
    let lat = car.vel.dot(rgt);

    if (throttleDown) long += spec.accel * dt * (long < 0 ? 2.0 : 1);
    else if (brakeDown) long -= spec.accel * dt * (long > 0 ? 2.2 : 0.7);
    else long *= 1 - 1.4 * dt;

    long = Math.max(-spec.maxSpeed * 0.4, Math.min(spec.maxSpeed, long));
    long *= 1 - ENGINE_DRAG * dt * 0.1;
    if (handbrake) long *= 1 - 1.3 * dt;

    const grip = handbrake ? 0.55 : LAT_GRIP * spec.grip;
    lat *= Math.max(0, 1 - grip * dt);

    const limit = Math.min(1, Math.abs(long) / spec.maxSpeed);
    const rate = spec.turn * (0.42 + 0.58 * (1 - limit)) * (long < 0 ? -1 : 1);
    car.heading += -Math.sign(axis.x || 0) * rate * dt * 0.62 * Math.min(1, Math.abs(long) / 3.2);
    if (handbrake && Math.abs(long) > 6) {
      car.heading += (axis.x || 0) * 0.95 * dt * Math.sign(long);
      lat += (axis.x || 0) * Math.abs(long) * 1.45 * dt;
    }

    car.vel.copy(car.forward).multiplyScalar(long).addScaledVector(car.right, lat);
    car.speed = long;
    car.brake = brakeDown && long > 1;
    car.throttle = throttleDown ? 1 : brakeDown ? -1 : 0;
    car.pos.addScaledVector(car.vel, dt);
    car.steer += ((axis.x || 0) - car.steer) * Math.min(1, 9 * dt);

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
      let diff = car.aiHeading - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      car.heading += Math.max(-1, Math.min(1, diff * 2)) * Math.min(1.6, Math.abs(long) * 0.12) * dt;
    }
    car.pos.addScaledVector(car.vel, dt);
  }

  coast(dt, car) {
    car.vel.multiplyScalar(Math.max(0, 1 - 2.2 * dt));
    car.pos.addScaledVector(car.vel, dt);
    car.speed = car.vel.length() * Math.sign(car.vel.dot(car.forward));
  }

  // Four corner probes against the city boxes: cheap, and enough to stop a car in a wall.
  hitWorld(car, dt, onCrash) {
    car.bumpCooldown = Math.max(0, car.bumpCooldown - dt);
    const spec = car.spec;
    const probes = [
      [0, spec.length * 0.42],
      [0, -spec.length * 0.42],
      [spec.width * 0.4, 0],
      [-spec.width * 0.4, 0],
    ];
    let impact = 0;
    for (const [lx, lz] of probes) {
      const x = car.pos.x + Math.cos(car.heading) * lx + Math.sin(car.heading) * lz;
      const z = car.pos.z - Math.sin(car.heading) * lx + Math.cos(car.heading) * lz;
      if (this.world.blocked(x, z, 0.25)) {
        impact = Math.max(impact, car.vel.length());
        const nx = car.pos.x - x;
        const nz = car.pos.z - z;
        const len = Math.hypot(nx, nz) || 1;
        car.pos.x += (nx / len) * 0.42;
        car.pos.z += (nz / len) * 0.42;
        car.vel.multiplyScalar(-0.18);
        car.speed *= -0.2;
        break;
      }
    }
    for (const prop of this.world.props) {
      if (prop.r <= 0.01) continue;
      const d = Math.hypot(prop.x - car.pos.x, prop.z - car.pos.z);
      if (d < prop.r + spec.width * 0.5 && car.vel.length() > 3) {
        impact = Math.max(impact, car.vel.length());
        if (prop.mesh) prop.mesh.visible = false;
        prop.r = 0.001;
        car.vel.multiplyScalar(0.82);
      }
    }
    if (impact > 6 && car.bumpCooldown <= 0) {
      car.bumpCooldown = 0.45;
      car.damage(impact * 1.2);
      this.shake = Math.min(1, this.shake + impact / 60);
      if (car.driver === 'player') this.audio.crash(Math.min(1.6, impact / 14));
      if (onCrash) onCrash(car, impact);
    }
    car.pos.x = Math.max(-CITY.bound, Math.min(CITY.bound - 2, car.pos.x));
    car.pos.z = Math.max(-CITY.bound, Math.min(CITY.bound, car.pos.z));
    if (car.pos.x > CITY.waterAt - 3) {
      car.pos.x = CITY.waterAt - 3;
      car.vel.multiplyScalar(-0.3);
    }
  }

  pushApart(onCrash) {
    for (let i = 0; i < this.cars.length; i++) {
      const a = this.cars[i];
      for (let j = i + 1; j < this.cars.length; j++) {
        const b = this.cars[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const minD = (a.spec.width + b.spec.width) * 0.5 + 0.25;
        const d = Math.hypot(dx, dz);
        if (d >= minD || d <= 0.001) continue;
        const push = (minD - d) * 0.5;
        a.pos.x -= (dx / d) * push;
        a.pos.z -= (dz / d) * push;
        b.pos.x += (dx / d) * push;
        b.pos.z += (dz / d) * push;
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
    puff.userData.life = 1.7;
    puff.userData.grow = 1.1;
    puff.userData.vy = 1.5;
    this.smoke.push(puff);
  }

  emitSkid(car) {
    // A tyre mark on the asphalt and a puff of smoke over it, both short-lived.
    const mark = this.takeMark();
    const back = car.forward.clone().multiplyScalar(-car.spec.length * 0.34);
    mark.position.set(car.pos.x + back.x, 0.055, car.pos.z + back.z);
    mark.rotation.y = car.heading;
    mark.material.opacity = 0.5;
    mark.userData.life = 9;
    this.marks.push(mark);

    const puff = this.takePuff(0xb9b2a4, 0.3);
    puff.material.color.setHex(0xbdb6a8);
    puff.material.opacity = 0.34;
    puff.scale.set(1.1, 0.5, 1.1);
    puff.position.set(car.pos.x, 0.3, car.pos.z);
    puff.userData.life = 0.85;
    puff.userData.grow = 1.4;
    puff.userData.vy = 0.55;
    this.smoke.push(puff);
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
      const puff = this.smoke[i];
      puff.userData.life -= dt;
      puff.position.y += puff.userData.vy * dt;
      puff.scale.multiplyScalar(1 + dt * (puff.userData.grow ?? 1));
      puff.material.opacity = Math.max(0, puff.userData.life * 0.3);
      if (puff.userData.life <= 0) {
        puff.visible = false;
        this.smoke.splice(i, 1);
        this.smokePool.push(puff);
      }
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const mark = this.marks[i];
      mark.userData.life -= dt;
      mark.material.opacity = Math.max(0, mark.userData.life * 0.055);
      if (mark.userData.life <= 0) {
        mark.visible = false;
        this.marks.splice(i, 1);
        this.markPool.push(mark);
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

// Port Meridian — cars.
// Every car is built from boxes: a three-layer body, a glass cabin, four wheels with hubs, and
// lights. Handling is arcade rather than simulation: acceleration along the car's forward axis,
// a lateral component that grip bleeds off, a handbrake that cuts grip and lets the tail step
// out. The manager owns spawning, collisions, particles and both driving steps.

import * as THREE from 'three';
import { CAR_CLASSES } from './config.js';
import { clamp, damp } from './random.js';

const WHEEL_Y = 0.42;

function glowTexture() {
  if (glowTexture._cache) return glowTexture._cache;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.72, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowTexture._cache = tex;
  return tex;
}

function beamTexture() {
  if (beamTexture._cache) return beamTexture._cache;
  const W = 64;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, 'rgba(255,240,205,0.55)');
  grad.addColorStop(0.35, 'rgba(255,240,205,0.2)');
  grad.addColorStop(1, 'rgba(255,240,205,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(W * 0.36, H);
  g.lineTo(W * 0.64, H);
  g.lineTo(W, 0);
  g.lineTo(0, 0);
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  beamTexture._cache = tex;
  return tex;
}

// Shared geometry: one box, scaled per part. Keeps the draw calls but avoids 40 allocations.
const BOX = new THREE.BoxGeometry(1, 1, 1);

// ---------------------------------------------------------------------------
// One car
// ---------------------------------------------------------------------------

export class Car {
  constructor(kind, options = {}) {
    this.kind = kind;
    this.spec = CAR_CLASSES[kind];
    this.angle = options.angle ?? 0;
    this.x = options.x ?? 0;
    this.z = options.z ?? 0;
    this.vx = 0;
    this.vz = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.steer = 0;
    this.health = this.spec.health;
    this.maxHealth = this.spec.health;
    this.wrecked = false;
    this.owned = options.owned ?? 'traffic';   // 'player' | 'police' | 'traffic' | 'parked'
    this.rails = options.rails ?? false;        // traffic rails vs player physics
    this.driver = options.driver ?? null;
    this.braking = false;
    this.headlights = options.headlights ?? true;
    this.lightMode = 'auto';                    // auto | red | blue | off
    this.lightPhase = 0;
    this.smoke = 0;
    this.lastCrash = 0;
    this.wheelSpin = 0;
    this.bodyRoll = 0;
    this.pitch = 0;
    this.skidTimer = 0;
    this.hitCooldown = 0;
    this.colorOverride = options.color ?? null;
    this.mesh = this._build();
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.angle;
  }

  get radius() {
    return Math.max(this.spec.width, this.spec.length) * 0.5;
  }

  _build() {
    const spec = this.spec;
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.bodyGroup = body;

    const baseColor = this.colorOverride ?? spec.color;
    const paint = new THREE.MeshStandardMaterial({
      color: baseColor, roughness: 0.36, metalness: 0.42,
    });
    const darkPaint = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.7, metalness: 0.2 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x0d1620, roughness: 0.08, metalness: 0.85,
      transparent: true, opacity: 0.88,
    });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xb9c0cc, roughness: 0.28, metalness: 0.85 });

    const L = spec.length;
    const W = spec.width;
    const H = spec.height;

    const add = (geo, mat, sx, sy, sz, x, y, z, parent = body) => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };

    // Three-layer body: sill (dark), shoulder (paint), hood/roof deck.
    const sillH = H * 0.28;
    add(BOX, darkPaint, W * 0.94, sillH, L * 0.92, 0, WHEEL_Y + sillH * 0.2, 0);
    const shoulderH = H * 0.42;
    add(BOX, paint, W, shoulderH, L, 0, WHEEL_Y + sillH * 0.72 + shoulderH * 0.42, 0);
    const deckH = H * 0.16;
    add(BOX, paint, W * 0.96, deckH, L * 0.86, 0, WHEEL_Y + sillH * 0.8 + shoulderH * 0.88 + deckH * 0.4, -L * 0.02);

    // Cabin: glass on a coloured band.
    const cabinH = H * 0.44;
    const cabinY = WHEEL_Y + sillH * 0.8 + shoulderH * 0.9 + cabinH * 0.45;
    const cabin = add(BOX, glass, W * 0.78, cabinH, L * 0.44, 0, cabinY, L * 0.02);
    this.cabin = cabin;
    add(BOX, paint, W * 0.8, cabinH * 0.24, L * 0.45, 0, cabinY + cabinH * 0.5, L * 0.02);

    // Truck gets a tall cargo box behind the cab.
    if (spec.cargo) {
      const cargoMat = new THREE.MeshStandardMaterial({ color: 0xcdd2da, roughness: 0.82, metalness: 0.1 });
      add(BOX, cargoMat, W * 0.96, H * 0.95, L * 0.56, 0, WHEEL_Y + H * 0.5, -L * 0.2);
      add(BOX, darkPaint, W * 0.5, 0.1, L * 0.5, 0, WHEEL_Y + H * 0.5 + 0.06, -L * 0.2);
    }

    // Taxi roof sign.
    if (spec.roofSign) {
      const signMat = new THREE.MeshStandardMaterial({
        color: 0xffe6a0, emissive: 0xffc247, emissiveIntensity: 1.4, roughness: 0.5,
      });
      add(BOX, signMat, W * 0.3, 0.24, 0.5, 0, cabinY + cabinH * 0.63, L * 0.02);
      this.roofSign = true;
    }

    // Police livery: white band along the doors.
    if (spec.lightBar) {
      const white = new THREE.MeshStandardMaterial({ color: 0xeef2f8, roughness: 0.4, metalness: 0.2 });
      add(BOX, white, W * 1.01, H * 0.17, L * 0.5, 0, WHEEL_Y + sillH * 0.72 + shoulderH * 0.5, 0);
      const bar = add(BOX, darkPaint, W * 0.72, 0.16, 0.42, 0, cabinY + cabinH * 0.62, L * 0.02);
      this.lightBar = bar;
      // Two lenses and their halos.
      const redMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false });
      const blueMat = new THREE.MeshBasicMaterial({ color: 0x2a5aff, toneMapped: false });
      this.redLens = add(BOX, redMat, W * 0.3, 0.14, 0.3, -W * 0.19, cabinY + cabinH * 0.62 + 0.06, L * 0.02);
      this.blueLens = add(BOX, blueMat, W * 0.3, 0.14, 0.3, W * 0.19, cabinY + cabinH * 0.62 + 0.06, L * 0.02);
      this.redLensMat = redMat;
      this.blueLensMat = blueMat;

      this.redHalo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xff3030, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.85,
      }));
      this.redHalo.position.set(-W * 0.19, cabinY + cabinH * 0.62 + 0.1, L * 0.02);
      this.redHalo.scale.set(3.4, 3.4, 1);
      body.add(this.redHalo);

      this.blueHalo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0x3a6cff, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.85,
      }));
      this.blueHalo.position.set(W * 0.19, cabinY + cabinH * 0.62 + 0.1, L * 0.02);
      this.blueHalo.scale.set(3.4, 3.4, 1);
      body.add(this.blueHalo);

      // A spill pool of light under the cruiser.
      this.sirenPool = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          map: glowTexture(), color: 0xff3040, transparent: true, opacity: 0.4,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }),
      );
      this.sirenPool.rotation.x = -Math.PI / 2;
      this.sirenPool.position.y = 0.06;
      this.sirenPool.scale.set(W * 3.6, L * 2.2, 1);
      root.add(this.sirenPool);
    }

    // Headlight lenses.
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6, toneMapped: false });
    const halfW = W * 0.33;
    const frontZ = -L / 2 - 0.02;
    add(BOX, lensMat, 0.4, 0.16, 0.1, -halfW, WHEEL_Y + sillH * 0.8 + shoulderH * 0.5, frontZ, body);
    add(BOX, lensMat, 0.4, 0.16, 0.1, halfW, WHEEL_Y + sillH * 0.8 + shoulderH * 0.5, frontZ, body);
    this.lensMat = lensMat;

    // Soft glow cards in front of each lens.
    this.headGlows = [];
    for (const sx of [-halfW, halfW]) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xffeccb, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.8,
      }));
      glow.position.set(sx, WHEEL_Y + sillH * 0.8 + shoulderH * 0.5, frontZ - 0.06);
      glow.scale.set(2.1, 2.1, 1);
      body.add(glow);
      this.headGlows.push(glow);
    }

    // Dim beam cones and the faint pool of light on the road ahead.
    this.beams = [];
    const beamMat = new THREE.MeshBasicMaterial({
      map: beamTexture(), color: 0xfff0cc, transparent: true, opacity: 0.19,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    for (const sx of [-halfW, halfW]) {
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 15), beamMat);
      beam.rotation.x = -Math.PI / 2;
      beam.position.set(sx, 0.1, -L / 2 - 7.5);
      body.add(beam);
      this.beams.push(beam);
    }
    this.roadPool = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: glowTexture(), color: 0xffe8bc, transparent: true, opacity: 0.17,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
    );
    this.roadPool.rotation.x = -Math.PI / 2;
    this.roadPool.position.set(0, 0.07, -L / 2 - 6.5);
    this.roadPool.scale.set(W * 2.4, 15, 1);
    body.add(this.roadPool);

    // Tail lamps.
    const tailMat = new THREE.MeshBasicMaterial({ color: 0x8a1414, toneMapped: false });
    const backZ = L / 2 + 0.02;
    add(BOX, tailMat, 0.38, 0.15, 0.1, -halfW, WHEEL_Y + sillH * 0.8 + shoulderH * 0.5, backZ, body);
    add(BOX, tailMat, 0.38, 0.15, 0.1, halfW, WHEEL_Y + sillH * 0.8 + shoulderH * 0.5, backZ, body);
    this.tailMat = tailMat;
    this.brakeGlows = [];
    for (const sx of [-halfW, halfW]) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: 0xff2a2a, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0.0,
      }));
      glow.position.set(sx, WHEEL_Y + sillH * 0.8 + shoulderH * 0.5, backZ + 0.05);
      glow.scale.set(2.4, 2.4, 1);
      body.add(glow);
      this.brakeGlows.push(glow);
    }

    // Wheels: four with hubs, the front pair steers.
    this.wheels = [];
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.92 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x7b8494, roughness: 0.4, metalness: 0.7 });
    const wheelR = WHEEL_Y;
    const axleZ = L * 0.31;
    const axleX = W * 0.47;
    for (const [wx, wz, front] of [[-axleX, -axleZ, true], [axleX, -axleZ, true], [-axleX, axleZ, false], [axleX, axleZ, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, wheelR, wz);
      const spin = new THREE.Group();
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(wheelR, wheelR, W * 0.19, 12), tyreMat);
      tyre.rotation.z = Math.PI / 2;
      spin.add(tyre);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, W * 0.2, 10), hubMat);
      hub.rotation.z = Math.PI / 2;
      spin.add(hub);
      pivot.add(spin);
      root.add(pivot);
      this.wheels.push({ pivot, spin, front });
    }

    // Small shadow blob under the car.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: glowTexture(), color: 0x000000, transparent: true, opacity: 0.5,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.05;
    shadow.scale.set(W * 1.5, L * 1.05, 1);
    root.add(shadow);

    root.userData.car = this;
    return root;
  }

  setSirenMode(mode) {
    this.lightMode = mode;
  }

  updateLights(dt, braking) {
    this.lightPhase += dt;
    const auto = this.lightMode === 'auto';
    let red = 1;
    let blue = 1;
    if (this.lightMode === 'off') { red = 0; blue = 0; }
    else if (this.lightMode === 'red') { red = 1; blue = 0; }
    else if (this.lightMode === 'blue') { red = 0; blue = 1; }
    else {
      const phase = (this.lightPhase * 3) % 2;
      red = phase < 1 ? 1 : 0;
      blue = phase < 1 ? 0 : 1;
    }
    if (this.redHalo) {
      this.redHalo.material.opacity = red * 0.9;
      this.blueHalo.material.opacity = blue * 0.9;
      this.redLensMat.color.setHex(red > 0 ? 0xff2a2a : 0x3a1010);
      this.blueLensMat.color.setHex(blue > 0 ? 0x2a5aff : 0x101a3a);
      this.sirenPool.material.color.setHex(red > 0 ? 0xff3040 : 0x3050ff);
      this.sirenPool.material.opacity = (red + blue) * 0.32;
    }
    // Tail lamps flare under braking; headlights switch off when the car dies.
    const tail = braking ? 1 : 0.28;
    this.tailMat.color.setHex(braking ? 0xff2a2a : 0x8a1414);
    for (const g of this.brakeGlows) g.material.opacity = braking ? 0.75 : 0.06;
    const lit = this.headlights && !this.wrecked;
    for (const g of this.headGlows) g.material.opacity = lit ? 0.85 : 0;
    for (const b of this.beams) b.visible = lit;
    if (this.roadPool) this.roadPool.visible = lit;
    this.lensMat.color.setHex(lit ? 0xfff4d6 : 0x2a2620);
    if (tail <= 0) return;
  }

  applyDamage(amount) {
    if (this.wrecked) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.wrecked = true;
      this.headlights = false;
      return true;
    }
    return false;
  }

  // --- physics ----------------------------------------------------------

  // Arcade step used for the player and police. `input` is {throttle, brake, steer, handbrake}.
  step(input, dt, city) {
    const spec = this.spec;
    const sin = Math.sin(this.angle);
    const cos = Math.cos(this.angle);
    // Forward is -z in local space, so the world forward is (sin? no) — derive from the group.
    const fx = -sin;
    const fz = -cos;
    const rx = cos;
    const rz = -sin;

    let fwd = this.vx * fx + this.vz * fz;
    let lat = this.vx * rx + this.vz * rz;

    const throttle = clamp(input.throttle ?? 0, -1, 1);
    const braking = input.brake ?? 0;
    const handbrake = input.handbrake ?? 0;

    // Engine force along the forward axis.
    let accel = 0;
    if (throttle > 0) accel += spec.accel * throttle;
    if (throttle < 0) {
      if (fwd > 0.5) accel += spec.accel * 1.6 * throttle;      // brake
      else accel += spec.accel * 0.6 * throttle;                // reverse
    }
    if (braking > 0) accel -= spec.accel * 1.5 * braking * Math.sign(fwd || 1);

    // Drag and rolling resistance.
    const drag = 0.016 * fwd * Math.abs(fwd);
    const rolling = 2.4 * Math.sign(fwd) * (throttle === 0 ? 1 : 0.25);
    fwd += (accel - drag - rolling) * dt;
    if (Math.abs(fwd) < 0.12 && throttle === 0) fwd = 0;

    const top = throttle < 0 && fwd < 0 ? spec.reverseSpeed : spec.topSpeed;
    fwd = clamp(fwd, -spec.reverseSpeed, spec.topSpeed);
    if (Math.abs(fwd) > top) fwd = Math.sign(fwd) * top;

    // Grip bleeds lateral velocity away. The handbrake cuts it so the tail slides.
    const gripFactor = handbrake > 0 ? spec.grip * 0.14 : spec.grip;
    lat *= Math.exp(-gripFactor * dt);
    if (Math.abs(lat) < 0.02) lat = 0;

    // Steering: weakens with speed, reverses in reverse.
    const speed01 = Math.min(1, Math.abs(fwd) / spec.topSpeed);
    const steerAuthority = (1 - speed01 * 0.52) * (fwd < -0.4 ? -1 : 1);
    const targetSteer = clamp(input.steer ?? 0, -1, 1);
    this.steer = damp(this.steer, targetSteer, 9, dt);
    let turn = this.steer * spec.turnRate * steerAuthority;
    if (handbrake > 0) turn *= 1.45;
    // Turning needs motion; a parked car does not spin on the spot.
    const motion = clamp(Math.abs(fwd) / 3.2, 0, 1);
    this.angle += turn * motion * Math.sign(fwd || 1) * dt;

    // Recompose the world velocity from the new heading.
    const nsin = Math.sin(this.angle);
    const ncos = Math.cos(this.angle);
    const nfx = -nsin;
    const nfz = -ncos;
    const nrx = ncos;
    const nrz = -nsin;
    this.vx = fwd * nfx + lat * nrx;
    this.vz = fwd * nfz + lat * nrz;
    this.forwardSpeed = fwd;
    this.lateralSpeed = lat;

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Body roll and pitch, purely cosmetic.
    this.bodyRoll = damp(this.bodyRoll, clamp(-turn * Math.abs(fwd) * 0.012, -0.09, 0.09), 8, dt);
    this.pitch = damp(this.pitch, clamp((accel * 0.004) - (braking * 0.02), -0.05, 0.05), 6, dt);
    if (this.bodyGroup) {
      this.bodyGroup.rotation.z = this.bodyRoll;
      this.bodyGroup.rotation.x = this.pitch;
    }

    this.wheelSpin += fwd * dt * 2.2;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steer * 0.42;
    }
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.angle;

    // Smoke when badly damaged or wrecked.
    const damage = 1 - this.health / this.maxHealth;
    this.smoke = this.wrecked ? 1 : damage > 0.55 ? (damage - 0.55) / 0.45 : 0;

    // A damaged engine stutters: nudge speed down when health is low.
    if (!this.wrecked && damage > 0.7) {
      this.vx *= 0.998;
      this.vz *= 0.998;
    }

    this.updateLights(dt, braking > 0 || (throttle < 0 && fwd > 0.5));
  }

  // Simple coast for parked or driverless cars: no input, just bleed velocity.
  coast(dt) {
    this.vx *= Math.exp(-2.6 * dt);
    this.vz *= Math.exp(-2.6 * dt);
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.angle;
    this.updateLights(dt, false);
  }

  place(x, z, angle) {
    this.x = x;
    this.z = z;
    this.angle = angle;
    this.vx = 0;
    this.vz = 0;
    this.forwardSpeed = 0;
    this.lateralSpeed = 0;
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = angle;
  }
}

// ---------------------------------------------------------------------------
// Particles: pooled smoke puffs and skid marks
// ---------------------------------------------------------------------------

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.smoke = [];
    this.skid = [];
    this.skidIndex = 0;
    this.smokeIndex = 0;

    const smokeMat = new THREE.SpriteMaterial({
      map: glowTexture(), color: 0x9aa0ac, transparent: true, opacity: 0.4,
      depthWrite: false,
    });
    this.smokeGroup = new THREE.Group();
    for (let i = 0; i < 48; i++) {
      const s = new THREE.Sprite(smokeMat.clone());
      s.visible = false;
      s.scale.set(1, 1, 1);
      this.smokeGroup.add(s);
      this.smoke.push({ sprite: s, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0 });
    }
    scene.add(this.smokeGroup);

    this.skidGroup = new THREE.Group();
    const skidGeo = new THREE.PlaneGeometry(0.32, 1.1);
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x0a0b0e, transparent: true, opacity: 0.5, depthWrite: false,
    });
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(skidGeo, skidMat);
      m.visible = false;
      m.position.y = 0.03;
      this.skidGroup.add(m);
      this.skid.push({ mesh: m, life: 0 });
    }
    scene.add(this.skidGroup);
  }

  puff(x, y, z, strength = 1) {
    const p = this.smoke[this.smokeIndex++ % this.smoke.length];
    p.sprite.visible = true;
    p.sprite.position.set(x, y, z);
    p.sprite.material.opacity = 0.34 * strength;
    p.sprite.scale.set(0.9, 0.9, 1);
    p.life = 0;
    p.maxLife = 1.1 + strength * 0.7;
    p.vx = (Math.random() - 0.5) * 1.1;
    p.vy = 0.9 + Math.random() * 0.9;
    p.vz = (Math.random() - 0.5) * 1.1;
  }

  mark(x, z, angle) {
    const s = this.skid[this.skidIndex++ % this.skid.length];
    s.mesh.visible = true;
    s.mesh.position.set(x, 0.035, z);
    s.mesh.rotation.y = angle;
    s.life = 5.5;
    s.mesh.material = s.mesh.material; // shared material, one opacity for all
  }

  update(dt) {
    for (const p of this.smoke) {
      if (!p.sprite.visible) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.sprite.visible = false; continue; }
      const t = p.life / p.maxLife;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.vy += dt * 0.35;
      const s = 0.9 + t * 3.4;
      p.sprite.scale.set(s, s, 1);
      p.sprite.material.opacity = 0.32 * (1 - t);
    }
    for (const s of this.skid) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  clear() {
    for (const p of this.smoke) { p.sprite.visible = false; p.life = 0; }
    for (const s of this.skid) { s.mesh.visible = false; s.life = 0; }
  }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class VehicleManager {
  constructor(scene, city, audio) {
    this.scene = scene;
    this.city = city;
    this.audio = audio;
    this.cars = [];
    this.playerCar = null;
    this.particles = new Particles(scene);
    this.onCrash = null;
    this.crashShake = 0;
  }

  spawn(kind, x, z, angle, owned = 'parked', extra = {}) {
    const car = new Car(kind, { x, z, angle, owned, ...extra });
    this.scene.add(car.mesh);
    this.cars.push(car);
    return car;
  }

  remove(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    this.scene.remove(car.mesh);
    car.mesh.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map && m.map !== glowTexture._cache && m.map !== beamTexture._cache) m.map.dispose();
          m.dispose();
        }
      }
      if (o.geometry && o.geometry !== BOX) o.geometry.dispose();
    });
    if (this.playerCar === car) this.playerCar = null;
  }

  clearAll() {
    while (this.cars.length > 0) this.remove(this.cars[0]);
    this.particles.clear();
    this.playerCar = null;
  }

  nearest(x, z, filter = null, maxDist = Infinity) {
    let best = null;
    let bestD = maxDist;
    for (const c of this.cars) {
      if (filter && !filter(c)) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best ? { car: best, distance: bestD } : null;
  }

  carsInRadius(x, z, radius) {
    const out = [];
    for (const c of this.cars) {
      if (Math.hypot(c.x - x, c.z - z) <= radius) out.push(c);
    }
    return out;
  }

  // --- collisions -------------------------------------------------------

  collideWithCity(car, dt) {
    const spec = car.spec;
    const probes = [
      [0, -spec.length / 2],
      [0, spec.length / 2],
      [-spec.width / 2, 0],
      [spec.width / 2, 0],
    ];
    const sin = Math.sin(car.angle);
    const cos = Math.cos(car.angle);
    let worst = 0;
    for (const [lx, lz] of probes) {
      const wx = car.x + lx * cos - lz * sin;
      const wz = car.z + lx * sin + lz * cos;
      if (!this.city.isBlocked(wx, wz, 0.2)) continue;
      // Push straight out of the nearest blocked sample toward the car centre.
      const dx = car.x - wx;
      const dz = car.z - wz;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dx / len;
      const nz = dz / len;
      let push = 0.55;
      for (let k = 0; k < 12; k++) {
        const tx = wx + nx * push;
        const tz = wz + nz * push;
        if (!this.city.isBlocked(tx, tz, 0.2)) break;
        push += 0.45;
      }
      car.x += nx * push;
      car.z += nz * push;
      const impact = Math.hypot(car.vx, car.vz);
      worst = Math.max(worst, impact);
      // Bounce: reflect the velocity off the wall and lose most of it.
      const dot = car.vx * nx + car.vz * nz;
      if (dot < 0) {
        car.vx -= 1.55 * dot * nx;
        car.vz -= 1.55 * dot * nz;
      }
      car.vx *= 0.42;
      car.vz *= 0.42;
      this.city.knockProp(wx, wz, 1.4, impact);
    }
    // The sea and the city bound.
    if (car.x > this.city.seaEdge - 4) { car.x = this.city.seaEdge - 4; car.vx = -Math.abs(car.vx) * 0.3; }
    if (car.x < -this.city.bound) { car.x = -this.city.bound; car.vx = Math.abs(car.vx) * 0.3; }
    if (car.z > this.city.bound) { car.z = this.city.bound; car.vz = -Math.abs(car.vz) * 0.3; }
    if (car.z < -this.city.bound) { car.z = -this.city.bound; car.vz = Math.abs(car.vz) * 0.3; }

    car.mesh.position.set(car.x, 0, car.z);
    if (worst > 6 && car.hitCooldown <= 0) {
      this._registerCrash(car, worst);
    }
    car.hitCooldown = Math.max(0, car.hitCooldown - dt);
  }

  _registerCrash(car, impact) {
    car.hitCooldown = 0.55;
    const damage = clamp((impact - 5) * 2.4, 0, 42);
    const destroyed = car.applyDamage(damage);
    this.crashShake = Math.min(1, impact / 22);
    this.audio.crash(Math.min(1, impact / 16));
    // Scatter smoke at the impact point.
    for (let i = 0; i < 3; i++) {
      this.particles.puff(car.x + (Math.random() - 0.5) * 2, 1 + Math.random(), car.z + (Math.random() - 0.5) * 2, 0.8);
    }
    if (this.onCrash) this.onCrash(car, impact, destroyed);
  }

  carCarCollisions() {
    const n = this.cars.length;
    for (let i = 0; i < n; i++) {
      const a = this.cars[i];
      for (let j = i + 1; j < n; j++) {
        const b = this.cars[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const ra = a.radius;
        const rb = b.radius;
        const min = ra + rb;
        const d = Math.hypot(dx, dz);
        if (d >= min || d === 0) continue;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = min - d;
        a.x -= nx * overlap * 0.5;
        a.z -= nz * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.z += nz * overlap * 0.5;
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel < 0) {
          const jimp = -rel * 0.72;
          a.vx -= jimp * nx * 0.55;
          a.vz -= jimp * nz * 0.55;
          b.vx += jimp * nx * 0.55;
          b.vz += jimp * nz * 0.55;
          if (Math.abs(rel) > 7) {
            const dmg = Math.min(34, Math.abs(rel) * 1.7);
            a.applyDamage(dmg * 0.6);
            b.applyDamage(dmg * 0.6);
            this.audio.crash(Math.min(1, Math.abs(rel) / 20));
            this.crashShake = Math.max(this.crashShake, Math.min(1, Math.abs(rel) / 24));
          }
        }
        a.mesh.position.set(a.x, 0, a.z);
        b.mesh.position.set(b.x, 0, b.z);
      }
    }
  }

  // --- driving ----------------------------------------------------------

  drivePlayer(car, input, dt) {
    if (!car) return;
    car.step(input, dt, this.city);
    this.collideWithCity(car, dt);
    // Skid marks and dust when sliding hard.
    const slide = Math.abs(car.lateralSpeed);
    const speed = Math.abs(car.forwardSpeed);
    if (slide > 4.2 || (input.handbrake > 0 && speed > 5)) {
      car.skidTimer -= dt;
      if (car.skidTimer <= 0) {
        const sin = Math.sin(car.angle);
        const cos = Math.cos(car.angle);
        for (const side of [-1, 1]) {
          const x = car.x + side * car.spec.width * 0.42 * cos;
          const z = car.z - side * car.spec.width * 0.42 * sin;
          this.particles.mark(x, z, car.angle);
        }
        car.skidTimer = 0.045;
      }
      if (Math.random() < 0.25) {
        this.particles.puff(car.x - Math.sin(car.angle) * car.spec.length * 0.4, 0.4, car.z - Math.cos(car.angle) * car.spec.length * 0.4, 0.5);
      }
    }
    if (car.smoke > 0 && !car.wrecked) {
      if (Math.random() < car.smoke * 0.5) {
        this.particles.puff(car.x + Math.sin(car.angle) * car.spec.length * 0.3, 1.2, car.z + Math.cos(car.angle) * car.spec.length * 0.3, 0.7);
      }
    } else if (car.wrecked) {
      if (Math.random() < 0.55) {
        this.particles.puff(car.x + (Math.random() - 0.5) * 1.5, 1.4, car.z + (Math.random() - 0.5) * 1.5, 1);
      }
    }
  }

  driveAi(car, input, dt) {
    car.step(input, dt, this.city);
    this.collideWithCity(car, dt);
  }
}

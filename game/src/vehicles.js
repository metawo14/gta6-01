// Cars: five classes, each built from boxes, with arcade handling, skid marks,
// dust, smoke, damage and a pool of shared particles.

import * as THREE from 'three';
import { CAR_SPECS, COLORS, CITY } from './config.js';
import { clamp, damp, wrapAngle } from './random.js';

let glowTexCache = null;
function glowTex() {
  if (glowTexCache) return glowTexCache;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.32, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexCache = new THREE.CanvasTexture(c);
  glowTexCache.colorSpace = THREE.SRGBColorSpace;
  return glowTexCache;
}

let smokeTexCache = null;
function smokeTex() {
  if (smokeTexCache) return smokeTexCache;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 96;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(48, 48, 0, 48, 48, 48);
  grad.addColorStop(0, 'rgba(210,214,224,0.55)');
  grad.addColorStop(0.55, 'rgba(170,178,190,0.22)');
  grad.addColorStop(1, 'rgba(150,158,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 96, 96);
  smokeTexCache = new THREE.CanvasTexture(c);
  smokeTexCache.colorSpace = THREE.SRGBColorSpace;
  return smokeTexCache;
}

const shared = {
  dark: new THREE.MeshStandardMaterial({ color: 0x181a20, roughness: 0.75, metalness: 0.25 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x1b2a3c,
    roughness: 0.14,
    metalness: 0.6,
    transparent: true,
    opacity: 0.86,
  }),
  tyre: new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.95 }),
  hub: new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.35, metalness: 0.8 }),
  head: new THREE.MeshBasicMaterial({ color: 0xfff4d8 }),
  tail: new THREE.MeshBasicMaterial({ color: 0x8a1b1b }),
  tailBright: new THREE.MeshBasicMaterial({ color: 0xff3a2a }),
  red: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  blue: new THREE.MeshBasicMaterial({ color: 0x2a6bff }),
  redDim: new THREE.MeshBasicMaterial({ color: 0x5a1414 }),
  blueDim: new THREE.MeshBasicMaterial({ color: 0x14204a }),
  spill: null,
};

function makeCarMaterials(color) {
  return {
    paint: new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.45 }),
    paintDark: new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.6),
      roughness: 0.45,
      metalness: 0.4,
    }),
    shoulder: new THREE.MeshStandardMaterial({
      color: new THREE.Color(color).multiplyScalar(0.82).lerp(new THREE.Color(0xffffff), 0.08),
      roughness: 0.36,
      metalness: 0.5,
    }),
  };
}

export class Car {
  constructor(mgr, type, colorHex) {
    this.mgr = mgr;
    this.type = type;
    this.spec = CAR_SPECS[type];
    this.color = colorHex;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    this.health = this.spec.health;
    this.maxHealth = this.spec.health;
    this.wrecked = false;
    this.driver = null; // 'player' | 'ai' | 'police' | null
    this.x = 0;
    this.z = 0;
    this.y = 0;
    this.heading = 0;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.steerVis = 0;
    this.throttle = 0;
    this.braking = false;
    this.handbrake = false;
    this.wheelSpin = 0;
    this.impactCd = 0;
    this.smokeTimer = 0;
    this.skidTimer = 0;
    this.lightMode = 'auto';
    this.barPhase = 0;
    this.honkCd = 0;
    this.ai = {
      targetSpeed: 14,
      steer: 0,
      cruiseJunction: 0,
      reversing: 0,
    };
    this.build();
    this.group.position.set(0, 0, 0);
  }

  get halfLength() {
    return this.spec.length / 2;
  }
  get halfWidth() {
    return this.spec.width / 2;
  }

  build() {
    const s = this.spec;
    const mats = makeCarMaterials(this.color);
    this.mats = mats;
    const g = this.group;

    const w = s.width;
    const l = s.length;
    const isTruck = this.type === 'truck';
    const bodyH = isTruck ? 0.9 : 0.52;
    const sillH = 0.3;

    // three-layer body: dark sill, main body, shoulder
    const sill = new THREE.Mesh(new THREE.BoxGeometry(w * 0.97, sillH, l * 0.97), shared.dark);
    sill.position.y = 0.3 + sillH / 2;
    g.add(sill);
    this.sill = sill;

    const body = new THREE.Mesh(new THREE.BoxGeometry(w, bodyH, l), mats.paint);
    body.position.y = 0.3 + sillH + bodyH / 2;
    g.add(body);
    this.body = body;

    const shoulderH = isTruck ? 0.28 : 0.22;
    const shoulder = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.98, shoulderH, l * 0.9),
      mats.shoulder,
    );
    shoulder.position.y = 0.3 + sillH + bodyH + shoulderH / 2;
    g.add(shoulder);
    this.shoulder = shoulder;

    const roofY = 0.3 + sillH + bodyH + shoulderH;
    const cabinH = isTruck ? 1.0 : s.height - roofY + 0.06;
    const cabinLen = isTruck ? l * 0.34 : l * 0.46;
    const cabinZ = isTruck ? l * 0.24 : -l * 0.04;

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.86, Math.max(0.4, cabinH), cabinLen),
      shared.glass,
    );
    cabin.position.set(0, roofY + Math.max(0.4, cabinH) / 2, cabinZ);
    g.add(cabin);
    this.cabin = cabin;

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w * 0.82, 0.1, cabinLen * 0.86),
      mats.paintDark,
    );
    roof.position.set(0, roofY + Math.max(0.4, cabinH) + 0.02, cabinZ);
    g.add(roof);

    if (isTruck) {
      // cargo box on the back
      const boxLen = l * 0.55;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.98, 1.9, boxLen),
        new THREE.MeshStandardMaterial({ color: 0xcfd4dd, roughness: 0.8, metalness: 0.15 }),
      );
      box.position.set(0, 1.55, -l * 0.2);
      g.add(box);
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.001, 0.3, boxLen * 1.001),
        new THREE.MeshStandardMaterial({ color: 0x2f5d8a, roughness: 0.7 }),
      );
      stripe.position.set(0, 1.25, -l * 0.2);
      g.add(stripe);
      this.cargo = box;
    }

    if (this.type === 'taxi') {
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.26, 0.5),
        new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
      );
      sign.position.set(0, roofY + Math.max(0.4, cabinH) + 0.22, cabinZ);
      g.add(sign);
      this.roofSign = sign;
      const signGlow = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTex(),
          color: 0xffe9a8,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: 0.4,
        }),
      );
      signGlow.position.copy(sign.position);
      signGlow.scale.setScalar(2.2);
      g.add(signGlow);
    }

    // checkered side stripe for the police cruiser
    if (this.type === 'police') {
      for (const side of [-1, 1]) {
        const band = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.3, l * 0.72),
          new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
        );
        band.position.set(side * (w / 2 + 0.02), roofY - 0.14, 0);
        g.add(band);
        const badge = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.2, 0.7),
          new THREE.MeshStandardMaterial({ color: 0xd8a13a, roughness: 0.5, metalness: 0.6 }),
        );
        badge.position.set(side * (w / 2 + 0.03), roofY - 0.14, l * 0.22);
        g.add(badge);
      }
      this.buildLightBar(roofY + Math.max(0.4, cabinH) + 0.06);
    }

    // wheels
    this.wheels = [];
    const wheelR = isTruck ? 0.55 : 0.42;
    const track = w / 2 - 0.12;
    const axle = l / 2 - (isTruck ? 1.3 : 1.05);
    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.28, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.3, 8);
    hubGeo.rotateZ(Math.PI / 2);
    const positions = [
      [-track, axle, true],
      [track, axle, true],
      [-track, -axle, false],
      [track, -axle, false],
    ];
    for (const [wx, wz, front] of positions) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, wheelR, wz);
      const wheel = new THREE.Mesh(wheelGeo, shared.tyre);
      wheel.rotation.z = 0;
      const hub = new THREE.Mesh(hubGeo, shared.hub);
      wheel.add(hub);
      pivot.add(wheel);
      g.add(pivot);
      this.wheels.push({ pivot, wheel, front, x: wx, z: wz });
    }
    this.wheelRadius = wheelR;

    // headlights
    const headZ = l / 2 + 0.01;
    const lensGeo = new THREE.BoxGeometry(0.42, 0.16, 0.1);
    for (const side of [-1, 1]) {
      const lens = new THREE.Mesh(lensGeo, shared.head);
      lens.position.set(side * (w * 0.31), 0.72, headZ);
      g.add(lens);
    }
    this.headSpriteL = makeSprite(glowTex(), 0xfff0c8, 2.6, 0.5);
    this.headSpriteL.position.set(-w * 0.31, 0.72, headZ + 0.1);
    this.headSpriteR = makeSprite(glowTex(), 0xfff0c8, 2.6, 0.5);
    this.headSpriteR.position.set(w * 0.31, 0.72, headZ + 0.1);
    g.add(this.headSpriteL, this.headSpriteR);

    // dim beam cones and a faint pool just ahead of the nose
    this.beams = [];
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffeec0,
      transparent: true,
      opacity: 0.05,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beamMat = beamMat;
    for (const side of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5, 13, 10, 1, true), beamMat);
      cone.rotation.x = -Math.PI / 2;
      cone.position.set(side * (w * 0.3), 0.62, headZ + 6.4);
      g.add(cone);
      this.beams.push(cone);
    }
    this.pool = new THREE.Mesh(
      new THREE.PlaneGeometry(7.5, 13),
      new THREE.MeshBasicMaterial({
        map: glowTex(),
        color: 0xffe6b8,
        transparent: true,
        opacity: 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.set(0, 0.05, headZ + 5.5);
    g.add(this.pool);

    // tail lamps
    this.tailMats = [];
    for (const side of [-1, 1]) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x8a1b1b });
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.08), mat);
      tail.position.set(side * (w * 0.33), 0.74, -l / 2 - 0.01);
      g.add(tail);
      this.tailMats.push(mat);
      const flare = makeSprite(glowTex(), 0xff4030, 1.9, 0.0);
      flare.position.set(side * (w * 0.33), 0.74, -l / 2 - 0.14);
      g.add(flare);
      if (side === -1) this.tailFlareL = flare;
      else this.tailFlareR = flare;
    }

    // a soft ambient glow under the car so it does not float
    const under = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.8, l * 1.15),
      new THREE.MeshBasicMaterial({
        map: glowTex(),
        color: 0x000000,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = 0.03;
    g.add(under);
  }

  buildLightBar(y) {
    this.bar = { y, lenses: [], halos: [] };
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(this.spec.width * 0.62, 0.1, 0.34),
      shared.dark,
    );
    base.position.set(0, y - 0.03, -0.1);
    this.group.add(base);
    const mk = (side, matDim, matBright, haloColor) => {
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.3), matDim.clone());
      lens.position.set(side * (this.spec.width * 0.24), y + 0.07, -0.1);
      this.group.add(lens);
      const halo = makeSprite(glowTex(), haloColor, 2.6, 0.0);
      halo.position.copy(lens.position);
      this.group.add(halo);
      this.bar.lenses.push({ side, lens, dim: matDim, bright: matBright });
      this.bar.halos.push(halo);
    };
    mk(-1, shared.redDim, shared.red, 0xff3030);
    mk(1, shared.blueDim, shared.blue, 0x3060ff);

    this.spill = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({
        map: glowTex(),
        color: 0xff3030,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.0,
      }),
    );
    this.spill.rotation.x = -Math.PI / 2;
    this.spill.position.set(0, 0.06, -0.4);
    this.group.add(this.spill);
  }

  setLightMode(mode) {
    this.lightMode = mode;
    this.updateLightBar(0);
  }

  updateLightBar(dt) {
    if (!this.bar) return;
    this.barPhase += dt;
    let redOn = false;
    let blueOn = false;
    if (this.lightMode === 'red') redOn = true;
    else if (this.lightMode === 'blue') blueOn = true;
    else if (this.lightMode === 'off') {
      /* both off */
    } else {
      const phase = Math.floor(this.barPhase * 3) % 2;
      redOn = phase === 0;
      blueOn = phase === 1;
    }
    const apply = (entry, halo, on, bright, dimMat) => {
      entry.lens.material = on ? bright : dimMat;
      halo.material.opacity = on ? 0.95 : 0.12;
      halo.scale.setScalar(on ? 3.4 : 1.6);
    };
    apply(this.bar.lenses[0], this.bar.halos[0], redOn, shared.red, shared.redDim);
    apply(this.bar.lenses[1], this.bar.halos[1], blueOn, shared.blue, shared.blueDim);
    this.spill.material.color.setHex(redOn ? 0xff3030 : blueOn ? 0x3050ff : 0x101018);
    this.spill.material.opacity = redOn || blueOn ? 0.34 : 0.0;
  }

  place(x, z, heading) {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.sync(0);
  }

  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  get forwardSpeed() {
    return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading);
  }

  get lateralSpeed() {
    return this.vx * Math.cos(this.heading) - this.vz * Math.sin(this.heading);
  }

  // Arcade step: engine along the forward axis, grip bleeding the lateral slip.
  drivePhysics(dt, throttle, steer, handbrake) {
    const s = this.spec;
    if (this.wrecked) {
      throttle = 0;
      steer = 0;
    }
    const fwdSpeed = this.forwardSpeed;
    const latSpeed = this.lateralSpeed;
    this.throttle = throttle;
    this.handbrake = handbrake;
    this.braking = throttle < -0.05 && fwdSpeed > 0.4;

    let accel = 0;
    if (throttle > 0) {
      // taper acceleration as the car approaches its top speed
      const ratio = clamp(fwdSpeed / s.top, 0, 1);
      accel = s.accel * throttle * (1 - ratio * 0.82);
    } else if (throttle < 0) {
      accel = fwdSpeed > 0.5 ? s.brake * throttle : s.accel * 0.55 * throttle;
    }
    accel = clamp(accel, -s.brake, s.top);

    const fwdX = Math.sin(this.heading);
    const fwdZ = Math.cos(this.heading);
    const rightX = Math.cos(this.heading);
    const rightZ = -Math.sin(this.heading);

    let vF = fwdSpeed + accel * dt;
    // rolling drag and air drag
    vF -= vF * (0.55 + Math.abs(vF) * 0.012) * dt;
    if (handbrake) vF -= vF * 1.4 * dt;
    if (throttle === 0) vF -= vF * 0.5 * dt;

    // grip: lateral velocity bleeds away, faster at low speed, weaker on a handbrake
    let vL = latSpeed;
    const gripRate = handbrake ? s.grip * 1.1 : s.grip * 6.4;
    vL *= Math.exp(-gripRate * dt);

    // steering weakens with speed and reverses when reversing
    const speedAbs = Math.abs(vF);
    const steerAuthority = clamp(1.25 - speedAbs / (s.top * 1.5), 0.32, 1.0);
    const dir = vF < -0.3 ? -1 : 1;
    const turn = s.turn * steer * steerAuthority * dir * clamp(speedAbs / 2.2, 0, 1);
    const yawTarget = turn;
    this.yawRate = damp(this.yawRate, yawTarget, 9, dt);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // rebuild world velocity from the new axis
    const nfX = Math.sin(this.heading);
    const nfZ = Math.cos(this.heading);
    const nrX = Math.cos(this.heading);
    const nrZ = -Math.sin(this.heading);
    this.vx = nfX * vF + nrX * vL;
    this.vz = nfZ * vF + nrZ * vL;

    // speed clamp
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > s.top * 1.06) {
      const k = (s.top * 1.06) / sp;
      this.vx *= k;
      this.vz *= k;
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.steerVis = damp(this.steerVis, steer, 10, dt);
    this.wheelSpin += (vF * dt) / this.wheelRadius;

    this.impactCd = Math.max(0, this.impactCd - dt);
    this.honkCd = Math.max(0, this.honkCd - dt);
    this.collideWorld(dt);
    this.sync(dt);
  }

  collideWorld(dt) {
    const world = this.mgr.world;
    const probes = [
      [0, this.halfLength * 0.82],
      [0, -this.halfLength * 0.82],
    ];
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    let pushX = 0;
    let pushZ = 0;
    let hits = 0;
    for (const [ox, oz] of probes) {
      const px = this.x + fx * oz + Math.cos(this.heading) * ox;
      const pz = this.z + fz * oz - Math.sin(this.heading) * ox;
      const r = world.resolveCircle(px, pz, this.halfWidth * 0.95);
      if (r.hit) {
        pushX += r.x - px;
        pushZ += r.z - pz;
        hits++;
      }
    }
    if (hits > 0) {
      const len = Math.hypot(pushX, pushZ);
      if (len > 0.0001) {
        this.x += pushX / hits;
        this.z += pushZ / hits;
        const nx = pushX / len;
        const nz = pushZ / len;
        const into = this.vx * nx + this.vz * nz;
        if (into < 0) {
          // bounce back along the wall with restitution
          this.vx -= nx * into * 1.35;
          this.vz -= nz * into * 1.35;
          this.vx *= 0.72;
          this.vz *= 0.72;
          this.yawRate *= 0.55;
          const impact = -into;
          if (impact > 2.2 && this.impactCd <= 0) {
            this.impactCd = 0.35;
            const dmg = clamp((impact - 2.2) * 2.4, 0, 34);
            this.damage(dmg, true);
            this.mgr.onCrash(this, impact);
          }
        }
      }
    }

    // knock over small props
    for (const p of world.props) {
      if (!p.knockable || p.knocked) continue;
      if (Math.abs(p.x - this.x) > 4 || Math.abs(p.z - this.z) > 4) continue;
      if (Math.hypot(p.x - this.x, p.z - this.z) < this.halfLength + p.r) {
        if (Math.hypot(this.vx, this.vz) > 4) {
          world.knockProp(p);
          this.mgr.onPropHit(this, p);
        }
      }
    }
  }

  damage(amount, silent = false) {
    if (this.wrecked) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.wrecked = true;
      this.mgr.onWreck(this);
    }
  }

  repair() {
    this.health = this.maxHealth;
    this.wrecked = false;
  }

  sync(dt) {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;
    // subtle suspension roll from lateral slip
    const lat = this.lateralSpeed;
    const roll = clamp(-lat * 0.012, -0.09, 0.09);
    this.body.rotation.z = damp(this.body.rotation.z, roll, 8, Math.max(dt, 0.016));
    this.body.position.y = 0.3 + 0.3 + 0.26;

    for (const wdef of this.wheels) {
      wdef.wheel.rotation.x = this.wheelSpin;
      if (wdef.front) wdef.pivot.rotation.y = this.steerVis * 0.5;
    }

    // brake lights
    const braking = this.braking || this.handbrake;
    for (const m of this.tailMats) m.color.setHex(braking ? 0xff2a1a : 0x8a1b1b);
    const flareOp = braking ? 0.8 : 0.18;
    this.tailFlareL.material.opacity = flareOp;
    this.tailFlareR.material.opacity = flareOp;

    if (dt > 0) this.updateLightBar(dt);
    this.emitSmoke(dt);
    this.emitSkid(dt);
  }

  emitSmoke(dt) {
    const ratio = this.health / this.maxHealth;
    if (ratio > 0.62 && !this.wrecked) return;
    this.smokeTimer -= dt;
    const interval = this.wrecked ? 0.06 : 0.2;
    if (this.smokeTimer > 0) return;
    this.smokeTimer = interval;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.mgr.spawnSmoke(
      this.x + fx * this.halfLength * 0.55 + (Math.random() - 0.5),
      0.8,
      this.z + fz * this.halfLength * 0.55 + (Math.random() - 0.5),
      this.wrecked ? 1.5 : 0.8,
      this.wrecked,
    );
  }

  emitSkid(dt) {
    const lat = Math.abs(this.lateralSpeed);
    const sp = Math.hypot(this.vx, this.vz);
    const sliding = (lat > 5 && sp > 8) || (this.handbrake && sp > 6);
    this.skidTimer -= dt;
    if (!sliding) return;
    if (this.skidTimer > 0) return;
    this.skidTimer = 0.03;
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = Math.cos(this.heading);
    const rz = -Math.sin(this.heading);
    for (const side of [-1, 1]) {
      this.mgr.spawnSkid(
        this.x - fx * this.halfLength * 0.6 + rx * side * this.halfWidth * 0.8,
        this.z - fz * this.halfLength * 0.6 + rz * side * this.halfWidth * 0.8,
        this.heading,
      );
    }
    if (sp > 14 && Math.random() < 0.4) {
      this.mgr.spawnDust(this.x, this.z, this.heading);
    }
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}

function makeSprite(map, color, scale, opacity) {
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map,
      color,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity,
    }),
  );
  sp.scale.setScalar(scale);
  return sp;
}

export class VehicleManager {
  constructor(scene, world, callbacks = {}) {
    this.scene = scene;
    this.world = world;
    this.cars = [];
    this.playerCar = null;
    this.onCrash = callbacks.onCrash || (() => {});
    this.onWreck = callbacks.onWreck || (() => {});
    this.onPropHit = callbacks.onPropHit || (() => {});
    this.onCarHit = callbacks.onCarHit || (() => {});
    this.particles = { smoke: [], skid: [], dust: [] };
    this.smokePool = [];
    this.skidPool = [];
    this.dustPool = [];
    this.audio = callbacks.audio || null;
    this._initPools();
  }

  _initPools() {
    const tex = smokeTex();
    for (let i = 0; i < 90; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          color: 0xaab0bc,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      sp.visible = false;
      this.scene.add(sp);
      this.smokePool.push({ sprite: sp, life: 0, max: 1, vy: 0, scale: 1, growth: 1 });
    }
    const skidGeo = new THREE.PlaneGeometry(0.26, 0.9);
    skidGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 260; i++) {
      const m = new THREE.Mesh(
        skidGeo,
        new THREE.MeshBasicMaterial({
          color: 0x07070a,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      m.visible = false;
      this.scene.add(m);
      this.skidPool.push({ mesh: m, life: 0 });
    }
    for (let i = 0; i < 40; i++) {
      const sp = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          color: 0x8c7f6a,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      sp.visible = false;
      this.scene.add(sp);
      this.dustPool.push({ sprite: sp, life: 0, max: 1 });
    }
  }

  spawn(car) {
    this.scene.add(car.group);
    this.cars.push(car);
    return car;
  }

  create(type, colorHex, x, z, heading) {
    const palette = COLORS.carColors[type] || COLORS.carColors.sedan;
    const hex = colorHex !== undefined ? colorHex : palette[Math.floor(Math.random() * palette.length)];
    const car = new Car(this, type, hex);
    car.place(x, z, heading);
    return this.spawn(car);
  }

  remove(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
    if (this.playerCar === car) this.playerCar = null;
    car.dispose();
  }

  clearTraffic(keepPlayer = true) {
    for (const car of [...this.cars]) {
      if (keepPlayer && car === this.playerCar) continue;
      if (car.driver === 'police') continue;
      this.remove(car);
    }
  }

  nearestCar(x, z, maxDist = 999, exclude = null, requireUndamaged = false) {
    let best = null;
    let bd = maxDist;
    for (const car of this.cars) {
      if (car === exclude) continue;
      if (requireUndamaged && car.wrecked) continue;
      const d = Math.hypot(car.x - x, car.z - z);
      if (d < bd) {
        bd = d;
        best = car;
      }
    }
    return best ? { car: best, dist: bd } : null;
  }

  // The player's car step.
  stepPlayerCar(dt, input, audio) {
    const car = this.playerCar;
    if (!car) return;
    const ax = input.axis();
    const throttle = ax.y;
    const steer = -ax.x;
    const handbrake = input.isHeld('sprint');
    if (input.justPressed('horn') && car.honkCd <= 0) {
      car.honkCd = 0.7;
      if (audio) audio.horn();
    }
    car.drivePhysics(dt, throttle, steer, handbrake);
    this.resolveCarCollisions(dt);
    this.stepParticles(dt);
  }

  // AI cars: simple lane following handled by the caller's steering inputs.
  stepAICar(car, dt, throttle, steer) {
    car.drivePhysics(dt, throttle, steer, false);
  }

  coast(dt) {
    for (const car of this.cars) {
      if (car === this.playerCar) continue;
      if (car.driver === 'ai' || car.driver === 'police') continue;
      // parked: settle to a stop, lights idle
      car.vx *= Math.exp(-3 * dt);
      car.vz *= Math.exp(-3 * dt);
      car.x += car.vx * dt;
      car.z += car.vz * dt;
      car.steerVis = damp(car.steerVis, 0, 8, dt);
      car.sync(dt);
    }
  }

  resolveCarCollisions(dt) {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const a = cars[i];
      for (let j = i + 1; j < cars.length; j++) {
        const b = cars[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dist = Math.hypot(dx, dz);
        const minD = (a.halfLength + b.halfLength) * 0.72;
        if (dist > minD || dist < 0.0001) continue;
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = minD - dist;
        // push both apart, heavier cars move less
        const massA = a.spec.mass;
        const massB = b.spec.mass;
        const total = massA + massB;
        a.x -= nx * overlap * (massB / total);
        a.z -= nz * overlap * (massB / total);
        b.x += nx * overlap * (massA / total);
        b.z += nz * overlap * (massA / total);
        const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
        if (rel < 0) {
          const imp = -rel;
          const bounce = imp * 0.4;
          a.vx -= nx * bounce * (massB / total);
          a.vz -= nz * bounce * (massB / total);
          b.vx += nx * bounce * (massA / total);
          b.vz += nz * bounce * (massA / total);
          if (imp > 4) {
            const dmg = clamp((imp - 3) * 1.2, 0, 12);
            a.damage(dmg);
            b.damage(dmg);
            if (a === this.playerCar || b === this.playerCar) {
              this.onCarHit(a === this.playerCar ? b : a, imp);
            }
          }
        }
        a.sync(0);
        b.sync(0);
      }
    }
  }

  spawnSmoke(x, y, z, scale, dark) {
    const p = this.smokePool.find((s) => s.life <= 0);
    if (!p) return;
    p.sprite.visible = true;
    p.sprite.position.set(x, y, z);
    p.sprite.material.opacity = dark ? 0.42 : 0.26;
    p.sprite.material.color.setHex(dark ? 0x3a3a40 : 0x99a0ad);
    p.scale = scale;
    p.sprite.scale.setScalar(scale);
    p.life = 0;
    p.max = dark ? 1.9 : 1.4;
    p.vy = dark ? 0.9 : 1.3;
    p.growth = dark ? 2.6 : 2.0;
  }

  spawnSkid(x, z, heading) {
    const p = this.skidPool.find((s) => s.life <= 0);
    if (!p) return;
    p.mesh.visible = true;
    p.mesh.position.set(x, 0.045, z);
    p.mesh.rotation.y = heading;
    p.mesh.material.opacity = 0.5;
    p.life = 1;
    p.max = 1;
  }

  spawnDust(x, z, heading) {
    const p = this.dustPool.find((s) => s.life <= 0);
    if (!p) return;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    p.sprite.visible = true;
    p.sprite.position.set(x - fx * 2, 0.5, z - fz * 2);
    p.sprite.material.opacity = 0.25;
    p.sprite.scale.setScalar(1.6);
    p.life = 0;
    p.max = 0.9;
  }

  stepParticles(dt) {
    for (const p of this.smokePool) {
      if (p.life > p.max) continue;
      p.life += dt;
      const t = p.life / p.max;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.x += (Math.random() - 0.5) * dt * 0.8;
      p.sprite.position.z += (Math.random() - 0.5) * dt * 0.8;
      p.sprite.scale.setScalar(p.scale * (1 + t * p.growth));
      p.sprite.material.opacity *= 1 - dt * 1.4;
      if (p.life >= p.max) {
        p.sprite.visible = false;
        p.sprite.material.opacity = 0;
        p.life = 0;
        p.max = 0;
      }
    }
    for (const p of this.skidPool) {
      if (p.life <= 0) continue;
      p.life -= dt * 0.035;
      p.mesh.material.opacity = Math.max(0, p.life * 0.5);
      if (p.life <= 0) {
        p.mesh.visible = false;
        p.mesh.material.opacity = 0;
      }
    }
    for (const p of this.dustPool) {
      if (p.life > p.max) continue;
      p.life += dt;
      p.sprite.position.y += dt * 1.1;
      p.sprite.scale.setScalar(1.6 + p.life * 3);
      p.sprite.material.opacity *= 1 - dt * 1.6;
      if (p.life >= p.max) {
        p.sprite.visible = false;
        p.sprite.material.opacity = 0;
        p.life = 0;
        p.max = 0;
      }
    }
  }

  clearParticles() {
    for (const p of this.smokePool) {
      p.sprite.visible = false;
      p.sprite.material.opacity = 0;
      p.life = 0;
      p.max = 0;
    }
    for (const p of this.skidPool) {
      p.mesh.visible = false;
      p.mesh.material.opacity = 0;
      p.life = 0;
    }
    for (const p of this.dustPool) {
      p.sprite.visible = false;
      p.sprite.material.opacity = 0;
      p.life = 0;
      p.max = 0;
    }
  }
}

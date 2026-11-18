// Port Meridian — the four linked jobs.
// Each job has a name, a short brief, steps with plain-language objectives and a check
// function, a cash reward and a star rating. The beacon is a ground ring, a tall translucent
// pillar and a spinning diamond, bright enough to read from across the street.

import * as THREE from 'three';
import { MISSION_DEFS, PLACES, WAYPOINT_RADIUS } from './config.js';
import { clamp } from './random.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);

function ringTexture() {
  if (ringTexture._cache) return ringTexture._cache;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(70,240,220,1)';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(70,240,220,0.35)';
  g.lineWidth = 26;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  ringTexture._cache = tex;
  return tex;
}

function beamTexture() {
  if (beamTexture._cache) return beamTexture._cache;
  const W = 64;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, 'rgba(90,255,235,0.62)');
  grad.addColorStop(0.5, 'rgba(90,255,235,0.2)');
  grad.addColorStop(1, 'rgba(90,255,235,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  beamTexture._cache = tex;
  return tex;
}

export class Beacon {
  constructor(scene, x, z, color = 0x37f0d0) {
    this.scene = scene;
    this.x = x;
    this.z = z;
    this.group = new THREE.Group();
    this.group.position.set(x, 0, z);

    // A ground ring, drawn as a flat quad with a ring texture so it reads at any distance.
    const ring = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshBasicMaterial({
        map: ringTexture(), color, transparent: true, opacity: 0.95,
        depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    this.group.add(ring);
    this.ring = ring;

    // A tall translucent pillar.
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 2.0, 34, 14, 1, true),
      new THREE.MeshBasicMaterial({
        map: beamTexture(), color, transparent: true, opacity: 0.3,
        depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
      }),
    );
    pillar.position.y = 17;
    this.group.add(pillar);
    this.pillar = pillar;

    // A spinning diamond.
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.5, 0),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    diamond.position.y = 4.4;
    this.group.add(diamond);
    this.diamond = diamond;

    scene.add(this.group);
    this.time = 0;
  }

  setPosition(x, z) {
    this.x = x;
    this.z = z;
    this.group.position.set(x, 0, z);
  }

  update(dt) {
    this.time += dt;
    this.diamond.rotation.y += dt * 1.6;
    this.diamond.position.y = 4.4 + Math.sin(this.time * 2.2) * 0.42;
    this.pillar.material.opacity = 0.24 + Math.sin(this.time * 1.7) * 0.08;
    this.ring.material.opacity = 0.8 + Math.sin(this.time * 3.1) * 0.16;
    const pulse = 1 + Math.sin(this.time * 2.6) * 0.08;
    this.ring.scale.setScalar(pulse);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

export function makeCase(city) {  const group = new THREE.Group();
  const green = new THREE.MeshStandardMaterial({
    color: 0x2fa85a, roughness: 0.42, metalness: 0.32,
    emissive: 0x0d4022, emissiveIntensity: 1.4,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0xb8c4cc, roughness: 0.3, metalness: 0.8 });
  const body = new THREE.Mesh(BOX, green);
  body.scale.set(0.9, 0.62, 0.3);
  body.position.y = 0.42;
  group.add(body);
  const handle = new THREE.Mesh(BOX, trim);
  handle.scale.set(0.26, 0.07, 0.08);
  handle.position.set(0, 0.78, 0);
  group.add(handle);
  for (const x of [-0.32, 0.32]) {
    const latch = new THREE.Mesh(BOX, trim);
    latch.scale.set(0.1, 0.08, 0.06);
    latch.position.set(x, 0.5, 0.17);
    group.add(latch);
  }
  // A soft glow column so the case reads from a distance.
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.1, 9, 12, 1, true),
    new THREE.MeshBasicMaterial({
      map: beamTexture(), color: 0x6effa8, transparent: true, opacity: 0.24,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    }),
  );
  column.position.y = 4.5;
  group.add(column);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    new THREE.MeshBasicMaterial({
      map: ringTexture(), color: 0x6effa8, transparent: true, opacity: 0.7,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.07;
  group.add(halo);

  group.userData.city = city;
  return group;
}

export class Missions {
  constructor(scene, city, vehicles, audio) {
    this.scene = scene;
    this.city = city;
    this.vehicles = vehicles;
    this.audio = audio;
    this.index = -1;
    this.step = 0;
    this.completed = false;
    this.beacon = null;
    this.targetCar = null;
    this.caseObject = null;
    this.carrying = false;
    this.time = 0;
    this.onComplete = null;
    this.onStep = null;
    this.bannerTimer = 0;
    this.bannerText = '';
    this.bannerCash = 0;
    this.startDelay = 0;
    this.started = false;
  }

  get current() {
    return this.index >= 0 && this.index < MISSION_DEFS.length ? MISSION_DEFS[this.index] : null;
  }

  get jobNumber() {
    return Math.min(this.index + 1, MISSION_DEFS.length);
  }

  get total() {
    return MISSION_DEFS.length;
  }

  // Step descriptors, built lazily so checks can close over the live world.
  stepsFor(index) {
    const places = PLACES;
    switch (index) {
      case 0:
        return [
          {
            text: 'Steal a car — any car on the street will do',
            check: (ctx) => ctx.inCar && ctx.car !== null,
          },
          {
            text: 'Drive it to the lock-up on Kestrel Row',
            check: (ctx) => ctx.inCar
              && Math.hypot(ctx.car.x - places.lockup.x, ctx.car.z - places.lockup.z) < WAYPOINT_RADIUS,
          },
        ];
      case 1:
        return [
          {
            text: 'Find the runner\'s sports car near the marina',
            // Step one is satisfied by the brief itself: the target is spawned, so the step is
            // "wreck it" and the first step simply confirms the player is close to it.
            check: (ctx) => ctx.targetCar !== null
              && Math.hypot((ctx.car ?? ctx.player).x - ctx.targetCar.x, (ctx.car ?? ctx.player).z - ctx.targetCar.z) < WAYPOINT_RADIUS + 6,
          },
          {
            text: 'Wreck his sports car',
            check: (ctx) => ctx.targetCar !== null && ctx.targetCar.wrecked,
          },
        ];
      case 2:
        return [
          {
            text: 'Pick up the case at the marina',
            check: (ctx) => ctx.carrying,
          },
          {
            text: 'Run it north to the north quay',
            // While driving, the player figure is hidden and its x/z follow the car only on
            // entry, so the car counts as the player for the delivery.
            check: (ctx) => ctx.carrying
              && Math.hypot((ctx.car ?? ctx.player).x - places.northQuay.x, (ctx.car ?? ctx.player).z - places.northQuay.z) < WAYPOINT_RADIUS,
          },
        ];
      case 3:
        return [
          {
            text: 'Lift the sports car from the harbour deck',
            check: (ctx) => ctx.inCar && ctx.targetCar !== null && ctx.car === ctx.targetCar,
          },
          {
            text: 'Shake the tail until the wanted level is zero',
            check: (ctx) => ctx.inCar && ctx.targetCar !== null && ctx.car === ctx.targetCar && ctx.stars === 0,
          },
          {
            text: 'Reach the hideout',
            check: (ctx) => ctx.inCar && ctx.car === ctx.targetCar
              && Math.hypot(ctx.car.x - places.hideout.x, ctx.car.z - places.hideout.z) < WAYPOINT_RADIUS,
          },
        ];
      default:
        return [];
    }
  }

  // --- lifecycle --------------------------------------------------------

  reset() {
    this._clearObjects();
    this.index = -1;
    this.step = 0;
    this.completed = false;
    this.carrying = false;
    this.started = false;
    this.bannerTimer = 0;
    this.bannerText = '';
    this.startDelay = 0;
  }

  start(index = 0, step = 0) {
    this._clearObjects();
    this.index = clamp(index, 0, MISSION_DEFS.length - 1);
    this.step = step;
    this.completed = false;
    this.carrying = false;
    this.started = true;
    this.bannerTimer = 0;
    this._setupJob();
    if (this.onStep) this.onStep();
  }

  _clearObjects() {
    if (this.beacon) { this.beacon.dispose(); this.beacon = null; }
    if (this.targetCar) {
      this.vehicles.remove(this.targetCar);
      this.targetCar = null;
    }
    if (this.caseObject) {
      this.scene.remove(this.caseObject);
      this.caseObject.traverse((o) => {
        if (o.geometry && o.geometry !== BOX) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.caseObject = null;
    }
    this.carrying = false;
  }

  _setupJob() {
    const places = PLACES;
    const idx = this.index;
    if (idx === 0) {
      // No target needed; the lock-up is the waypoint until a car is taken.
      this.beacon = new Beacon(this.scene, places.lockup.x, places.lockup.z);
    } else if (idx === 1) {
      // Spawn the runner's sports car at the marina, with the beacon on it.
      const spot = this.city.findClearSpot(places.marina.x - 18, places.marina.z + 22, 34);
      this.targetCar = this.vehicles.spawn('sports', spot.x, spot.z, Math.PI * 0.75, 'parked', {
        color: 0x8a2ce0,
      });
      this.beacon = new Beacon(this.scene, spot.x, spot.z, 0xff5c8a);
      this.beacon.setPosition(spot.x, spot.z);
    } else if (idx === 2) {
      // The case at the marina, plus a glowing column.
      const spot = this.city.findClearSpot(places.marina.x, places.marina.z, 26);
      this.caseObject = makeCase(this.city);
      this.caseObject.position.set(spot.x, 0, spot.z);
      this.scene.add(this.caseObject);
      this.casePos = { x: spot.x, z: spot.z };
      this.beacon = new Beacon(this.scene, spot.x, spot.z, 0x6effa8);
    } else if (idx === 3) {
      // The sports car on the harbour deck.
      const spot = this.city.findClearSpot(places.marina.x + 18, places.marina.z + 40, 34);
      this.targetCar = this.vehicles.spawn('sports', spot.x, spot.z, Math.PI * 0.2, 'parked', {
        color: 0x2fc46a,
      });
      this.beacon = new Beacon(this.scene, spot.x, spot.z, 0x58c8ff);
    }
    this._refreshBeaconTarget();
  }

  _refreshBeaconTarget() {
    if (!this.beacon) return;
    const places = PLACES;
    const idx = this.index;
    if (idx === 0) {
      this.beacon.setPosition(places.lockup.x, places.lockup.z);
    } else if (idx === 1) {
      if (this.targetCar && !this.targetCar.wrecked) this.beacon.setPosition(this.targetCar.x, this.targetCar.z);
      else this.beacon.setPosition(places.marina.x, places.marina.z);
    } else if (idx === 2) {
      if (this.carrying) this.beacon.setPosition(places.northQuay.x, places.northQuay.z);
      else if (this.casePos) this.beacon.setPosition(this.casePos.x, this.casePos.z);
    } else if (idx === 3) {
      if (this.carrying && this.targetCar) this.beacon.setPosition(places.hideout.x, places.hideout.z);
      else if (this.targetCar) this.beacon.setPosition(this.targetCar.x, this.targetCar.z);
      else this.beacon.setPosition(places.hideout.x, places.hideout.z);
    }
  }

  get objectiveText() {
    if (this.completed) return 'Story complete — the city is yours';
    const job = this.current;
    if (!job) return 'Story complete — the city is yours';
    const steps = this.stepsFor(this.index);
    const s = steps[Math.min(this.step, steps.length - 1)];
    return s ? s.text : job.brief;
  }

  get jobLabel() {
    const job = this.current;
    if (!job) return null;
    return `JOB ${this.jobNumber} / ${this.total} — ${job.name.toUpperCase()}`;
  }

  // --- per-frame --------------------------------------------------------

  update(dt, ctx) {
    this.time += dt;
    if (this.bannerTimer > 0) this.bannerTimer = Math.max(0, this.bannerTimer - dt);

    if (!this.started || this.completed) {
      if (this.beacon) this.beacon.update(dt);
      return;
    }

    // Job 3 changes the beacon the moment the case is picked up; job 4 similar.
    if (this.index === 2 && !this.carrying && this.caseObject) {
      const d = Math.hypot(ctx.player.x - this.caseObject.position.x, ctx.player.z - this.caseObject.position.z);
      this.caseObject.rotation.y += dt * 0.8;
      if (d < 2.4) {
        this.carrying = true;
        this.scene.remove(this.caseObject);
        this.caseObject = null;
        this.audio.pickup();
        this._refreshBeaconTarget();
        if (this.onStep) this.onStep();
      }
    }
    if (this.index === 3 && !this.carrying && this.targetCar && ctx.car === this.targetCar) {
      this.carrying = true;
      this._refreshBeaconTarget();
      if (this.onStep) this.onStep();
    }

    if (this.beacon) this.beacon.update(dt);

    // Check the current step. A job may skip ahead if a later check passes (for example the
    // player takes the right car before the "find it" step registers).
    const steps = this.stepsFor(this.index);
    if (this.step < steps.length && steps[this.step].check(ctx)) {
      this.step++;
      if (this.onStep) this.onStep();
      if (this.step >= steps.length) this._complete();
      else this._refreshBeaconTarget();
    }
  }

  _complete() {
    const job = this.current;
    this.completed = true;
    this.bannerText = `${job.name.toUpperCase()} — COMPLETE`;
    this.bannerCash = job.reward;
    this.bannerTimer = 3.6;
    this.audio.missionComplete();
    if (this.beacon) { this.beacon.dispose(); this.beacon = null; }
    if (this.targetCar && this.index !== 3) {
      // Keep the wreck around for a beat; it is removed when the next job starts.
    }
    if (this.onComplete) this.onComplete(job);
  }

  // Called by the game a moment after a completion to start the next job.
  advanceAfterDelay() {
    if (this.index + 1 >= MISSION_DEFS.length) {
      return false;
    }
    this.start(this.index + 1, 0);
    return true;
  }

  dispose() {
    this._clearObjects();
  }
}

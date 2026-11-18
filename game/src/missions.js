// Four linked jobs, "Rookie to Kingpin": a beacon marks the target, a check runs the
// step, a banner celebrates the pay, and the next job starts a beat later.

import * as THREE from 'three';
import { MISSION_TARGETS, PLAYER } from './config.js';

const REACH = 14;

function glowTex() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class MissionSystem {
  constructor(scene, world, game) {
    this.scene = scene;
    this.world = world;
    this.game = game;
    this.index = 0;
    this.step = 0;
    this.active = false;
    this.complete = false;
    this.pendingNext = 0;
    this.banner = null;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.beacon = null;
    this.marker = null;
    this.packageMesh = null;
    this.targetCar = null;
    this.tex = glowTex();
    this.defs = buildDefs(this);
  }

  get current() {
    return this.defs[Math.min(this.index, this.defs.length - 1)];
  }

  get currentStep() {
    const d = this.current;
    if (!d) return null;
    return d.steps[Math.min(this.step, d.steps.length - 1)];
  }

  get objectiveText() {
    if (this.complete) return 'Story complete — the city is yours';
    const step = this.currentStep;
    return step ? step.text : '';
  }

  get jobLabel() {
    if (this.complete) return 'ROOKIE TO KINGPIN';
    return `JOB ${Math.min(this.index + 1, this.defs.length)} OF ${this.defs.length}`;
  }

  get jobName() {
    return this.complete ? 'THE CITY IS YOURS' : this.current.name;
  }

  start(index = 0) {
    this.index = Math.max(0, Math.min(index, this.defs.length - 1));
    this.step = 0;
    this.complete = false;
    this.active = true;
    this.pendingNext = 0;
    this.cleanup();
    const d = this.current;
    if (d && d.onStart) d.onStart(this);
    this.updateBeacon();
  }

  nextStep() {
    const d = this.current;
    this.step++;
    if (this.step >= d.steps.length) {
      this.finishJob();
      return;
    }
    if (d.onStep) d.onStep(this, this.step);
    this.updateBeacon();
  }

  finishJob() {
    const d = this.current;
    this.game.addCash(d.reward);
    this.game.audio.missionComplete();
    this.game.showBanner(`${d.name.toUpperCase()} — COMPLETE`, `$${d.reward}`);
    this.game.coolWanted(1);
    this.cleanup();
    this.active = false;
    this.pendingNext = 1.2;
  }

  onPendingNext(dt) {
    if (this.pendingNext <= 0) return;
    this.pendingNext -= dt;
    if (this.pendingNext <= 0) {
      this.pendingNext = 0;
      if (this.index < this.defs.length - 1) {
        this.start(this.index + 1);
      } else {
        this.complete = true;
        this.game.showBanner('ROOKIE TO KINGPIN', 'THE CITY IS YOURS', 4.5);
      }
    }
  }

  // The position the beacon should currently mark.
  targetPos() {
    if (this.shotTarget) return this.shotTarget;
    const d = this.current;
    if (!d || !this.active) return null;
    const step = this.currentStep;
    return step ? step.target(this) : null;
  }

  updateBeacon() {
    const target = this.targetPos();
    this.clearBeacon();
    if (!target) return;
    const grp = new THREE.Group();
    grp.position.set(target.x, 0, target.z);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(REACH * 0.62, REACH * 0.75, 40),
      new THREE.MeshBasicMaterial({
        color: 0x38f0dc,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    grp.add(ring);
    this.ring = ring;

    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(REACH * 0.5, REACH * 0.62, 34, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x2ad0c0,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    pillar.position.y = 17;
    grp.add(pillar);
    this.pillar = pillar;

    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(1.7, 0),
      new THREE.MeshBasicMaterial({ color: 0x7cffee }),
    );
    diamond.position.y = 7;
    grp.add(diamond);
    this.diamond = diamond;

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.tex,
        color: 0x4ffff0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.7,
      }),
    );
    halo.scale.setScalar(11);
    halo.position.y = 7;
    grp.add(halo);
    this.halo = halo;

    this.marker = grp;
    this.root.add(grp);

    if (target.package) this.addPackage(target.x, target.z);
  }

  addPackage(x, z) {
    const g = new THREE.Group();
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 1.0, 1.0),
      new THREE.MeshStandardMaterial({
        color: 0x2f6a3a,
        roughness: 0.6,
        metalness: 0.2,
        emissive: 0x0d3a18,
        emissiveIntensity: 0.8,
      }),
    );
    crate.position.y = 0.6;
    g.add(crate);
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.1, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.5, metalness: 0.7 }),
    );
    handle.position.y = 1.16;
    g.add(handle);
    const col = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.5, 9, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x38f0a0,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    col.position.y = 4.5;
    g.add(col);
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.tex,
        color: 0x4fffb0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.55,
      }),
    );
    glow.scale.setScalar(7);
    glow.position.y = 0.9;
    g.add(glow);
    g.position.set(x, 0, z);
    this.packageMesh = g;
    this.root.add(g);
  }

  clearBeacon() {
    if (this.marker) {
      this.root.remove(this.marker);
      this.marker.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      this.marker = null;
    }
  }

  cleanup() {
    this.clearBeacon();
    if (this.packageMesh) {
      this.root.remove(this.packageMesh);
      this.packageMesh = null;
    }
    if (this.targetCar) {
      this.game.cars.remove(this.targetCar);
      this.targetCar = null;
    }
  }

  update(dt) {
    this.onPendingNext(dt);
    if (this.marker) {
      this.marker.rotation.y += dt * 0.9;
      const t = performance.now() * 0.001;
      if (this.diamond) {
        this.diamond.position.y = 7 + Math.sin(t * 1.6) * 0.5;
        this.diamond.rotation.y += dt * 1.7;
      }
      if (this.halo) this.halo.material.opacity = 0.55 + Math.sin(t * 2.1) * 0.18;
      if (this.ring) this.ring.material.opacity = 0.6 + Math.sin(t * 2.4) * 0.16;
      if (this.pillar) this.pillar.material.opacity = 0.13 + Math.sin(t * 1.3) * 0.04;
    }
    if (!this.active || this.complete) return;
    const step = this.currentStep;
    if (!step) return;
    if (step.check(this)) {
      this.game.audio.pickup();
      this.nextStep();
    }
  }

  // Distance from the player (or their car) to the current target.
  distanceTo(playerPos) {
    const t = this.targetPos();
    if (!t) return Infinity;
    return Math.hypot(t.x - playerPos.x, t.z - playerPos.z);
  }
}

function buildDefs(ms) {
  return [
    {
      name: 'First Wheels',
      brief: 'Any car will do. Bring it to the lock-up on Kestrel Row and it is yours to keep — until someone pays better.',
      reward: 450,
      stars: 1,
      steps: [
        {
          text: 'Steal any car',
          target: () => ({ x: 96, z: -166 }),
          check: (m) => m.game.pose === 'driving' && !!m.game.player.car,
        },
        {
          text: 'Bring it to the lock-up on Kestrel Row',
          target: () => ({ x: MISSION_TARGETS.lockup.x, z: MISSION_TARGETS.lockup.z }),
          check: (m) => {
            const car = m.game.player.car;
            if (!car) return false;
            return Math.hypot(car.x - MISSION_TARGETS.lockup.x, car.z - MISSION_TARGETS.lockup.z) < REACH + 2;
          },
        },
      ],
    },
    {
      name: 'Payback',
      brief: 'A runner skipped a debt and parked his sports car across town. Wreck it. Do not keep it.',
      reward: 800,
      stars: 2,
      onStart: (m) => {
        const spot = m.world.findParkingSpot(MISSION_TARGETS.runner.x, MISSION_TARGETS.runner.z);
        const car = m.game.cars.create('sports', 0xf04a2a, MISSION_TARGETS.runner.x, MISSION_TARGETS.runner.z, spot.heading);
        car.driver = null;
        m.targetCar = car;
      },
      steps: [
        {
          text: "Find the runner's sports car",
          target: (m) => (m.targetCar ? { x: m.targetCar.x, z: m.targetCar.z } : { x: MISSION_TARGETS.runner.x, z: MISSION_TARGETS.runner.z }),
          check: (m) => !!m.targetCar && Math.hypot(m.game.player.x - m.targetCar.x, m.game.player.z - m.targetCar.z) < 22,
        },
        {
          text: 'Wreck the sports car',
          target: (m) => (m.targetCar ? { x: m.targetCar.x, z: m.targetCar.z } : { x: MISSION_TARGETS.runner.x, z: MISSION_TARGETS.runner.z }),
          check: (m) => !!m.targetCar && m.targetCar.wrecked,
        },
      ],
    },
    {
      name: 'Hot Package',
      brief: 'The case is at the marina and the buyer is at the north quay. Half the harbour will want it, so drive fast.',
      reward: 1400,
      stars: 2,
      onStart: (m) => {
        m.holdingPackage = false;
        m.game.raiseWanted(1);
      },
      steps: [
        {
          text: 'Pick up the case at the marina',
          target: () => ({ x: MISSION_TARGETS.marina.x, z: MISSION_TARGETS.marina.z, package: true }),
          check: (m) => {
            const p = m.game.player;
            const pos = p.car ? p.car : p;
            if (Math.hypot(pos.x - MISSION_TARGETS.marina.x, pos.z - MISSION_TARGETS.marina.z) >= REACH) return false;
            m.holdingPackage = true;
            return true;
          },
        },
        {
          text: 'Deliver the case to the north quay',
          target: () => ({ x: MISSION_TARGETS.northQuay.x, z: MISSION_TARGETS.northQuay.z, package: true }),
          check: (m) => {
            const p = m.game.player;
            const pos = p.car ? p.car : p;
            return Math.hypot(pos.x - MISSION_TARGETS.northQuay.x, pos.z - MISSION_TARGETS.northQuay.z) < REACH;
          },
        },
      ],
    },
    {
      name: 'The Big Score',
      brief: 'The harbour deck has a green sports car with three keys out there. Take it, shake the tail, and vanish to the north.',
      reward: 2600,
      stars: 3,
      onStart: (m) => {
        const car = m.game.cars.create('sports', 0x2ad06a, MISSION_TARGETS.harbourDeck.x, MISSION_TARGETS.harbourDeck.z, 0.4);
        car.driver = null;
        m.targetCar = car;
      },
      steps: [
        {
          text: 'Lift the sports car from the harbour deck',
          target: (m) => (m.targetCar ? { x: m.targetCar.x, z: m.targetCar.z } : { x: MISSION_TARGETS.harbourDeck.x, z: MISSION_TARGETS.harbourDeck.z }),
          check: (m) => m.game.player.car && m.game.player.car === m.targetCar,
        },
        {
          text: 'Shake the tail — get the wanted level to zero',
          target: () => ({ x: MISSION_TARGETS.hideout.x, z: MISSION_TARGETS.hideout.z }),
          check: (m) => m.game.police.stars === 0,
        },
        {
          text: 'Reach the hideout',
          target: () => ({ x: MISSION_TARGETS.hideout.x, z: MISSION_TARGETS.hideout.z }),
          check: (m) => {
            const p = m.game.player;
            const pos = p.car ? p.car : p;
            return Math.hypot(pos.x - MISSION_TARGETS.hideout.x, pos.z - MISSION_TARGETS.hideout.z) < REACH;
          },
        },
      ],
    },
  ];
}

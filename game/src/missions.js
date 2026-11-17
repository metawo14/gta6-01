// The four jobs of the "Rookie to Kingpin" story: objective text, marker beacon, waypoint,
// rewards and the end-of-mission banner. Pure state; the HUD and world read from it.
import * as THREE from 'three';
import { MISSION, CAR_TYPES } from './config.js';

export const MISSIONS = [
  {
    id: 'first-wheels',
    name: 'First Wheels',
    brief: 'Take any car off the street and bring it to the lock-up on Kestrel Row.',
    steps: [
      { text: 'Steal any car', check: (s) => s.inCar },
      { text: 'Drive it to the lock-up', check: (s, m) => m.nearMarker < MISSION.waypointReach },
    ],
    reward: 450,
    stars: 1,
  },
  {
    id: 'payback',
    name: 'Payback',
    brief: 'A runner skipped a debt. Find his motor and put it out of service.',
    steps: [
      { text: 'Find the debtor\'s car', spawn: true },
      { text: 'Wreck it', check: (s, m) => m.targetWrecked },
    ],
    reward: 800,
    stars: 2,
  },
  {
    id: 'hot-package',
    name: 'Hot Package',
    brief: 'Pick up the case from the marina and move it across town with the heat on you.',
    steps: [
      { text: 'Collect the package', check: (s, m) => m.picked },
      { text: 'Deliver it to the north quay', check: (s, m) => m.picked && m.nearMarker < MISSION.waypointReach },
    ],
    reward: 1400,
    stars: 2,
  },
  {
    id: 'big-score',
    name: 'The Big Score',
    brief: 'Lift the sports car from the harbour deck, shake the tail, and reach the hideout.',
    steps: [
      { text: 'Steal the sports car', check: (s) => s.inCar && s.inCar.type === 'sports' },
      { text: 'Shake the tail (stars to zero)', check: (s) => s.stars === 0 },
      { text: 'Reach the hideout', check: (s, m) => m.nearMarker < MISSION.waypointReach },
    ],
    reward: 2600,
    stars: 3,
  },
];

export class Missions {
  constructor(scene, world, vehicles, police, audio, traffic) {
    this.scene = scene;
    this.world = world;
    this.vehicles = vehicles;
    this.police = police;
    this.audio = audio;
    this.traffic = traffic;
    this.index = 0;
    this.state = 'idle';
    this.step = 0;
    this.timer = 0;
    this.marker = null;
    this.target = null;
    this.picked = false;
    this.banner = null;
    this.bannerTimer = 0;
    this.packageMesh = null;
    this.beacon = this.makeBeacon();
    this.beacon.visible = false;
    this.scene.add(this.beacon);
  }

  makeBeacon() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.4, 32),
      new THREE.MeshBasicMaterial({ color: 0x54e6c8, transparent: true, opacity: 0.65, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    g.add(ring);
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 2.3, 26, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x54e6c8, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
    );
    pillar.position.y = 13;
    g.add(pillar);
    const diamond = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.85),
      new THREE.MeshBasicMaterial({ color: 0x9dffe8 }),
    );
    diamond.position.y = 3.4;
    g.add(diamond);
    g.userData.spin = diamond;
    return g;
  }

  get current() {
    return MISSIONS[this.index] ?? null;
  }

  objectiveText() {
    const m = this.current;
    if (!m) return 'Story complete — the city is yours';
    const step = m.steps[Math.min(this.step, m.steps.length - 1)];
    return `${m.name}: ${step.text}`;
  }

  start(index) {
    this.index = index;
    this.state = 'active';
    this.step = 0;
    this.picked = false;
    this.banner = null;
    this.clearTarget();
    this.setupMarker();
    if (this.current.id === 'payback') this.spawnTarget();
    if (this.current.id === 'hot-package') this.spawnPackage();
  }

  setupMarker() {
    const id = this.current.id;
    if (id === 'first-wheels') this.setMarker(214, -40);
    else if (id === 'payback') this.setMarker(40, 120);
    else if (id === 'hot-package') this.setMarker(282, -150);
    else this.setMarker(-240, 210);
    this.beacon.visible = true;
  }

  setMarker(x, z) {
    this.marker = { x, z };
    this.beacon.position.set(x, 0, z);
  }

  spawnTarget() {
    const t = this.vehicles.spawn('sports', 0x8f2f4a, 30, 132, Math.PI * 0.5, 'target');
    t.driver = 'ai';
    t.aiMaxSpeed = 13;
    t.aiThrottle = 0.7;
    t.aiHeading = Math.PI * 0.5;
    t.hp = t.maxHp = 150;
    this.target = t;
    this.targetWrecked = false;
    if (this.packageMesh) this.scene.remove(this.packageMesh);
    this.packageMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.7, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x3a5f4c, roughness: 0.6 }),
    );
    this.packageMesh.position.set(this.marker.x, 1.0, this.marker.z);
    this.scene.add(this.packageMesh);
  }

  // The briefcase the player collects on job three, sitting on its marker.
  spawnPackage() {
    if (this.packageMesh) this.scene.remove(this.packageMesh);
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.78, 1.05),
      new THREE.MeshStandardMaterial({ color: 0x3a5f4c, roughness: 0.5, metalness: 0.2 }),
    );
    crate.position.set(this.marker.x, 0.9, this.marker.z);
    this.scene.add(crate);
    this.packageMesh = crate;
    const glow = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.9, 8, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x9dffe8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    glow.position.set(this.marker.x, 4.2, this.marker.z);
    this.scene.add(glow);
    this.packageGlow = glow;
  }

  clearTarget() {
    if (this.target) {
      this.vehicles.remove(this.target);
      this.target = null;
    }
    if (this.packageMesh) {
      this.scene.remove(this.packageMesh);
      this.packageMesh = null;
    }
    if (this.packageGlow) {
      this.scene.remove(this.packageGlow);
      this.packageGlow = null;
    }
  }

  update(dt, player) {
    if (this.beacon.visible && this.beacon.userData.spin) {
      this.beacon.userData.spin.rotation.y += dt * 1.6;
      this.beacon.userData.spin.position.y = 3.4 + Math.sin(this.timer * 2) * 0.3;
    }
    this.timer += dt;
    if (!this.current) return;
    if (this.state !== 'active') return;

    const pos = player.inCar ? player.inCar.pos : new THREE.Vector3(player.pos.x, 0, player.pos.z);
    this.nearMarker = this.marker ? Math.hypot(pos.x - this.marker.x, pos.z - this.marker.z) : Infinity;

    if (this.target) this.targetWrecked = this.target.wrecked;
    if (this.current.id === 'payback') this.nearMarker = 0;

    if (this.current.id === 'hot-package' && this.step === 0) {
      // Collect on foot or by car when close to the case.
      if (this.packageMesh) {
        const d = Math.hypot(pos.x - this.marker.x, pos.z - this.marker.z);
        if (d < 6) {
          this.picked = true;
          this.scene.remove(this.packageMesh);
          this.packageMesh = null;
          if (this.packageGlow) {
            this.scene.remove(this.packageGlow);
            this.packageGlow = null;
          }
          this.audio.pickup();
          this.setMarker(150, 190);
          this.step = 1;
        }
      }
    }

    const mission = this.current;
    const view = { ...player, inCar: player.inCar, stars: this.police.stars };
    const step = mission.steps[this.step];
    if (step && step.check && step.check(view, this)) {
      if (this.step < mission.steps.length - 1) {
        this.step++;
        this.audio.blip(880, 0.1);
        if (mission.id === 'big-score' && this.step === 1) this.police.setStars(3);
      } else {
        this.complete();
      }
    }
  }

  complete() {
    const mission = this.current;
    this.state = 'complete';
    this.beacon.visible = false;
    this.clearTarget();
    this.banner = { kind: 'complete', text: `${mission.name} — COMPLETE`, sub: `+$${mission.reward}`, timer: 4 };
    if (this.onReward) this.onReward(mission.reward);
    this.audio.missionComplete();
    if (mission.stars) {
      // Mission crime heat cools when the job closes.
      this.police.setStars(Math.max(0, this.police.stars - 1));
    }
    this.index++;
    if (this.index < MISSIONS.length) {
      this.nextTimer = 1.2;
    }
  }

  tick(dt) {
    if (this.nextTimer !== undefined) {
      this.nextTimer -= dt;
      if (this.nextTimer <= 0) {
        this.nextTimer = undefined;
        this.start(this.index);
      }
    }
    if (this.banner) {
      this.banner.timer -= dt;
      if (this.banner.timer <= 0) this.banner = null;
    }
  }

  reset() {
    this.index = 0;
    this.state = 'idle';
    this.step = 0;
    this.timer = 0;
    this.banner = null;
    this.beacon.visible = false;
    this.clearTarget();
  }
}

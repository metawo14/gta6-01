// The wanted level and the police that answer it: units spawn at the edge of the map and
// edge, siren wailing, ram the player and try to box them in; on foot they close and arrest.
import * as THREE from 'three';
import { POLICE, CAR_TYPES, CITY, gridLine } from './config.js';

const FLASH = 0.18;

export class Police {
  constructor(scene, world, vehicles, audio, rng) {
    this.scene = scene;
    this.world = world;
    this.vehicles = vehicles;
    this.audio = audio;
    this.rng = rng;
    this.stars = 0;
    this.heat = 0;
    this.units = [];
    this.spawnTimer = 0;
    this.arrestTimer = 0;
    this.events = [];
    this.busted = false;
  }

  setStars(n) {
    const next = Math.max(0, Math.min(POLICE.maxStars, Math.round(n)));
    if (next > this.stars) this.events.push({ type: 'up', stars: next });
    if (next < this.stars) this.events.push({ type: 'down', stars: next });
    this.stars = next;
    this.heat = 0;
    if (next === 0) this.clear();
  }

  addStars(n) {
    this.setStars(this.stars + n);
  }

  clear() {
    for (const unit of this.units) this.vehicles.remove(unit.car);
    this.units = [];
    this.arrestTimer = 0;
  }

  spawnUnit() {
    const angle = this.rng.range(0, Math.PI * 2);
    const radius = POLICE.spawnRange;
    let x = Math.cos(angle) * radius;
    let z = Math.sin(angle) * radius;
    x = Math.max(-CITY.bound + 20, Math.min(CITY.bound - 30, x));
    z = Math.max(-CITY.bound + 20, Math.min(CITY.bound - 20, z));
    const car = this.vehicles.spawn('police', 0x1b2a44, x, z, angle + Math.PI, 'police');
    car.driver = 'police';
    car.hp = car.maxHp = CAR_TYPES.police.hp + this.stars * 18;
    car.aiMaxSpeed = POLICE.unitSpeed + this.stars * 1.6;
    car.aiHeading = angle + Math.PI;
    this.units.push({ car, state: 'chase', arrest: 0, id: this.units.length });
  }

  wanted(dt, player, crimes) {
    if (crimes.length > 0) {
      for (const c of crimes) {
        this.heat = 0;
        if (c.stars) this.addStars(c.stars);
      }
    }
    if (this.stars > 0) {
      const policeNear = this.units.some((u) => Math.hypot(u.car.pos.x - player.pos.x, u.car.pos.z - player.pos.z) < 55);
      if (!policeNear && crimes.length === 0) {
        this.heat += dt;
        if (this.heat > POLICE.starDecay) {
          this.heat = 0;
          this.setStars(this.stars - 1);
        }
      }
    }
    this.spawnTimer -= dt;
    const targetUnits = Math.min(POLICE.maxUnits, this.stars * 2 - 1);
    if (this.stars > 0 && this.units.length < targetUnits && this.spawnTimer <= 0) {
      this.spawnTimer = 3.5 - this.stars * 0.4;
      this.spawnUnit();
    }
  }

  update(dt, player, onArrest, onWasted) {
    const playerCar = player.inCar;
    const target = playerCar ? playerCar.pos : new THREE.Vector3(player.pos.x, 0, player.pos.z);
    let nearest = Infinity;

    for (let i = this.units.length - 1; i >= 0; i--) {
      const unit = this.units[i];
      const car = unit.car;
      if (car.wrecked) {
        this.vehicles.remove(car);
        this.units.splice(i, 1);
        continue;
      }
      const d = Math.hypot(car.pos.x - target.x, car.pos.z - target.z);
      nearest = Math.min(nearest, d);

      // Steer straight at the player with a little lead, and ram when close.
      const speed = Math.min(car.aiMaxSpeed, d < 20 ? 22 : car.aiMaxSpeed);
      const lead = playerCar ? playerCar.vel.clone().multiplyScalar(Math.min(0.9, d / 60)) : new THREE.Vector3();
      const aim = new THREE.Vector3(target.x + lead.x, 0, target.z + lead.z);
      const want = Math.atan2(aim.x - car.pos.x, aim.z - car.pos.z);
      let diff = want - car.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      car.heading += Math.max(-1, Math.min(1, diff * 2.6)) * Math.min(2.2, 0.5 + speed * 0.06) * dt;
      car.aiHeading = car.heading;
      car.vel.set(Math.sin(car.heading) * speed, 0, Math.cos(car.heading) * speed);
      car.speed = speed;
      car.pos.addScaledVector(car.vel, dt);
      car.syncMesh();

      if (playerCar && d < 4.4) {
        const push = playerCar.forward.clone().multiplyScalar(-1).multiplyScalar(1.2);
        playerCar.vel.add(push);
        playerCar.damage(dt * 24);
        car.damage(dt * 10);
        unit.ram = 0.4;
        this.audio.crash(0.5);
      }

      // On foot: close in and arrest.
      if (!playerCar) {
        if (d < POLICE.arrestRange) {
          this.arrestTimer += dt;
          if (this.arrestTimer > POLICE.arrestTime) onArrest();
        } else {
          this.arrestTimer = Math.max(0, this.arrestTimer - dt * 0.6);
        }
        if (d < 3.2 && Math.random() < dt * 1.2) {
          player.health -= 9;
          if (player.health <= 0) onWasted();
        }
      }
    }

    if (this.units.length === 0) this.arrestTimer = 0;
    this.audio.setSiren(this.stars > 0 && nearest < 140, nearest);
  }

  // Police on foot for the on-foot shot: two officers closing on the player.
  spawnOfficers(pos, heading) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.66, 0.28), new THREE.MeshStandardMaterial({ color: 0x1c2f4f }));
    body.position.y = 1.24;
    g.add(body);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.28, 0.26), new THREE.MeshStandardMaterial({ color: 0xc99a76 }));
    head.position.y = 1.68;
    g.add(head);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.3), new THREE.MeshStandardMaterial({ color: 0x0f1a30 }));
    cap.position.y = 1.86;
    g.add(cap);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.62, 0.19), new THREE.MeshStandardMaterial({ color: 0x141821 }));
      leg.position.set(s * 0.12, 0.62, 0);
      g.add(leg);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.15), new THREE.MeshStandardMaterial({ color: 0x1c2f4f }));
      arm.position.set(s * 0.32, 1.2, 0);
      g.add(arm);
    }
    g.position.set(pos.x, 0, pos.z);
    g.rotation.y = heading;
    this.scene.add(g);
    return g;
  }
}

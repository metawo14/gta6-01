// The player on foot: a low-poly articulated figure built from boxes, with a walk cycle,
// jump, sprint, punch and pistol aim. Physics is circle-vs-box against the city.
import * as THREE from 'three';
import { PLAYER, CITY } from './config.js';

const SKIN = 0xc99a76;
const JACKET = 0x2b3a55;
const PANTS = 0x23262f;
const SHOE = 0x15171d;

function box(w, h, d, color, rough = 0.8) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 }),
  );
  return mesh;
}

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.rate = 0;
    this.phase = 0;
    this.speed = 0;
    this.build();
    scene.add(this.root);
    this.reset(0, 0, 0);
  }

  build() {
    const torso = new THREE.Group();
    const chest = box(0.62, 0.66, 0.34, JACKET);
    chest.position.y = 1.24;
    torso.add(chest);
    const hips = box(0.56, 0.26, 0.32, PANTS);
    hips.position.y = 0.85;
    torso.add(hips);
    const head = box(0.34, 0.36, 0.32, SKIN);
    head.position.y = 1.76;
    torso.add(head);
    const hair = box(0.37, 0.12, 0.35, 0x1c1a1f);
    hair.position.y = 1.94;
    torso.add(hair);
    // A bright scarf so the figure reads at a distance in screenshots.
    const scarf = box(0.44, 0.12, 0.38, 0xd4463f);
    scarf.position.y = 1.56;
    torso.add(scarf);

    this.armL = new THREE.Group();
    const armLMesh = box(0.17, 0.6, 0.19, JACKET);
    armLMesh.position.y = -0.3;
    this.armL.add(armLMesh);
    this.armL.position.set(-0.39, 1.5, 0);
    torso.add(this.armL);

    this.armR = new THREE.Group();
    const armRMesh = box(0.17, 0.6, 0.19, JACKET);
    armRMesh.position.y = -0.3;
    this.armR.add(armRMesh);
    this.armR.position.set(0.39, 1.5, 0);
    torso.add(this.armR);

    this.legL = new THREE.Group();
    const legLMesh = box(0.22, 0.78, 0.24, PANTS);
    legLMesh.position.y = -0.39;
    this.legL.add(legLMesh);
    const shoeL = box(0.24, 0.13, 0.36, SHOE);
    shoeL.position.set(0, -0.82, -0.06);
    this.legL.add(shoeL);
    this.legL.position.set(-0.15, 0.86, 0);
    torso.add(this.legL);

    this.legR = new THREE.Group();
    const legRMesh = box(0.22, 0.78, 0.24, PANTS);
    legRMesh.position.y = -0.39;
    this.legR.add(legRMesh);
    const shoeR = box(0.24, 0.13, 0.36, SHOE);
    shoeR.position.set(0, -0.82, -0.06);
    this.legR.add(shoeR);
    this.legR.position.set(0.15, 0.86, 0);
    torso.add(this.legR);

    this.pistol = box(0.09, 0.11, 0.34, 0x14151a, 0.4);
    this.pistol.position.set(0, -0.58, -0.2);
    this.pistol.visible = false;
    this.armR.add(this.pistol);

    this.torso = torso;
    this.root.add(torso);
    this.body = torso;
  }

  reset(x, z, heading) {
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.heading = heading;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.health = PLAYER.maxHealth;
    this.dead = false;
    this.inCar = null;
    this.punchTimer = 0;
    this.aim = 0;
    this.weapon = 'pistol';
    this.ammo = WEAPON_MAG;
    this.reserve = 48;
    this.reloading = 0;
    this.fireCooldown = 0;
    this.root.visible = true;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = heading;
  }

  get position() {
    return new THREE.Vector3(this.pos.x, this.y, this.pos.z);
  }

  update(dt, input, world, cameraYaw) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.reloading = Math.max(0, this.reloading - dt);
    this.punchTimer = Math.max(0, this.punchTimer - dt);
    if (this.inCar) return;

    const axis = input.axis();
    const wantSprint = input.down('sprint');
    const speed = wantSprint ? PLAYER.sprint : PLAYER.walk;
    const forward = new THREE.Vector3(Math.sin(cameraYaw), 0, Math.cos(cameraYaw));
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const move = new THREE.Vector3()
      .addScaledVector(forward, -axis.y)
      .addScaledVector(right, axis.x);
    if (move.lengthSq() > 1) move.normalize();

    const targetSpeed = move.length() * speed;
    const accel = this.grounded ? 14 : 5;
    this.vel.x += (move.x * speed - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (move.z * speed - this.vel.z) * Math.min(1, accel * dt);
    this.speed = Math.hypot(this.vel.x, this.vel.z);

    if (move.lengthSq() > 0.001) {
      const want = Math.atan2(move.x, move.z);
      let diff = want - this.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.heading += diff * Math.min(1, 12 * dt);
    }

    if (input.hit('jump') && this.grounded) {
      this.vy = PLAYER.jump;
      this.grounded = false;
    }
    this.vy -= PLAYER.gravity * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    world.resolveCircle(this.pos, PLAYER.radius);
    this.clamp();

    this.root.position.set(this.pos.x, this.y, this.pos.z);
    this.root.rotation.y = this.heading;
    this.animate(dt, targetSpeed);
  }

  clamp() {
    const edge = CITY.bound - 6;
    this.pos.x = Math.max(-edge, Math.min(edge, this.pos.x));
    this.pos.z = Math.max(-edge, Math.min(edge, this.pos.z));
  }

  animate(dt, targetSpeed) {
    const moving = this.speed > 0.35 && this.grounded;
    this.phase += dt * (3.4 + this.speed * 1.5);
    const swing = moving ? Math.sin(this.phase) * Math.min(1, this.speed / 6) : 0;
    this.legL.rotation.x = swing * 0.9;
    this.legR.rotation.x = -swing * 0.9;
    this.armL.rotation.x = -swing * 0.75;
    this.armR.rotation.x = swing * 0.5 - (this.weapon === 'pistol' ? 1.35 : 0);
    this.body.rotation.z = moving ? Math.sin(this.phase * 2) * 0.02 : 0;
    this.body.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.04 : 0;
    if (this.punchTimer > 0) {
      this.armR.rotation.x = -1.9 + (1 - this.punchTimer / 0.32) * 1.1;
    }
    if (!this.grounded) {
      this.legL.rotation.x = 0.5;
      this.legR.rotation.x = -0.3;
    }
    this.pistol.visible = this.weapon === 'pistol';
  }

  hide() {
    this.root.visible = false;
  }

  show() {
    this.root.visible = true;
    this.root.position.set(this.pos.x, this.y, this.pos.z);
    this.root.rotation.y = this.heading;
  }

  // Called when the player leaves a car: the figure reappears beside it.
  placeAt(x, z, heading) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.y = 0;
    this.vy = 0;
    this.heading = heading;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = heading;
  }
}

const WEAPON_MAG = 12;

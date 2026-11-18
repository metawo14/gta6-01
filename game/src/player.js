// Port Meridian — the player on foot.
// A low-poly articulated figure built from boxes: jacket torso, hips, head with hair, a bright
// red scarf so the figure reads at distance, arms and legs as pivoted groups, shoes, and a
// pistol in the right hand that only shows when the pistol is the active weapon.

import * as THREE from 'three';
import { PLAYER, WEAPONS } from './config.js';
import { clamp, damp } from './random.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);

function part(mat, w, h, d, x, y, z, parent) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.x = 96;
    this.z = -196;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.angle = Math.PI;
    this.health = PLAYER.health;
    this.maxHealth = PLAYER.health;
    this.weapon = 'pistol';
    this.magazine = WEAPONS.pistol.magazine;
    this.reserve = WEAPONS.pistol.reserve;
    this.reloading = 0;
    this.fireCooldown = 0;
    this.walkPhase = 0;
    this.punchTimer = 0;
    this.aiming = false;
    this.hidden = false;
    this.moveSpeed = 0;
    this.mesh = this._build();
    this.mesh.position.set(this.x, 0, this.z);
    scene.add(this.mesh);
    // The tracer spans world space, so it lives at the scene root, not under the figure.
    scene.add(this.tracer);
  }

  _build() {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    this.body = body;

    const jacket = new THREE.MeshStandardMaterial({ color: 0x1f2b3e, roughness: 0.78, metalness: 0.08 });
    const jeans = new THREE.MeshStandardMaterial({ color: 0x2b3246, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc98d62, roughness: 0.78 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.95 });
    const scarf = new THREE.MeshStandardMaterial({
      color: 0xd8202e, roughness: 0.65, emissive: 0x5a0a10, emissiveIntensity: 0.5,
    });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x131318, roughness: 0.8 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.45, metalness: 0.7 });

    // Hips
    const hips = new THREE.Group();
    hips.position.y = 0.92;
    body.add(hips);
    part(jeans, 0.44, 0.26, 0.28, 0, 0, 0, hips);

    // Torso
    const torso = new THREE.Group();
    torso.position.y = 1.16;
    body.add(torso);
    part(jacket, 0.52, 0.62, 0.32, 0, 0.28, 0, torso);
    // A jacket hem that breaks the silhouette.
    part(jacket, 0.56, 0.14, 0.34, 0, 0.02, 0, torso);
    // Scarf, bright red, at the collar.
    const scarfMesh = part(scarf, 0.42, 0.14, 0.3, 0, 0.6, 0.02, torso);
    part(scarf, 0.16, 0.5, 0.1, 0.1, 0.38, 0.17, torso);

    // Neck and head
    const head = new THREE.Group();
    head.position.y = 1.66;
    body.add(head);
    part(skin, 0.12, 0.1, 0.12, 0, -0.06, 0, head);
    part(skin, 0.3, 0.32, 0.29, 0, 0.1, 0, head);
    part(hair, 0.33, 0.14, 0.32, 0, 0.26, -0.01, head);
    part(hair, 0.08, 0.16, 0.26, 0, 0.16, -0.12, head);
    this.head = head;

    // Arms as pivoted groups, hanging from the shoulders.
    const armL = new THREE.Group();
    armL.position.set(-0.34, 1.48, 0);
    body.add(armL);
    part(jacket, 0.16, 0.5, 0.19, 0, -0.24, 0, armL);
    const handL = part(skin, 0.14, 0.15, 0.16, 0, -0.53, 0, armL);

    const armR = new THREE.Group();
    armR.position.set(0.34, 1.48, 0);
    body.add(armR);
    part(jacket, 0.16, 0.5, 0.19, 0, -0.24, 0, armR);
    const handR = part(skin, 0.14, 0.15, 0.16, 0, -0.53, 0, armR);
    this.armL = armL;
    this.armR = armR;

    // Pistol in the right hand, hidden until the pistol is out.
    const gun = new THREE.Group();
    gun.position.set(0, -0.58, -0.06);
    part(gunMat, 0.07, 0.08, 0.34, 0, 0, -0.06, gun);
    part(gunMat, 0.06, 0.18, 0.09, 0, -0.09, 0.02, gun);
    armR.add(gun);
    this.gun = gun;

    // Legs as pivoted groups.
    const legL = new THREE.Group();
    legL.position.set(-0.13, 0.92, 0);
    body.add(legL);
    part(jeans, 0.19, 0.46, 0.22, 0, -0.24, 0, legL);
    part(jeans, 0.17, 0.42, 0.2, 0, -0.66, 0, legL);
    part(shoe, 0.19, 0.11, 0.32, 0, -0.9, -0.05, legL);

    const legR = new THREE.Group();
    legR.position.set(0.13, 0.92, 0);
    body.add(legR);
    part(jeans, 0.19, 0.46, 0.22, 0, -0.24, 0, legR);
    part(jeans, 0.17, 0.42, 0.2, 0, -0.66, 0, legR);
    part(shoe, 0.19, 0.11, 0.32, 0, -0.9, -0.05, legR);
    this.legL = legL;
    this.legR = legR;

    // Muzzle flash and tracer bits, hidden until a shot.
    this.muzzle = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.muzzle.visible = false;
    armR.add(this.muzzle);
    this.muzzle.position.set(0, -0.58, -0.28);

    this.muzzleLight = new THREE.PointLight(0xffcf80, 0, 9);
    this.muzzleLight.position.set(0, 1.4, -0.4);
    body.add(this.muzzleLight);

    this.tracer = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1, 4),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
    );
    this.tracer.visible = false;
    this.tracerLife = 0;

    // A soft ground shadow so the figure sits in the scene.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 1.4),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    root.add(shadow);

    return root;
  }

  setWeapon(name) {
    this.weapon = name;
    this.gun.visible = name === 'pistol' && !this.hidden;
    this.reloading = 0;
  }

  reload() {
    if (this.weapon !== 'pistol') return false;
    if (this.reserve <= 0 || this.magazine >= WEAPONS.pistol.magazine || this.reloading > 0) return false;
    this.reloading = WEAPONS.pistol.reloadTime;
    return true;
  }

  canFire() {
    return this.weapon === 'pistol' && this.magazine > 0 && this.fireCooldown <= 0 && this.reloading <= 0;
  }

  spendRound() {
    this.magazine = Math.max(0, this.magazine - 1);
    this.fireCooldown = 60 / WEAPONS.pistol.rpm;
  }

  addAmmo(n) {
    this.reserve = Math.min(200, this.reserve + n);
  }

  flashMuzzle(target) {
    this.muzzle.visible = true;
    this.muzzleLight.intensity = 3.2;
    this.muzzleTimer = 0.055;
    this.tracerLife = 0.06;
    this.tracer.visible = true;
    if (target) {
      const from = new THREE.Vector3(this.x, 1.35, this.z);
      const to = new THREE.Vector3(target.x, target.y ?? 1.2, target.z);
      const dir = to.clone().sub(from);
      const len = dir.length();
      this.tracer.position.copy(from.clone().add(to).multiplyScalar(0.5));
      this.tracer.scale.set(1, len, 1);
      this.tracer.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    } else {
      this.tracer.visible = false;
    }
  }

  punch() {
    if (this.punchTimer > 0) return false;
    this.punchTimer = 0.42;
    return true;
  }

  reset(x, z) {
    this.x = x;
    this.z = z;
    this.y = 0;
    this.vy = 0;
    this.health = this.maxHealth;
    this.magazine = WEAPONS.pistol.magazine;
    this.reserve = WEAPONS.pistol.reserve;
    this.reloading = 0;
    this.angle = Math.PI;
    this.hidden = false;
    this.mesh.visible = true;
    this.mesh.position.set(x, 0, z);
    this.gun.visible = this.weapon === 'pistol';
  }

  // The on-foot step. `camYaw` makes movement camera-relative.
  update(dt, input, city, cameraYaw) {
    if (this.punchTimer > 0) this.punchTimer = Math.max(0, this.punchTimer - dt);
    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) {
        this.muzzle.visible = false;
        this.muzzleLight.intensity = 0;
      }
    }
    if (this.muzzleLight.intensity > 0) this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 60);
    if (this.tracerLife > 0) {
      this.tracerLife -= dt;
      if (this.tracerLife <= 0) this.tracer.visible = false;
    }
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = WEAPONS.pistol.magazine - this.magazine;
        const take = Math.min(need, this.reserve);
        this.magazine += take;
        this.reserve -= take;
        this.reloading = 0;
      }
    }

    if (this.hidden) return;

    const axis = input.axis();
    const sprint = input.held('ShiftLeft') || input.held('ShiftRight');
    const speed = sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    // Camera-relative movement: rotate the input vector by the camera's yaw.
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    let mx = axis.x * cos + axis.z * sin;
    let mz = -axis.x * sin + axis.z * cos;
    const mag = Math.hypot(mx, mz);
    if (mag > 0.001) {
      mx /= mag;
      mz /= mag;
      this.moveSpeed = speed;
      // Turn the figure toward its motion.
      const targetAngle = Math.atan2(-mx, -mz);
      let diff = targetAngle - this.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.angle += diff * Math.min(1, dt * 12);
    } else {
      this.moveSpeed = 0;
    }

    const step = (mag > 0.001 ? speed : 0) * dt;
    if (step > 0) {
      const next = { x: this.x + mx * step, z: this.z + mz * step };
      city.resolveCircle(next, PLAYER.radius, { x: this.x, z: this.z });
      this.x = next.x;
      this.z = next.z;
    }

    // Jump and gravity.
    if (this.grounded && input.pressed('Space')) {
      this.vy = PLAYER.jumpSpeed;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= PLAYER.gravity * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
      }
    }

    // Walk cycle.
    if (this.moveSpeed > 0 && this.grounded) {
      this.walkPhase += dt * (sprint ? 13 : 9);
      const swing = Math.sin(this.walkPhase) * (sprint ? 0.72 : 0.5);
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing * 0.8;
      if (!this.aiming) this.armR.rotation.x = swing * 0.8;
      this.body.position.y = Math.abs(Math.sin(this.walkPhase * 2)) * 0.045;
    } else {
      this.walkPhase = 0;
      this.legL.rotation.x = damp(this.legL.rotation.x, 0, 10, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, 0, 10, dt);
      this.armL.rotation.x = damp(this.armL.rotation.x, 0, 10, dt);
      if (!this.aiming) this.armR.rotation.x = damp(this.armR.rotation.x, 0, 10, dt);
      this.body.position.y = damp(this.body.position.y, 0, 10, dt);
    }

    // Aim pose: the right arm comes up when the pistol is out and the mouse is held.
    this.aiming = this.weapon === 'pistol' && (input.fireHeld() || this.reloading > 0);
    const armTarget = this.aiming ? -1.45 : 0;
    this.armR.rotation.x = damp(this.armR.rotation.x, armTarget, 12, dt);
    if (this.aiming) this.armR.rotation.z = damp(this.armR.rotation.z, -0.12, 12, dt);
    else this.armR.rotation.z = damp(this.armR.rotation.z, 0, 12, dt);

    // Punch animation.
    if (this.punchTimer > 0) {
      const t = 1 - this.punchTimer / 0.42;
      const swing = Math.sin(t * Math.PI) * 1.5;
      this.armR.rotation.x = -swing;
      this.body.rotation.y = Math.sin(t * Math.PI) * 0.25 * (this.weapon === 'fists' ? 1 : 0);
    } else {
      this.body.rotation.y = damp(this.body.rotation.y, 0, 12, dt);
    }

    this.gun.visible = this.weapon === 'pistol';
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = this.angle;
  }

  // While driving the figure hides and follows the car.
  followCar(car) {
    this.hidden = true;
    this.mesh.visible = false;
    this.tracer.visible = false;
    this.x = car.x;
    this.z = car.z;
  }

  showAt(x, z, angle) {
    this.hidden = false;
    this.mesh.visible = true;
    this.x = x;
    this.z = z;
    this.y = 0;
    this.angle = angle;
    this.mesh.position.set(x, 0, z);
    this.mesh.rotation.y = angle;
    this.gun.visible = this.weapon === 'pistol';
  }
}

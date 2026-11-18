// The player on foot: an articulated low-poly figure with a walk cycle, a jump,
// a punch and an aim pose, plus the pistol with its magazine and reload.

import * as THREE from 'three';
import { PLAYER, WEAPONS, COLORS } from './config.js';
import { clamp, damp, wrapAngle } from './random.js';

export class Player {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.group = new THREE.Group();
    this.group.rotation.order = 'YXZ';
    scene.add(this.group);

    this.x = 0;
    this.z = 0;
    this.y = 0;
    this.vy = 0;
    this.heading = 0;
    this.velX = 0;
    this.velZ = 0;
    this.grounded = true;
    this.health = PLAYER.health;
    this.maxHealth = PLAYER.health;
    this.speed = 0;
    this.moveAmount = 0;
    this.walkPhase = 0;
    this.punchT = 0;
    this.aimT = 0;
    this.flashT = 0;
    this.weapon = 'pistol';
    this.mag = WEAPONS.pistol.mag;
    this.reserve = WEAPONS.pistol.reserve;
    this.fireCd = 0;
    this.reloadT = 0;
    this.visible = true;
    this.emote = 0;
    this.build();
  }

  build() {
    const g = this.group;
    const jacket = new THREE.MeshStandardMaterial({ color: 0x2f4a6f, roughness: 0.78 });
    const jacketDark = new THREE.MeshStandardMaterial({ color: 0x22354f, roughness: 0.8 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x24252c, roughness: 0.85 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc99a76, roughness: 0.72 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x2a1d16, roughness: 0.95 });
    const scarf = new THREE.MeshStandardMaterial({
      color: 0xe33232,
      roughness: 0.7,
      emissive: 0x3a0808,
      emissiveIntensity: 0.6,
    });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x131418, roughness: 0.9 });
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.45, metalness: 0.7 });
    this.mats = { jacket, jacketDark, trousers, skin, hair, scarf, shoe, gunMat };

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.78, 0.36), jacket);
    torso.position.y = 1.12;
    g.add(torso);
    this.torso = torso;

    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.2, 0.38), jacketDark);
    collar.position.y = 1.5;
    g.add(collar);

    const scarfMesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.4), scarf);
    scarfMesh.position.y = 1.56;
    g.add(scarfMesh);
    const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.1), scarf);
    scarfTail.position.set(0.16, 1.3, -0.22);
    scarfTail.rotation.x = 0.22;
    g.add(scarfTail);
    this.scarfTail = scarfTail;

    const hips = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.34), trousers);
    hips.position.y = 0.64;
    g.add(hips);

    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), skin);
    neck.position.y = 1.64;
    g.add(neck);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.34), skin);
    head.position.y = 1.82;
    g.add(head);
    this.head = head;
    const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.16, 0.36), hair);
    hairMesh.position.y = 2.0;
    g.add(hairMesh);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.1), hair);
    back.position.set(0, 1.86, -0.17);
    g.add(back);
    // a dark band across the eyes so the face reads at a distance
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(0.31, 0.07, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.5 }),
    );
    band.position.set(0, 1.86, 0.18);
    g.add(band);

    // arms as pivoted groups, shoulder at the top
    const mkArm = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.4, 1.44, 0);
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.4, 0.2), jacket);
      upper.position.y = -0.2;
      pivot.add(upper);
      const fore = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.36, 0.18), jacketDark);
      fore.position.y = -0.56;
      pivot.add(fore);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), skin);
      hand.position.y = -0.8;
      pivot.add(hand);
      pivot.rotation.order = 'XZY';
      g.add(pivot);
      return { pivot, hand };
    };
    this.armR = mkArm(-1);
    this.armL = mkArm(1);

    // the pistol, only visible with the pistol active
    this.gunGroup = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.34), gunMat);
    barrel.position.set(0, -0.82, 0.2);
    this.gunGroup.add(barrel);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), gunMat);
    grip.position.set(0, -0.9, 0.06);
    grip.rotation.x = 0.24;
    this.gunGroup.add(grip);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, -0.82, 0.4);
    this.gunGroup.add(this.muzzle);
    this.armR.pivot.add(this.gunGroup);

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: muzzleTex(),
        color: 0xffe6a0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this.flash.scale.setScalar(1.3);
    this.muzzle.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffd090, 0, 14, 2);
    this.muzzle.add(this.flashLight);

    // legs
    const mkLeg = (side) => {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.16, 0.62, 0);
      const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.42, 0.24), trousers);
      thigh.position.y = -0.2;
      pivot.add(thigh);
      const shin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.36, 0.22), trousers);
      shin.position.y = -0.58;
      pivot.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.34), shoe);
      foot.position.set(0, -0.79, 0.06);
      pivot.add(foot);
      pivot.rotation.order = 'XZY';
      g.add(pivot);
      return pivot;
    };
    this.legR = mkLeg(-1);
    this.legL = mkLeg(1);

    this.gunGroup.visible = this.weapon === 'pistol';
  }

  get isArmed() {
    return this.weapon === 'pistol';
  }

  armPose() {
    // right arm aims forward when the pistol is out
    const aim = this.weapon === 'pistol' ? 1 : 0;
    return aim;
  }

  switchWeapon(name) {
    if (name !== 'pistol' && name !== 'fists') return false;
    if (this.weapon === name) return false;
    if (name === 'pistol' && this.mag + this.reserve <= 0) return false;
    this.weapon = name;
    this.gunGroup.visible = name === 'pistol';
    this.reloadT = 0;
    return true;
  }

  startReload() {
    const w = WEAPONS[this.weapon];
    if (this.weapon !== 'pistol') return false;
    if (this.reloadT > 0) return false;
    if (this.mag >= w.mag || this.reserve <= 0) return false;
    this.reloadT = w.reload;
    if (this.audio) this.audio.reloadClick();
    return true;
  }

  canFire() {
    const w = WEAPONS[this.weapon];
    if (this.fireCd > 0 || this.reloadT > 0) return false;
    if (this.weapon === 'fists') return true;
    return this.mag > 0;
  }

  consumeShot() {
    const w = WEAPONS[this.weapon];
    this.fireCd = 60 / w.rpm;
    if (this.weapon === 'pistol') {
      this.mag = Math.max(0, this.mag - 1);
      this.flashT = 0.06;
      if (this.audio) this.audio.gunshot();
    }
    return true;
  }

  punch() {
    if (this.punchT > 0) return false;
    if (this.weapon !== 'fists') {
      // a quick jab even with the pistol out
      this.punchT = 0.3;
      return true;
    }
    this.punchT = 0.34;
    if (this.audio) this.audio.punch();
    return true;
  }

  step(dt, input, cameraYaw, allowMove = true) {
    const w = WEAPONS[this.weapon];
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.punchT = Math.max(0, this.punchT - dt);
    this.flashT = Math.max(0, this.flashT - dt);

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = w.mag - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take;
        this.reserve -= take;
        this.reloadT = 0;
      }
    }

    const ax = allowMove ? input.axis() : { x: 0, y: 0 };
    const sprint = input.isHeld('sprint') && this.grounded;
    const base = sprint ? PLAYER.sprint : PLAYER.walk;
    // camera-relative motion: forward is the camera's look axis, strafe is its right
    const cos = Math.cos(cameraYaw);
    const sin = Math.sin(cameraYaw);
    let mx = sin * ax.y - cos * ax.x;
    let mz = cos * ax.y + sin * ax.x;
    const mag = Math.hypot(mx, mz);
    if (mag > 0.001) {
      mx /= mag;
      mz /= mag;
    }
    const target = mag > 0.001 ? base : 0;
    this.speed = damp(this.speed, target, 12, dt);
    this.moveAmount = damp(this.moveAmount, mag, 10, dt);

    if (mag > 0.001) {
      // turn the figure toward its motion
      const want = Math.atan2(mx, mz);
      this.heading = wrapAngle(this.heading + wrapAngle(want - this.heading) * Math.min(1, 12 * dt));
    } else if (this.weapon === 'pistol') {
      // face where the camera looks while aiming
      this.heading = wrapAngle(this.heading + wrapAngle(cameraYaw - this.heading) * Math.min(1, 7 * dt));
    }

    this.velX = mx * this.speed;
    this.velZ = mz * this.speed;

    if (this.grounded && input.justPressed('jump')) {
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

    this.x += this.velX * dt;
    this.z += this.velZ * dt;
    const resolved = this.world.resolveCircle(this.x, this.z, PLAYER.radius);
    this.x = resolved.x;
    this.z = resolved.z;

    this.animate(dt);
  }

  animate(dt) {
    const sw = this.speed / PLAYER.sprint;
    this.walkPhase += dt * (2.4 + sw * 8.4);
    const swing = Math.sin(this.walkPhase) * (0.16 + sw * 0.72);
    const swingB = Math.sin(this.walkPhase + Math.PI) * (0.16 + sw * 0.72);
    const moving = this.moveAmount > 0.04;

    this.legR.rotation.x = moving ? swing : damp(this.legR.rotation.x, 0, 8, dt);
    this.legL.rotation.x = moving ? swingB : damp(this.legL.rotation.x, 0, 8, dt);

    const aim = this.weapon === 'pistol' ? 1 : 0;
    this.aimT = damp(this.aimT, aim, 9, dt);

    // punch overrides the right arm
    const punch = this.punchT > 0 ? Math.sin((1 - this.punchT / 0.34) * Math.PI) : 0;
    const armSwingR = moving ? swingB * 0.9 : 0;
    const aimPose = -1.62 + this.aimT * 0.05;
    const rightArmX = this.aimT > 0.05 ? aimPose : armSwingR;
    this.armR.pivot.rotation.x = rightArmX - punch * 1.5;
    this.armR.pivot.rotation.z = this.aimT * -0.12;
    this.armL.pivot.rotation.x = moving ? swing * 0.9 : 0;
    this.armL.pivot.rotation.z = this.aimT * 0.2;

    // lean into a sprint, bob on the stride
    const lean = clamp(sw, 0, 1) * 0.14;
    this.group.rotation.x = damp(this.group.rotation.x, lean, 6, dt);
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.045 * (0.4 + sw) : 0;
    if (!this.grounded) {
      this.legR.rotation.x = -0.4;
      this.legL.rotation.x = 0.24;
    }
    this.group.position.set(this.x, this.y + bob, this.z);
    this.group.rotation.y = this.heading;

    // scarf tail flaps with speed
    this.scarfTail.rotation.x = 0.22 + Math.sin(this.walkPhase * 0.5) * 0.12 - sw * 0.35;

    // muzzle flash
    if (this.flashT > 0) {
      this.flash.material.opacity = 1;
      this.flash.scale.setScalar(1.1 + Math.random() * 0.7);
      this.flashLight.intensity = 6;
    } else {
      this.flash.material.opacity = 0;
      this.flashLight.intensity = 0;
    }
  }

  aimDirection(cameraYaw, cameraPitch) {
    // a generous aim cone: forward from the camera, mostly level
    const pitch = clamp(cameraPitch * 0.5, -0.35, 0.35);
    const dx = Math.sin(cameraYaw) * Math.cos(pitch);
    const dz = Math.cos(cameraYaw) * Math.cos(pitch);
    const dy = Math.sin(-pitch);
    return { x: dx, y: dy, z: dz };
  }

  muzzleWorld() {
    const p = new THREE.Vector3();
    this.muzzle.getWorldPosition(p);
    // direction along the barrel
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion);
    return { pos: p, dir: fwd };
  }

  teleport(x, z, heading) {
    this.x = x;
    this.z = z;
    this.y = 0;
    this.vy = 0;
    this.speed = 0;
    this.velX = 0;
    this.velZ = 0;
    if (heading !== undefined) this.heading = heading;
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
  }

  hurt(amount) {
    this.health = clamp(this.health - amount, 0, this.maxHealth);
    return this.health <= 0;
  }

  heal(n) {
    this.health = clamp(this.health + n, 0, this.maxHealth);
  }

  setVisible(v) {
    this.visible = v;
    this.group.visible = v;
  }

  get ammoLabel() {
    return `${this.mag} / ${this.reserve}`;
  }

  get weaponLabel() {
    return WEAPONS[this.weapon].name;
  }
}

function muzzleTex() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,235,1)');
  grad.addColorStop(0.35, 'rgba(255,214,120,0.8)');
  grad.addColorStop(1, 'rgba(255,150,50,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

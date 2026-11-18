// PORT MERIDIAN's city: a seeded 12x12 grid of blocks, lit towers, neon along the avenues,
// street lamps with warm pools, a working harbour and a dusk sky.
//
// Everything repeated is collected in a Batch and baked into a single InstancedMesh, so the
// whole town costs a few dozen draw calls. Per-instance tints ride on InstancedMesh.instanceColor
// ONLY: a MeshBasicMaterial with vertexColors:true would multiply by a `color` attribute the
// geometry does not have, which is what turned lit windows into black squares before.
import * as THREE from 'three';
import { CITY, PALETTE, gridLine, cellCentre } from './config.js';
import { Rng } from './random.js';

const UP = new THREE.Vector3(0, 1, 0);
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_QUAD = new THREE.PlaneGeometry(1, 1);
const UNIT_SPHERE = new THREE.SphereGeometry(0.5, 8, 6);
const FACE_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

// A list of transforms (and optional tints) that becomes one InstancedMesh.
class Batch {
  constructor(geometry, material) {
    this.geometry = geometry;
    this.material = material;
    this.rows = [];
  }

  get length() {
    return this.rows.length;
  }

  push(position, quaternion, scale, tint) {
    this.rows.push({ position, quaternion, scale, tint });
  }

  box(x, y, z, w, h, d, tint = null, yaw = 0) {
    this.push(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(UP, yaw),
      new THREE.Vector3(w, h, d),
      tint,
    );
  }

  quad(x, y, z, w, h, tint, yaw = 0) {
    this.push(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, yaw), new THREE.Vector3(w, h, 1), tint);
  }

  baked(parent) {
    if (this.rows.length === 0) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.rows.length);
    mesh.frustumCulled = false;
    const matrix = new THREE.Matrix4();
    const colour = new THREE.Color();
    let tinted = false;
    this.rows.forEach((row, i) => {
      matrix.compose(row.position, row.quaternion, row.scale);
      mesh.setMatrixAt(i, matrix);
      if (row.tint !== null && row.tint !== undefined) {
        colour.setHex(row.tint);
        mesh.setColorAt(i, colour);
        tinted = true;
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    parent.add(mesh);
    this.rows = [];
    return mesh;
  }
}

// Warm and cool window tints, chosen per building so a tower reads as one tenant.
const WARM_WINDOWS = [0xffdf9e, 0xffd07a, 0xffe9bd, 0xf6c96a];
const COOL_WINDOWS = [0xa8dcff, 0x8fc8f2, 0xc4e8ff];

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.rng = new Rng(seed * 7919 + 13);
    this.buildings = [];
    this.props = [];
    this.lamps = [];
    this.beacons = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    this.makeSky();
    this.makeGround();
    this.makeRoads();
    this.makeBlocks();
    this.makeHarbour();
    this.makeStreetLights();
    this.makeRoofLights();
    this.bake();
  }

  // --- sky, light rig -----------------------------------------------------
  makeSky() {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        glow: { value: new THREE.Color(0xffd9a0) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 glow;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float t = clamp(dir.y * 1.75 + 0.18, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(t, 0.82));
          // A band of burnt orange sitting on the horizon, where the sun went down.
          float band = smoothstep(0.30, 0.0, abs(dir.y - 0.04));
          col += glow * band * 0.46;
          col += glow * 0.06 * smoothstep(-0.15, 0.95, dir.y);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), material);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 120, 480);

    this.hemi = new THREE.HemisphereLight(0x9db2dd, 0x5a4436, 1.3);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(PALETTE.sun, 2.8);
    this.sun.position.set(-150, 74, 180);
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0x5a7fd0, 0.6);
    this.rim.position.set(120, 40, -160);
    this.scene.add(this.rim);

    this.ambient = new THREE.AmbientLight(0x5b6288, 1.2);
    this.scene.add(this.ambient);
  }

  makeGround() {
    const side = CITY.bound * 2 + 300;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(side, side),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    this.group.add(ground);
  }

  // --- roads --------------------------------------------------------------
  makeRoads() {
    this.asphaltBatch = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.8, metalness: 0.1 }));
    this.markBatch = new Batch(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: PALETTE.line, transparent: true, opacity: 0.55 }));
    this.walkBatch = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 0.92 }));

    const span = CITY.bound * 2 + CITY.roadWidth;
    for (let i = 0; i <= CITY.grid; i++) {
      const c = gridLine(i);
      this.asphaltBatch.box(0, 0.01, c, span, 0.06, CITY.roadWidth);
      this.asphaltBatch.box(c, 0.012, 0, CITY.roadWidth, 0.06, span);
    }

    // Dashed centre lines and the zebra crossings at every junction.
    for (let i = 0; i <= CITY.grid; i++) {
      const c = gridLine(i);
      for (let seg = 0; seg < CITY.grid; seg++) {
        const mid = (gridLine(seg) + gridLine(seg + 1)) / 2;
        for (let d = -18; d <= 18; d += 9) {
          this.markBatch.push(new THREE.Vector3(mid + d, 0.05, c), FACE_UP, new THREE.Vector3(4.6, 0.32, 1));
          this.markBatch.push(new THREE.Vector3(c, 0.05, mid + d), FACE_UP, new THREE.Vector3(0.32, 4.6, 1));
        }
      }
    }
    for (let i = 0; i <= CITY.grid; i++) {
      for (let j = 0; j <= CITY.grid; j++) {
        const x = gridLine(i);
        const z = gridLine(j);
        for (const s of [-1, 1]) {
          for (let k = -2; k <= 2; k++) {
            this.markBatch.push(
              new THREE.Vector3(x + s * (CITY.roadWidth / 2 + 2.6) + k * 1.5, 0.052, z),
              FACE_UP,
              new THREE.Vector3(0.7, CITY.roadWidth * 0.8, 1),
            );
            this.markBatch.push(
              new THREE.Vector3(x, 0.052, z + s * (CITY.roadWidth / 2 + 2.6) + k * 1.5),
              FACE_UP,
              new THREE.Vector3(CITY.roadWidth * 0.8, 0.7, 1),
            );
          }
        }
      }
    }
  }

  // --- blocks, towers, shopfronts ----------------------------------------
  makeBlocks() {
    this.bodyBatch = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.16 }));
    this.baseBatch = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: 0x2a2c38, roughness: 0.95 }));
    this.roofBatch = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: 0x2b2e3a, roughness: 0.92 }));
    // Lit windows: flat quads tinted per instance, no vertexColors (see the file header).
    this.windowBatch = new Batch(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.96 }));
    // A soft additive bloom behind each lit window so it reads at a distance.
    this.windowGlowBatch = new Batch(UNIT_QUAD, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.2,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    // Neon: solid sign face plus a wide additive halo.
    this.neonBatch = new Batch(UNIT_QUAD, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }));
    this.neonHaloBatch = new Batch(UNIT_QUAD, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    // Ground-floor shop glow strips along the showcase avenue.
    this.shopBatch = new Batch(UNIT_QUAD, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.propBatch = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }));

    for (let bx = 0; bx < CITY.grid; bx++) {
      for (let bz = 0; bz < CITY.grid; bz++) {
        const cx = cellCentre(bx);
        const cz = cellCentre(bz);
        const half = CITY.pitch / 2 - CITY.roadWidth / 2;
        this.walkBatch.box(cx, 0.12, cz, half * 2, 0.26, half * 2);

        const inner = half - CITY.sidewalk;
        const towers = this.rng.int(1, 3);
        for (let n = 0; n < towers; n++) {
          const split = towers > 1 ? 1.36 : 1;
          const w = this.rng.range(inner * 0.6, inner * 1.15) / split;
          const d = this.rng.range(inner * 0.6, inner * 1.15) / split;
          const ox = towers === 1 ? 0 : this.rng.range(-inner + w, inner - w);
          const oz = towers === 1 ? 0 : this.rng.range(-inner + d, inner - d);
          const px = cx + ox * 0.62;
          const pz = cz + oz * 0.62;
          const downtown = Math.max(0, 1 - Math.hypot(px, pz) / 210);
          const h = this.rng.range(9, 21) + downtown * this.rng.range(20, 82);
          this.addTower(px, pz, w, d, h);
        }

        this.addPavementProps(cx, cz, inner);
        this.addNeon(cx, cz, half);
        this.addShopfront(cx, cz, half, inner);
      }
    }
  }

  addTower(px, pz, w, d, h) {
    const tint = this.rng.pick(PALETTE.buildingTints);
    this.bodyBatch.box(px, h / 2 + 0.26, pz, w, h, d, tint);
    this.baseBatch.box(px, 0.9, pz, w + 0.5, 1.4, d + 0.5);

    // Window grid: how many panes are lit varies per tower so the city is not uniformly bright.
    const rows = Math.max(1, Math.floor((h - 3) / 4.0));
    const colsX = Math.max(2, Math.floor(w / 3.0));
    const colsZ = Math.max(2, Math.floor(d / 3.0));
    const litRatio = 0.42 + this.rng.next() * 0.46;
    const palette = this.rng.chance(0.72) ? WARM_WINDOWS : COOL_WINDOWS;
    const tintA = this.rng.pick(palette);
    const tintB = this.rng.pick(palette);
    const paneW = 1.55;
    const paneH = 1.95;
    const q = new THREE.Quaternion();

    for (const [axis, span] of [['x', w], ['z', d]]) {
      const cols = axis === 'x' ? colsX : colsZ;
      for (let r = 0; r < rows; r++) {
        const y = 2.9 + r * 4.0;
        if (y > h - 1.8) break;
        for (let c = 0; c < cols; c++) {
          if (!this.rng.chance(litRatio)) continue;
          const tint = this.rng.chance(0.82) ? tintA : tintB;
          const at = -span / 2 + 1.8 + c * ((span - 3.6) / Math.max(1, cols - 1));
          for (const side of [-1, 1]) {
            let x;
            let z;
            let nx;
            let nz;
            let yaw;
            if (axis === 'x') {
              x = px + at;
              z = pz + side * (d / 2);
              nx = 0;
              nz = side;
              yaw = side > 0 ? 0 : Math.PI;
            } else {
              x = px + side * (w / 2);
              z = pz + at;
              nx = side;
              nz = 0;
              yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
            }
            q.setFromAxisAngle(UP, yaw);
            // The pane sits just off the wall; its additive halo floats further out again so
            // the light blooms without z-fighting the pane it belongs to.
            this.windowBatch.push(
              new THREE.Vector3(x + nx * 0.07, y, z + nz * 0.07),
              q,
              new THREE.Vector3(paneW, paneH, 1),
              tint,
            );
            this.windowGlowBatch.push(
              new THREE.Vector3(x + nx * 0.16, y, z + nz * 0.16),
              q,
              new THREE.Vector3(paneW * 1.9, paneH * 1.75, 1),
              tint,
            );
          }
        }
      }
    }

    // Roof furniture: plant rooms, aerials, water tanks.
    if (this.rng.chance(0.5)) {
      const capH = this.rng.range(1.8, 4.8);
      this.roofBatch.box(px, h + 0.26 + capH / 2, pz, w * 0.38, capH, d * 0.38);
    }
    if (this.rng.chance(0.36)) {
      this.roofBatch.box(px + w * 0.2, h + 4.4, pz - d * 0.2, 0.16, 8, 0.16);
    }
    if (h > 44 && this.rng.chance(0.55)) {
      const bx = px + this.rng.range(-w * 0.3, w * 0.3);
      const bz = pz + this.rng.range(-d * 0.3, d * 0.3);
      this.beacons.push({ x: bx, y: h + 1.6, z: bz, phase: this.rng.range(0, 6.28) });
    }

    this.buildings.push({
      min: { x: px - w / 2, z: pz - d / 2 },
      max: { x: px + w / 2, z: pz + d / 2 },
      height: h,
    });
  }

  // A neon sign on the corner of the block, facing the street. Signs on the showcase
  // avenues (z = 0 and x = 0, where the screenshots are staged) are bigger and lower.
  addNeon(cx, cz, half) {
    const showcase = Math.abs(cz) < 30 || Math.abs(cx) < 30;
    if (!showcase && !this.rng.chance(0.55)) return;
    const colour = this.rng.pick(PALETTE.neon);
    const w = (showcase ? 5.4 : 3.2) + this.rng.range(0, 3.6);
    const h = (showcase ? 1.5 : 0.95) + this.rng.range(0, 0.9);
    const y = showcase ? this.rng.range(4.4, 11) : this.rng.range(6, 17);
    const onXFace = this.rng.chance(0.5);
    const side = this.rng.sign();
    let x;
    let z;
    let yaw;
    if (onXFace) {
      x = cx + side * (half - 0.55);
      z = cz + this.rng.range(-half * 0.8, half * 0.8);
      yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      x = cx + this.rng.range(-half * 0.8, half * 0.8);
      z = cz + side * (half - 0.55);
      yaw = side > 0 ? 0 : Math.PI;
    }
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    this.neonBatch.push(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, 1), colour);
    // Sign backing board so the tube reads as a lit box, plus a generous halo.
    const nx = Math.sin(yaw);
    const nz = Math.cos(yaw);
    this.neonHaloBatch.push(
      new THREE.Vector3(x + nx * 0.03, y, z + nz * 0.03),
      q,
      new THREE.Vector3(w * 1.55, h * 3.1, 1),
      colour,
    );
    this.neonHaloBatch.push(
      new THREE.Vector3(x + nx * 0.06, y, z + nz * 0.06),
      q,
      new THREE.Vector3(w * 2.2, h * 5.4, 1),
      colour,
    );
  }

  // Shopfront glow at street level facing the road: the low cameras of the shot presets
  // look straight down these faces.
  addShopfront(cx, cz, half, inner) {
    const nearAvenue = Math.abs(cz) < 56 || Math.abs(cx) < 56;
    if (!nearAvenue || !this.rng.chance(0.72)) return;
    const colour = this.rng.pick(PALETTE.neon);
    const w = this.rng.range(6, 14);
    const h = this.rng.range(1.5, 2.6);
    const side = this.rng.sign();
    const yaw = side > 0 ? 0 : Math.PI;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const x = cx + this.rng.range(-inner * 0.5, inner * 0.5);
    const z = cz + side * (half - 2.2);
    this.shopBatch.push(new THREE.Vector3(x, h / 2 + 1.1, z), q, new THREE.Vector3(w, h, 1), colour);
  }

  addPavementProps(cx, cz, inner) {
    const rng = this.rng;
    for (let i = 0; i < rng.int(2, 5); i++) {
      const x = cx + rng.range(-inner, inner);
      const z = cz + rng.range(-inner, inner);
      const kind = rng.pick(['hydrant', 'crate', 'barrier']);
      let w = 0.42;
      let h = 0.7;
      let d = 0.42;
      let tint = 0xc2413a;
      let r = 0.6;
      if (kind === 'crate') {
        w = 1.2; h = 1.2; d = 1.2; tint = 0x6b5433; r = 0.8;
      } else if (kind === 'barrier') {
        w = 2.2; h = 0.85; d = 0.42; tint = 0xd9a331; r = 1.1;
      }
      this.propBatch.box(x, h / 2 + 0.24, z, w, h, d, tint);
      this.props.push({ x, z, r, kind, mesh: null });
    }
  }

  // --- street furniture ---------------------------------------------------
  makeStreetLights() {
    this.poleBatch = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.7, metalness: 0.4 }));
    this.lampBatch = new Batch(UNIT_BOX, new THREE.MeshBasicMaterial({ color: 0xffe3b4 }));
    this.lampGlowBatch = new Batch(UNIT_SPHERE, new THREE.MeshBasicMaterial({
      color: 0xffd39a, transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.poolBatch = new Batch(new THREE.CircleGeometry(0.5, 20), new THREE.MeshBasicMaterial({
      color: 0xffc98a, transparent: true, opacity: 0.26,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));

    for (let i = 0; i <= CITY.grid; i++) {
      for (let j = 0; j <= CITY.grid; j++) {
        if ((i + j) % 2) continue;
        const x = gridLine(i) + CITY.roadWidth / 2 + 1.4;
        const z = gridLine(j) + CITY.roadWidth / 2 + 1.4;
        this.poleBatch.box(x, 3.7, z, 0.18, 7.4, 0.18);
        this.lampBatch.box(x, 7.4, z, 0.66, 0.24, 0.66);
        this.lampGlowBatch.push(new THREE.Vector3(x, 7.4, z), new THREE.Quaternion(), new THREE.Vector3(2.4, 2.4, 2.4));
        this.poolBatch.push(new THREE.Vector3(x, 0.09, z), FACE_UP, new THREE.Vector3(17, 17, 1));
        this.lamps.push({ x, y: 7.4, z });
      }
    }
  }

  // Red aircraft-warning lamps on the tallest roofs: a slow pulse, not a strobe.
  makeRoofLights() {
    const material = new THREE.MeshBasicMaterial({
      color: 0xff2b3c, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const glow = new THREE.MeshBasicMaterial({
      color: 0xff3344, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (const beacon of this.beacons) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), material.clone());
      lamp.position.set(beacon.x, beacon.y, beacon.z);
      this.group.add(lamp);
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), glow.clone());
      halo.position.copy(lamp.position);
      this.group.add(halo);
      beacon.lamp = lamp;
      beacon.halo = halo;
    }
  }

  // --- harbour ------------------------------------------------------------
  makeHarbour() {
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(620, CITY.bound * 2 + 260, 20, 20),
      new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.16, metalness: 0.7 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(CITY.waterAt + 310, -0.38, 0);
    this.group.add(this.water);

    const quay = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: 0x3a353c, roughness: 0.9 }));
    quay.box(CITY.waterAt, 0.42, 0, 7, 1.3, CITY.bound * 2 + 140);

    const rail = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: 0x545863, roughness: 0.6, metalness: 0.45 }));
    for (let z = -CITY.bound; z < CITY.bound; z += 6) {
      rail.box(CITY.waterAt - 2.4, 1.5, z, 0.16, 1.1, 0.16);
    }
    rail.box(CITY.waterAt - 2.4, 2.05, 0, 0.12, 0.12, CITY.bound * 2);
    quay.baked(this.group);
    rail.baked(this.group);

    // Container stacks: the harbour's own silhouette against the sky.
    const stack = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.15 }));
    const hues = [0x9a4030, 0x2f6f8f, 0x3e7a4d, 0xb08830, 0x7a5a8a];
    for (let i = 0; i < 34; i++) {
      const w = this.rng.range(6, 12);
      const h = this.rng.range(2.5, 3.2);
      const d = this.rng.range(2.4, 3.4);
      const levels = this.rng.int(1, 3);
      const x = CITY.bound - this.rng.range(22, 74);
      const z = this.rng.range(-CITY.bound + 40, CITY.bound - 40);
      const tint = this.rng.pick(hues);
      for (let s = 0; s < levels; s++) {
        stack.box(x, h / 2 + 0.3 + s * (h + 0.1), z, w, h, d, tint);
      }
      this.buildings.push({
        min: { x: x - w / 2, z: z - d / 2 },
        max: { x: x + w / 2, z: z + d / 2 },
        height: levels * h,
      });
    }
    stack.baked(this.group);

    // Gantry crane and a freighter at the quay.
    const crane = new Batch(UNIT_BOX, new THREE.MeshStandardMaterial({ color: 0xd9a331, roughness: 0.66, metalness: 0.35 }));
    crane.box(CITY.waterAt + 34, 23, -148, 1.6, 46, 1.6);
    crane.box(CITY.waterAt + 17, 45.4, -148, 48, 1.4, 1.4);
    crane.box(CITY.waterAt + 40, 40, -148, 1.2, 11, 1.2);
    crane.box(CITY.waterAt + 40, 34.6, -148, 3.4, 0.5, 3.4);
    crane.box(CITY.waterAt + 58, 2.4, 40, 22, 5.4, 76, 0x243040);
    crane.box(CITY.waterAt + 58, 7.2, 18, 16, 5.2, 15, 0x33465e);
    crane.box(CITY.waterAt + 58, 2.9, 62, 20, 4.2, 22, 0x8a3d33);
    crane.baked(this.group);
  }

  bake() {
    // The meshes are kept so a lighting preset can lift the glow layers without rebuilding.
    this.baked = {
      windows: this.windowBatch.baked(this.group),
      windowGlow: this.windowGlowBatch.baked(this.group),
      neon: this.neonBatch.baked(this.group),
      neonHalo: this.neonHaloBatch.baked(this.group),
      shops: this.shopBatch.baked(this.group),
      pools: this.poolBatch.baked(this.group),
      lampGlow: this.lampGlowBatch.baked(this.group),
    };
    this.asphaltBatch.baked(this.group);
    this.markBatch.baked(this.group);
    this.walkBatch.baked(this.group);
    this.bodyBatch.baked(this.group);
    this.baseBatch.baked(this.group);
    this.roofBatch.baked(this.group);
    this.propBatch.baked(this.group);
    this.poleBatch.baked(this.group);
    this.lampBatch.baked(this.group);
  }

  // --- collision queries --------------------------------------------------
  blocked(x, z, radius) {
    for (const b of this.buildings) {
      if (x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z) return true;
    }
    const edge = CITY.bound - 4;
    if (Math.abs(x) > edge || Math.abs(z) > edge) return true;
    if (x > CITY.waterAt - 3) return true;
    return false;
  }

  propAt(x, z, radius) {
    for (const p of this.props) {
      if (p.r > 0.01 && Math.hypot(p.x - x, p.z - z) < p.r + radius) return p;
    }
    return null;
  }

  resolveCircle(pos, radius) {
    let hit = false;
    for (const b of this.buildings) {
      const nx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
      const nz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      const dx = pos.x - nx;
      const dz = pos.z - nz;
      const dist = Math.hypot(dx, dz);
      if (dist < radius) {
        hit = true;
        if (dist > 1e-4) {
          pos.x = nx + (dx / dist) * radius;
          pos.z = nz + (dz / dist) * radius;
        } else {
          pos.x = b.max.x + radius;
        }
      }
    }
    const edge = CITY.bound - 5;
    pos.x = Math.max(-edge, Math.min(CITY.waterAt - 3.6, pos.x));
    pos.z = Math.max(-edge, Math.min(edge, pos.z));
    return hit;
  }

  randomRoadPoint(rng, near = { x: 0, z: 0 }, spread = 220) {
    for (let i = 0; i < 40; i++) {
      const alongH = rng.chance(0.5);
      const line = gridLine(rng.int(0, CITY.grid));
      const other = (alongH ? near.x : near.z) + rng.range(-spread, spread);
      const p = alongH ? { x: other, z: line } : { x: line, z: other };
      if (Math.abs(p.x) < CITY.bound && Math.abs(p.z) < CITY.bound && !this.blocked(p.x, p.z, 3)) return p;
    }
    return { x: 0, z: 0 };
  }

  // Per-frame ambience: the swell on the water, the sky following the camera, and the slow
  // red pulse of the rooftop warning lamps.
  ramp(dt, camera) {
    this.waveClock = (this.waveClock ?? 0) + dt;
    if (this.water) this.water.position.y = -0.38 + Math.sin(this.waveClock * 0.7) * 0.05;
    if (camera) this.sky.position.set(camera.position.x, 0, camera.position.z);
    for (const beacon of this.beacons) {
      if (!beacon.lamp) continue;
      const t = (this.waveClock + beacon.phase) % 2.6;
      const on = t < 0.9 ? 1 : 0.12;
      beacon.lamp.material.opacity = 0.25 + 0.75 * on;
      beacon.halo.material.opacity = 0.05 + 0.32 * on;
    }
  }
}

// Picks a kerbside parking space on a random street, clear of buildings, facing along it.
export function parkingSpot(rng, world) {
  for (let i = 0; i < 60; i++) {
    const onZ = rng.chance(0.5);
    const line = gridLine(rng.int(0, CITY.grid));
    const along = rng.range(-CITY.bound + 24, CITY.bound - 24);
    const side = rng.sign();
    const offset = side * (CITY.roadWidth / 2 - 1.9);
    const p = onZ ? { x: along, z: line + offset } : { x: line + offset, z: along };
    if (!world.blocked(p.x, p.z, 2.6)) {
      return { ...p, heading: onZ ? (side > 0 ? 0 : Math.PI) : (side > 0 ? -Math.PI / 2 : Math.PI / 2) };
    }
  }
  return { x: 0, z: 0, heading: 0 };
}

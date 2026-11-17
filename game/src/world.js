// The city: roads, kerbs, buildings, street furniture, the harbour and the sky.
// Every repeated object is batched into an InstancedMesh so the whole city draws in a
// few dozen calls; the layout comes from the seed so Port Meridian is the same every load.
import * as THREE from 'three';
import { CITY, PALETTE, gridLine, cellCentre } from './config.js';
import { Rng } from './random.js';

const UP = new THREE.Vector3(0, 1, 0);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const QUAD = new THREE.PlaneGeometry(1, 1);

// Accumulates transforms + colours for one material and bakes them into one InstancedMesh.
class Batch {
  constructor(geometry, material, { shadows = false } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.shadows = shadows;
    this.items = [];
  }

  add(position, quaternion, scale, color = null) {
    this.items.push({ position, quaternion, scale, color });
  }

  box(x, y, z, w, h, d, color = null, yaw = 0) {
    this.add(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(UP, yaw),
      new THREE.Vector3(w, h, d),
      color,
    );
  }

  build(parent) {
    if (this.items.length === 0) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, this.items.length);
    mesh.frustumCulled = false;
    const m = new THREE.Matrix4();
    const colour = new THREE.Color();
    let tinted = false;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      m.compose(it.position, it.quaternion, it.scale);
      mesh.setMatrixAt(i, m);
      if (it.color !== null) {
        colour.setHex(it.color);
        mesh.setColorAt(i, colour);
        tinted = true;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (tinted && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    parent.add(mesh);
    this.items = [];
    return mesh;
  }
}

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.rng = new Rng(seed * 7919 + 13);
    this.buildings = [];     // axis-aligned collision boxes { min:{x,z}, max:{x,z}, height }
    this.props = [];         // knock-over props { x, z, r, kind, mesh }
    this.lamps = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildSky();
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    this.buildHarbour();
    this.buildStreetLights();
    this.bake();
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(PALETTE.skyTop) },
        horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        glow: { value: new THREE.Color(0xffd9a0) },
      },
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top;
        uniform vec3 horizon;
        uniform vec3 glow;
        varying vec3 vPos;
        void main() {
          float h = normalize(vPos).y;
          float t = clamp(h * 1.7 + 0.2, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(t, 0.8));
          float band = smoothstep(0.26, 0.0, abs(h - 0.03));
          col += glow * band * 0.42;
          col += glow * 0.05 * smoothstep(-0.1, 0.9, h);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 110, 470);

    this.scene.add(new THREE.HemisphereLight(0x9db2dd, 0x5a4436, 1.25));
    const sun = new THREE.DirectionalLight(PALETTE.sun, 2.3);
    sun.position.set(-150, 74, 180);
    this.scene.add(sun);
    this.sun = sun;
    const rim = new THREE.DirectionalLight(0x5a7fd0, 0.55);
    rim.position.set(120, 40, -160);
    this.scene.add(rim);
    this.rim = rim;
    this.scene.add(new THREE.AmbientLight(0x51587a, 1.05));
  }

  buildGround() {
    const size = CITY.bound * 2 + 300;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    this.group.add(ground);
  }

  buildRoads() {
    this.asphaltBatch = new Batch(
      BOX,
      new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.82, metalness: 0.08 }),
    );
    this.laneBatch = new Batch(QUAD, new THREE.MeshBasicMaterial({ color: PALETTE.line, transparent: true, opacity: 0.62 }));
    this.walkBatch = new Batch(
      BOX,
      new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 0.92 }),
    );

    const span = CITY.bound * 2 + CITY.roadWidth;
    for (let i = 0; i <= CITY.grid; i++) {
      const c = gridLine(i);
      this.asphaltBatch.box(0, 0.01, c, span, 0.06, CITY.roadWidth);
      this.asphaltBatch.box(c, 0.012, 0, CITY.roadWidth, 0.06, span);
    }

    // Dashed lane markings between the junctions, batched as flat quads.
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    for (let i = 0; i <= CITY.grid; i++) {
      const c = gridLine(i);
      for (let seg = 0; seg < CITY.grid; seg++) {
        const mid = (gridLine(seg) + gridLine(seg + 1)) / 2;
        for (let d = -18; d <= 18; d += 9) {
          this.laneBatch.add(new THREE.Vector3(mid + d, 0.05, c), flat, new THREE.Vector3(4.6, 0.34, 1));
          this.laneBatch.add(new THREE.Vector3(c, 0.05, mid + d), flat, new THREE.Vector3(0.34, 4.6, 1));
        }
      }
    }

    // Pedestrian crossings on every approach.
    for (let i = 0; i <= CITY.grid; i++) {
      for (let j = 0; j <= CITY.grid; j++) {
        const x = gridLine(i);
        const z = gridLine(j);
        for (const s of [-1, 1]) {
          for (let k = -2; k <= 2; k++) {
            this.laneBatch.add(
              new THREE.Vector3(x + s * (CITY.roadWidth / 2 + 2.6) + k * 1.5, 0.052, z),
              flat, new THREE.Vector3(0.7, CITY.roadWidth * 0.82, 1),
            );
            this.laneBatch.add(
              new THREE.Vector3(x, 0.052, z + s * (CITY.roadWidth / 2 + 2.6) + k * 1.5),
              flat, new THREE.Vector3(CITY.roadWidth * 0.82, 0.7, 1),
            );
          }
        }
      }
    }
  }

  buildBlocks() {
    this.bodyBatch = new Batch(
      BOX,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.14 }),
    );
    this.windowBatch = new Batch(QUAD, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
    this.roofBatch = new Batch(
      BOX,
      new THREE.MeshStandardMaterial({ color: 0x2b2e3a, roughness: 0.92 }),
    );
    this.neonBatch = new Batch(QUAD, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 }));
    this.haloBatch = new Batch(QUAD, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.13,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));

    for (let bx = 0; bx < CITY.grid; bx++) {
      for (let bz = 0; bz < CITY.grid; bz++) {
        const cx = cellCentre(bx);
        const cz = cellCentre(bz);
        const half = CITY.pitch / 2 - CITY.roadWidth / 2;
        this.walkBatch.box(cx, 0.12, cz, half * 2, 0.26, half * 2);

        const inner = half - CITY.sidewalk;
        const count = this.rng.int(1, 3);
        for (let n = 0; n < count; n++) {
          const div = count > 1 ? 1.36 : 1;
          const w = this.rng.range(inner * 0.6, inner * 1.15) / div;
          const d = this.rng.range(inner * 0.6, inner * 1.15) / div;
          const ox = count === 1 ? 0 : this.rng.range(-inner + w, inner - w);
          const oz = count === 1 ? 0 : this.rng.range(-inner + d, inner - d);
          const px = cx + ox * 0.62;
          const pz = cz + oz * 0.62;
          const dist = Math.hypot(px, pz);
          const downtown = Math.max(0, 1 - dist / 200);
          const h = this.rng.range(9, 21) + downtown * this.rng.range(18, 76);
          this.addBuilding(px, pz, w, d, h);
        }

        this.addBlockProps(cx, cz, inner);
        if (this.rng.chance(0.6)) this.addNeonSign(cx, cz, half);
      }
    }
  }

  addBuilding(px, pz, w, d, h) {
    const tint = this.rng.pick(PALETTE.buildingTints);
    this.bodyBatch.box(px, h / 2 + 0.26, pz, w, h, d, tint);

    const rows = Math.max(1, Math.floor((h - 3) / 4.0));
    const colsX = Math.max(2, Math.floor(w / 3.0));
    const colsZ = Math.max(2, Math.floor(d / 3.0));
    const litChance = 0.36 + this.rng.next() * 0.4;
    const warm = this.rng.chance(0.78) ? 0xffd98a : 0x9fd8ff;
    const qy = new THREE.Quaternion();
    for (let r = 0; r < rows; r++) {
      const y = 2.8 + r * 4.0;
      if (y > h - 1.6) break;
      for (let c = 0; c < colsX; c++) {
        if (!this.rng.chance(litChance)) continue;
        const x = px - w / 2 + 1.7 + c * ((w - 3.4) / Math.max(1, colsX - 1));
        for (const dir of [-1, 1]) {
          qy.setFromAxisAngle(UP, dir > 0 ? 0 : Math.PI);
          this.windowBatch.add(
            new THREE.Vector3(x, y, pz + dir * (d / 2 + 0.07)),
            qy, new THREE.Vector3(1.4, 1.75, 1), warm,
          );
        }
      }
      for (let c = 0; c < colsZ; c++) {
        if (!this.rng.chance(litChance)) continue;
        const z = pz - d / 2 + 1.7 + c * ((d - 3.4) / Math.max(1, colsZ - 1));
        for (const dir of [-1, 1]) {
          qy.setFromAxisAngle(UP, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
          this.windowBatch.add(
            new THREE.Vector3(px + dir * (w / 2 + 0.07), y, z),
            qy, new THREE.Vector3(1.4, 1.75, 1), warm,
          );
        }
      }
    }

    if (this.rng.chance(0.45)) {
      const capH = this.rng.range(1.8, 4.6);
      this.roofBatch.box(px, h + 0.26 + capH / 2, pz, w * 0.4, capH, d * 0.4);
    }
    if (this.rng.chance(0.3)) {
      // A rooftop mast, common on this coast.
      this.roofBatch.box(px + w * 0.2, h + 4.4, pz - d * 0.2, 0.16, 8, 0.16);
    }

    this.buildings.push({
      min: { x: px - w / 2, z: pz - d / 2 },
      max: { x: px + w / 2, z: pz + d / 2 },
      height: h,
    });
  }

  addNeonSign(cx, cz, half) {
    const colour = this.rng.pick(PALETTE.neon);
    const w = this.rng.range(2.6, 6.4);
    const h = this.rng.range(0.8, 1.6);
    const y = this.rng.range(4.2, 15);
    const onX = this.rng.chance(0.5);
    const q = new THREE.Quaternion();
    let pos;
    let scale;
    if (onX) {
      pos = new THREE.Vector3(cx + this.rng.sign() * (half - 0.6), y, cz + this.rng.range(-half, half));
      q.setFromAxisAngle(UP, Math.PI / 2);
      scale = new THREE.Vector3(w, h, 1);
    } else {
      pos = new THREE.Vector3(cx + this.rng.range(-half, half), y, cz + this.rng.sign() * (half - 0.6));
      scale = new THREE.Vector3(w, h, 1);
    }
    this.neonBatch.add(pos, q, scale, colour);
    const haloScale = new THREE.Vector3(w * 1.9, h * 4.2, 1);
    const haloPos = pos.clone().add(new THREE.Vector3(0, 0, 0.05));
    this.haloBatch.add(haloPos, q, haloScale, colour);
  }

  addBlockProps(cx, cz, inner) {
    const rng = this.rng;
    this.propBatch ??= new Batch(
      BOX,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
    );
    for (let i = 0; i < rng.int(2, 5); i++) {
      const x = cx + rng.range(-inner, inner);
      const z = cz + rng.range(-inner, inner);
      const kind = rng.pick(['hydrant', 'crate', 'barrier']);
      let w = 0.42;
      let h = 0.7;
      let d = 0.42;
      let color = 0xc2413a;
      let r = 0.6;
      if (kind === 'crate') {
        w = 1.2; h = 1.2; d = 1.2; color = 0x6b5433; r = 0.8;
      } else if (kind === 'barrier') {
        w = 2.2; h = 0.85; d = 0.42; color = 0xd9a331; r = 1.1;
      }
      this.propBatch.box(x, h / 2 + 0.24, z, w, h, d, color);
      this.props.push({ x, z, r, kind, mesh: null });
    }
  }

  buildStreetLights() {
    this.poleBatch = new Batch(
      BOX,
      new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.7, metalness: 0.4 }),
    );
    this.lampBatch = new Batch(
      BOX,
      new THREE.MeshBasicMaterial({ color: 0xffdca8 }),
    );
    this.poolBatch = new Batch(new THREE.CircleGeometry(0.5, 18), new THREE.MeshBasicMaterial({
      color: 0xffc98a, transparent: true, opacity: 0.14,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    for (let i = 0; i <= CITY.grid; i++) {
      for (let j = 0; j <= CITY.grid; j++) {
        if ((i + j) % 2) continue;
        const x = gridLine(i) + CITY.roadWidth / 2 + 1.4;
        const z = gridLine(j) + CITY.roadWidth / 2 + 1.4;
        this.poleBatch.box(x, 3.7, z, 0.18, 7.4, 0.18);
        this.lampBatch.box(x, 7.4, z, 0.62, 0.24, 0.62);
        this.poolBatch.add(new THREE.Vector3(x, 0.09, z), flat, new THREE.Vector3(15, 15, 1));
        this.lamps.push({ x, y: 7.4, z });
      }
    }
  }

  buildHarbour() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(620, CITY.bound * 2 + 260, 20, 20),
      new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.16, metalness: 0.72 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(CITY.waterAt + 310, -0.38, 0);
    this.group.add(water);
    this.water = water;

    const quay = new Batch(BOX, new THREE.MeshStandardMaterial({ color: 0x3a353c, roughness: 0.9 }));
    quay.box(CITY.waterAt, 0.42, 0, 7, 1.3, CITY.bound * 2 + 140);
    const rail = new Batch(BOX, new THREE.MeshStandardMaterial({ color: 0x545863, roughness: 0.6, metalness: 0.45 }));
    for (let z = -CITY.bound; z < CITY.bound; z += 6) {
      rail.box(CITY.waterAt - 2.4, 1.5, z, 0.16, 1.1, 0.16);
    }
    rail.box(CITY.waterAt - 2.4, 2.05, 0, 0.12, 0.12, CITY.bound * 2);
    quay.build(this.group);
    rail.build(this.group);

    // Container stacks: the harbour's own silhouette.
    const container = new Batch(
      BOX,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0.15 }),
    );
    const cols = [0x9a4030, 0x2f6f8f, 0x3e7a4d, 0xb08830, 0x7a5a8a];
    for (let i = 0; i < 34; i++) {
      const w = this.rng.range(6, 12);
      const h = this.rng.range(2.5, 3.2);
      const d = this.rng.range(2.4, 3.4);
      const stack = this.rng.int(1, 3);
      const x = CITY.bound - this.rng.range(22, 74);
      const z = this.rng.range(-CITY.bound + 40, CITY.bound - 40);
      const colour = this.rng.pick(cols);
      for (let s = 0; s < stack; s++) {
        container.box(x, h / 2 + 0.3 + s * (h + 0.1), z, w, h, d, colour);
      }
      this.buildings.push({ min: { x: x - w / 2, z: z - d / 2 }, max: { x: x + w / 2, z: z + d / 2 }, height: stack * h });
    }
    container.build(this.group);

    // Gantry crane over the water.
    const crane = new Batch(BOX, new THREE.MeshStandardMaterial({ color: 0xd9a331, roughness: 0.66, metalness: 0.35 }));
    crane.box(CITY.waterAt + 34, 23, -148, 1.6, 46, 1.6);
    crane.box(CITY.waterAt + 17, 45.4, -148, 48, 1.4, 1.4);
    crane.box(CITY.waterAt + 40, 40, -148, 1.2, 11, 1.2);
    crane.box(CITY.waterAt + 40, 34.6, -148, 3.4, 0.5, 3.4);
    // A ship at the quay.
    crane.box(CITY.waterAt + 58, 2.4, 40, 22, 5.4, 76, 0x243040);
    crane.box(CITY.waterAt + 58, 7.2, 18, 16, 5.2, 15, 0x33465e);
    crane.box(CITY.waterAt + 58, 2.9, 62, 20, 4.2, 22, 0x8a3d33);
    crane.build(this.group);
  }

  bake() {
    this.asphaltBatch.build(this.group);
    this.laneBatch.build(this.group);
    this.walkBatch.build(this.group);
    this.bodyBatch.build(this.group);
    this.windowBatch.build(this.group);
    this.roofBatch.build(this.group);
    this.neonBatch.build(this.group);
    this.haloBatch.build(this.group);
    if (this.propBatch) this.propBatch.build(this.group);
    this.poleBatch.build(this.group);
    this.lampBatch.build(this.group);
    this.poolBatch.build(this.group);
  }

  // --- collision queries -------------------------------------------------
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

  ramp(dt, camera) {
    this.waveClock = (this.waveClock ?? 0) + dt;
    if (this.water) this.water.position.y = -0.38 + Math.sin(this.waveClock * 0.7) * 0.05;
    if (camera) this.sky.position.set(camera.position.x, 0, camera.position.z);
  }
}

// A parked car spot beside a kerb, facing along the street.
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

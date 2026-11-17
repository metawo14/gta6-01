// The city: roads, kerbs, buildings, street furniture, the harbour and the sky.
// All geometry is generated from the seed so Port Meridian is the same city every load.
import * as THREE from 'three';
import { CITY, PALETTE, CAR_TYPES, gridLine, cellCentre } from './config.js';
import { Rng } from './random.js';

const UP = new THREE.Vector3(0, 1, 0);

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.rng = new Rng(seed * 7919 + 13);
    this.buildings = [];     // { min:{x,z}, max:{x,z}, height } axis-aligned collision boxes
    this.props = [];         // { x, z, r, kind, mesh }
    this.lamps = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildSky();
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    this.buildHarbour();
    this.buildStreetLights();
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
          float t = clamp(h * 1.6 + 0.18, 0.0, 1.0);
          vec3 col = mix(horizon, top, pow(t, 0.75));
          float band = smoothstep(0.30, 0.0, abs(h - 0.02));
          col += glow * band * 0.45;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(PALETTE.fog, 90, 420);

    const hemi = new THREE.HemisphereLight(0x8899cc, 0x332a28, 0.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(PALETTE.sun, 1.55);
    sun.position.set(-160, 90, 190);
    this.scene.add(sun);
    this.sun = sun;
    const ambient = new THREE.AmbientLight(0x2a3050, 0.6);
    this.scene.add(ambient);
  }

  buildGround() {
    const size = CITY.bound * 2 + 220;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = false;
    this.group.add(ground);
  }

  buildRoads() {
    const asphalt = new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.85, metalness: 0.05 });
    const span = CITY.bound * 2 + CITY.roadWidth;
    const lane = new THREE.MeshStandardMaterial({ color: PALETTE.line, roughness: 0.6 });
    const roads = new THREE.Group();

    for (let i = 0; i <= CITY.grid; i++) {
      const c = gridLine(i);
      const h = new THREE.Mesh(new THREE.BoxGeometry(span, 0.06, CITY.roadWidth), asphalt);
      h.position.set(0, 0.01, c);
      roads.add(h);
      const v = new THREE.Mesh(new THREE.BoxGeometry(CITY.roadWidth, 0.06, span), asphalt);
      v.position.set(c, 0.012, 0);
      roads.add(v);

      for (let seg = 0; seg < CITY.grid; seg++) {
        const mid = (gridLine(seg) + gridLine(seg + 1)) / 2;
        for (let d = -18; d <= 18; d += 9) {
          const dashH = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.02, 0.34), lane);
          dashH.position.set(mid + d, 0.045, c);
          roads.add(dashH);
          const dashV = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 4.6), lane);
          dashV.position.set(c, 0.046, mid + d);
          roads.add(dashV);
        }
      }
    }
    this.group.add(roads);
  }

  buildBlocks() {
    const kerbMat = new THREE.MeshStandardMaterial({ color: PALETTE.sidewalk, roughness: 0.9 });
    const windowMats = new Map();
    this.windowMats = windowMats;

    for (let bx = 0; bx < CITY.grid; bx++) {
      for (let bz = 0; bz < CITY.grid; bz++) {
        const cx = cellCentre(bx);
        const cz = cellCentre(bz);
        const half = CITY.pitch / 2 - CITY.roadWidth / 2;
        const kerb = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.24, half * 2), kerbMat);
        kerb.position.set(cx, 0.12, cz);
        this.group.add(kerb);

        const inner = half - CITY.sidewalk;
        const count = this.rng.int(1, 3);
        for (let n = 0; n < count; n++) {
          const w = this.rng.range(inner * 0.55, inner * 1.1) / (count > 1 ? 1.35 : 1);
          const d = this.rng.range(inner * 0.55, inner * 1.1) / (count > 1 ? 1.35 : 1);
          const ox = count === 1 ? 0 : this.rng.range(-inner + w, inner - w);
          const oz = count === 1 ? 0 : this.rng.range(-inner + d, inner - d);
          const px = cx + ox * 0.6;
          const pz = cz + oz * 0.6;
          const dist = Math.hypot(px, pz);
          const downtown = Math.max(0, 1 - dist / 210);
          const h = this.rng.range(9, 22) + downtown * this.rng.range(20, 74);
          this.addBuilding(px, pz, w, d, h);
        }

        this.addBlockProps(cx, cz, inner);
        if (this.rng.chance(0.55)) this.addNeonSign(cx, cz, half);
      }
    }
  }

  addBuilding(px, pz, w, d, h) {
    const tint = this.rng.pick(PALETTE.buildingTints);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: tint, roughness: 0.82, metalness: 0.12 }),
    );
    body.position.set(px, h / 2 + 0.24, pz);
    this.group.add(body);

    // Emissive window bands: one instanced grid per building keeps the draw calls down.
    const rows = Math.max(1, Math.floor(h / 4.2));
    const colsX = Math.max(2, Math.floor(w / 3.0));
    const colsZ = Math.max(2, Math.floor(d / 3.0));
    const litChance = 0.34 + this.rng.next() * 0.4;
    const geo = new THREE.PlaneGeometry(1.35, 1.7);
    const mat = new THREE.MeshBasicMaterial({
      color: this.rng.chance(0.2) ? 0x9fd8ff : 0xffd98a,
      transparent: true,
      opacity: 0.92,
    });
    const count = rows * (colsX * 2 + colsZ * 2);
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    let k = 0;
    for (let r = 0; r < rows; r++) {
      const y = 2.6 + r * 4.0;
      if (y > h - 1.4) break;
      for (let c = 0; c < colsX; c++) {
        if (!this.rng.chance(litChance)) continue;
        const x = px - w / 2 + 1.6 + c * ((w - 3.2) / Math.max(1, colsX - 1));
        for (const dir of [-1, 1]) {
          q.setFromAxisAngle(UP, dir > 0 ? 0 : Math.PI);
          m.compose(new THREE.Vector3(x, y, pz + dir * (d / 2 + 0.06)), q, s);
          inst.setMatrixAt(k++, m);
        }
      }
      for (let c = 0; c < colsZ; c++) {
        if (!this.rng.chance(litChance)) continue;
        const z = pz - d / 2 + 1.6 + c * ((d - 3.2) / Math.max(1, colsZ - 1));
        for (const dir of [-1, 1]) {
          q.setFromAxisAngle(UP, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
          m.compose(new THREE.Vector3(px + dir * (w / 2 + 0.06), y, z), q, s);
          inst.setMatrixAt(k++, m);
        }
      }
    }
    inst.count = k;
    inst.instanceMatrix.needsUpdate = true;
    this.group.add(inst);

    if (this.rng.chance(0.4)) {
      const cap = new THREE.Mesh(
        new THREE.BoxGeometry(w * 0.42, this.rng.range(2, 5), d * 0.42),
        new THREE.MeshStandardMaterial({ color: 0x2b2e3a, roughness: 0.9 }),
      );
      cap.position.set(px, h + 0.24 + cap.geometry.parameters.height / 2, pz);
      this.group.add(cap);
    }

    this.buildings.push({
      min: { x: px - w / 2, z: pz - d / 2 },
      max: { x: px + w / 2, z: pz + d / 2 },
      height: h,
    });
  }

  addNeonSign(cx, cz, half) {
    const colour = this.rng.pick(PALETTE.neon);
    const w = this.rng.range(2.4, 6);
    const h = this.rng.range(0.8, 1.6);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.9 }),
    );
    const onX = this.rng.chance(0.5);
    if (onX) {
      sign.position.set(cx + this.rng.sign() * (half - 0.4), this.rng.range(4, 14), cz + this.rng.range(-half, half));
      sign.rotation.y = Math.PI / 2;
    } else {
      sign.position.set(cx + this.rng.range(-half, half), this.rng.range(4, 14), cz + this.rng.sign() * (half - 0.4));
    }
    this.group.add(sign);
    const light = new THREE.PointLight(colour, 12, 26, 2);
    light.position.copy(sign.position);
    this.group.add(light);
  }

  addBlockProps(cx, cz, inner) {
    const rng = this.rng;
    const kerbGeo = new THREE.BoxGeometry(0.5, 0.6, 0.5);
    const hydrantMat = new THREE.MeshStandardMaterial({ color: 0xc2413a, roughness: 0.6 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b5433, roughness: 0.9 });
    const barrierMat = new THREE.MeshStandardMaterial({ color: 0xd9a331, roughness: 0.8 });

    for (let i = 0; i < rng.int(2, 5); i++) {
      const x = cx + rng.range(-inner, inner);
      const z = cz + rng.range(-inner, inner);
      const kind = rng.pick(['hydrant', 'crate', 'barrier']);
      let mesh;
      if (kind === 'hydrant') {
        mesh = new THREE.Mesh(kerbGeo, hydrantMat);
        mesh.scale.set(0.6, 1.1, 0.6);
      } else if (kind === 'crate') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), crateMat);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.85, 0.4), barrierMat);
      }
      mesh.position.set(x, kind === 'hydrant' ? 0.55 : 0.65, z);
      this.group.add(mesh);
      this.props.push({ x, z, r: kind === 'barrier' ? 1.1 : 0.7, kind, mesh });
    }
  }

  buildStreetLights() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2d38, roughness: 0.7 });
    const lampGeo = new THREE.SphereGeometry(0.32, 8, 6);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffdca8 });
    this.lampLights = [];
    for (let i = 0; i <= CITY.grid; i++) {
      for (let j = 0; j <= CITY.grid; j++) {
        if ((i + j) % 2) continue;
        const x = gridLine(i) + CITY.roadWidth / 2 + 1.4;
        const z = gridLine(j) + CITY.roadWidth / 2 + 1.4;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7.4, 6), poleMat);
        pole.position.set(x, 3.7, z);
        this.group.add(pole);
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(x, 7.4, z);
        this.group.add(lamp);
        if ((i * 3 + j) % 4 === 0) {
          const light = new THREE.PointLight(0xffc98a, 26, 30, 2);
          light.position.set(x, 6.9, z);
          this.group.add(light);
          this.lamps.push(light);
        }
      }
    }
  }

  buildHarbour() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(600, CITY.bound * 2 + 220, 24, 24),
      new THREE.MeshStandardMaterial({ color: PALETTE.water, roughness: 0.18, metalness: 0.65 }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(CITY.waterAt + 300, -0.35, 0);
    this.group.add(water);
    this.water = water;

    const quayMat = new THREE.MeshStandardMaterial({ color: 0x39343a, roughness: 0.9 });
    const quay = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, CITY.bound * 2 + 120), quayMat);
    quay.position.set(CITY.waterAt, 0.4, 0);
    this.group.add(quay);

    const railMat = new THREE.MeshStandardMaterial({ color: 0x51545f, roughness: 0.6, metalness: 0.4 });
    for (let z = -CITY.bound; z < CITY.bound; z += 6) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16), railMat);
      post.position.set(CITY.waterAt - 2.4, 1.5, z);
      this.group.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, CITY.bound * 2), railMat);
    rail.position.set(CITY.waterAt - 2.4, 2.0, 0);
    this.group.add(rail);

    // Container stacks on the docks: the harbour's own silhouette.
    const cols = [0x9a4030, 0x2f6f8f, 0x3e7a4d, 0xb08830];
    for (let i = 0; i < 26; i++) {
      const w = this.rng.range(6, 12);
      const h = this.rng.range(2.6, 3.2);
      const d = this.rng.range(2.4, 3.2);
      const stack = this.rng.int(1, 3);
      const x = CITY.bound - this.rng.range(24, 70);
      const z = this.rng.range(-CITY.bound + 40, CITY.bound - 40);
      for (let s = 0; s < stack; s++) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshStandardMaterial({ color: this.rng.pick(cols), roughness: 0.85 }),
        );
        box.position.set(x, h / 2 + 0.3 + s * (h + 0.1), z);
        this.group.add(box);
      }
      this.buildings.push({ min: { x: x - w / 2, z: z - d / 2 }, max: { x: x + w / 2, z: z + d / 2 }, height: stack * h });
    }

    // Crane over the water.
    const craneMat = new THREE.MeshStandardMaterial({ color: 0xd9a331, roughness: 0.7, metalness: 0.3 });
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1.6, 46, 1.6), craneMat);
    mast.position.set(CITY.waterAt + 34, 23, -140);
    this.group.add(mast);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(46, 1.4, 1.4), craneMat);
    arm.position.set(CITY.waterAt + 18, 45, -140);
    this.group.add(arm);
  }

  // --- collision queries -------------------------------------------------
  blocked(x, z, radius) {
    for (const b of this.buildings) {
      if (x + radius > b.min.x && x - radius < b.max.x && z + radius > b.min.z && z - radius < b.max.z) return true;
    }
    const edge = CITY.bound - 4;
    if (Math.abs(x) > edge || Math.abs(z) > edge) return true;
    if (x > CITY.waterAt - 2.5) return true;
    return false;
  }

  propAt(x, z, radius) {
    for (const p of this.props) {
      if (Math.hypot(p.x - x, p.z - z) < p.r + radius) return p;
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
    return hit;
  }

  randomRoadPoint(rng, near = { x: 0, z: 0 }, spread = 220) {
    for (let i = 0; i < 40; i++) {
      const alongH = rng.chance(0.5);
      const line = gridLine(rng.int(0, CITY.grid));
      const other = near[alongH ? 'x' : 'z'] + rng.range(-spread, spread);
      const p = alongH ? { x: other, z: line } : { x: line, z: other };
      if (Math.abs(p.x) < CITY.bound && Math.abs(p.z) < CITY.bound && !this.blocked(p.x, p.z, 3)) return p;
    }
    return { x: 0, z: 0 };
  }

  ramp(scene, dt) {
    if (this.water) this.water.position.y = -0.35 + Math.sin(performance.now() * 0.0004) * 0.05;
    this.sky.position.copy(this.lamps[0] ? this.lamps[0].position : new THREE.Vector3());
  }
}

// A parked car spot right beside a sidewalk, facing along the street.
export function parkingSpot(rng, world) {
  for (let i = 0; i < 60; i++) {
    const onZ = rng.chance(0.5);
    const line = gridLine(rng.int(0, CITY.grid));
    const along = rng.range(-CITY.bound + 20, CITY.bound - 20);
    const side = rng.sign();
    const offset = side * (CITY.roadWidth / 2 - 1.9);
    const p = onZ ? { x: along, z: line + offset } : { x: line + offset, z: along };
    if (!world.blocked(p.x, p.z, 2.6)) {
      return { ...p, heading: onZ ? (side > 0 ? 0 : Math.PI) : (side > 0 ? -Math.PI / 2 : Math.PI / 2) };
    }
  }
  return { x: 0, z: 0, heading: 0 };
}

export const CAR_CLASSES = Object.keys(CAR_TYPES);

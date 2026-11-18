// Port Meridian — the city.
// A procedurally generated dusk harbour on a 12x12 block grid. Every placement comes from the
// seeded generator, so the same seed rebuilds the same city. The module owns the meshes, the
// lights, the baked glow and the collision queries the rest of the game asks for.

import * as THREE from 'three';
import { CITY, GRID, BLOCK_INSET, PALETTE } from './config.js';
import { Rng, clamp, lerp, smoothstep } from './random.js';

const BLOCK_SIZE = CITY.pitch - CITY.roadWidth;          // 49: pavement pad
const INNER = BLOCK_SIZE - CITY.pavement * 2;            // 39: buildable interior
const HALF_BOUND = CITY.bound;

// ---------------------------------------------------------------------------
// Procedural textures (all drawn on canvas, no files)
// ---------------------------------------------------------------------------

function makeWindowTexture(rng, tint) {
  const W = 128;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const base = new THREE.Color(tint);
  g.fillStyle = `rgb(${Math.round(base.r * 255)},${Math.round(base.g * 255)},${Math.round(base.b * 255)})`;
  g.fillRect(0, 0, W, H);

  // Faint vertical structure so the facade does not read as flat paint.
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let x = 0; x < W; x += 16) g.fillRect(x, 0, 2, H);

  const cols = 6;
  const rows = 16;
  const cw = W / cols;
  const rh = H / rows;
  const litChance = rng.range(0.38, 0.68);
  const warm = rng.pick([
    [255, 214, 150], [255, 226, 176], [255, 196, 128], [214, 232, 255], [255, 240, 205],
  ]);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = rng.chance(litChance);
      const x = c * cw + cw * 0.22;
      const y = r * rh + rh * 0.24;
      const w = cw * 0.56;
      const h = rh * 0.5;
      if (on) {
        const k = rng.range(0.5, 1);
        g.fillStyle = `rgba(${Math.round(warm[0] * k)},${Math.round(warm[1] * k)},${Math.round(warm[2] * k)},1)`;
        g.fillRect(x, y, w, h);
      } else {
        g.fillStyle = 'rgba(10,14,22,0.85)';
        g.fillRect(x, y, w, h);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeGlowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.28, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.14)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makePoolTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.36)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Sky dome
// ---------------------------------------------------------------------------

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // always at the far plane
}`;

const SKY_FRAG = `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunPower;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.48, 0.62, h));
  col = mix(col, uTop, smoothstep(0.6, 0.95, h));
  float sun = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sun, 14.0) * 0.55 * uSunPower;
  col += uSunColor * pow(sun, 3.0) * 0.14 * uSunPower;
  // Horizon haze: the city puts a band of light at the skyline.
  col += uHorizon * smoothstep(0.55, 0.44, h) * 0.16;
  gl_FragColor = vec4(col, 1.0);
}`;

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

export class City {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    // The bounds the rest of the game asks the city for: cars clamp to them and the police
    // spawn at the edge of the map.
    this.seaEdge = CITY.seaEdge;
    this.bound = CITY.bound;
    this.rng = new Rng(`port-meridian:${seed}`);
    this.group = new THREE.Group();
    this.group.name = 'city';
    scene.add(this.group);

    this.buildings = [];
    this.props = [];
    this.lamps = [];
    this.neon = [];
    this.glows = [];
    this.blockers = [];
    this.buckets = new Map();
    this.parkingSpots = [];
    this.nightLift = 0;
    this.clockT = 0.82;

    this.glowTexture = makeGlowTexture();
    this.poolTexture = makePoolTexture();

    this._buildSky();
    this._buildLights();
    this._buildGround();
    this._buildBuildings();
    this._buildStreetFurniture();
    this._buildWater();
    this._buildGlowPools();
    this._collectParking();

    this.setClockT(this.clockT);
  }

  // --- sky / atmosphere -------------------------------------------------

  _buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 20);
    this.skyMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(PALETTE.skyTop) },
        uMid: { value: new THREE.Color(PALETTE.skyMid) },
        uHorizon: { value: new THREE.Color(PALETTE.skyHorizon) },
        uSunDir: { value: new THREE.Vector3(0.75, 0.08, -0.66) },
        uSunColor: { value: new THREE.Color(PALETTE.sun) },
        uSunPower: { value: 1 },
      },
    });
    this.sky = new THREE.Mesh(geo, this.skyMaterial);
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    this.fog = new THREE.Fog(PALETTE.fog, 90, 560);
    this.scene.fog = this.fog;

    // A sun glow sprite low on the horizon, so the light has a visible source.
    const sunMat = new THREE.SpriteMaterial({
      map: this.glowTexture, color: 0xffb070, blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.9, fog: false,
    });
    this.sunSprite = new THREE.Sprite(sunMat);
    this.sunSprite.scale.set(150, 150, 1);
    this.sunSprite.position.set(560, 70, -500);
    this.group.add(this.sunSprite);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.15);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0x3a4668, 0.55);
    this.scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(PALETTE.sun, 1.55);
    this.sun.position.set(420, 120, -380);
    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.rim = new THREE.DirectionalLight(0x4d7fff, 0.55);
    this.rim.position.set(-320, 90, 300);
    this.scene.add(this.rim);
  }

  // --- ground, roads, pavements -----------------------------------------

  _buildGround() {
    const size = HALF_BOUND * 2 + 40;

    // Asphalt: dark, slightly wet looking.
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshStandardMaterial({
        color: PALETTE.asphalt, roughness: 0.46, metalness: 0.22,
      }),
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.receiveShadow = false;
    this.group.add(asphalt);
    this.asphalt = asphalt;

    // Pavement pads, one per block, via InstancedMesh: one draw call for the whole city.
    const padGeo = new THREE.BoxGeometry(BLOCK_SIZE, 0.22, BLOCK_SIZE);
    const padMat = new THREE.MeshStandardMaterial({ color: PALETTE.pavement, roughness: 0.86, metalness: 0.05 });
    const pads = new THREE.InstancedMesh(padGeo, padMat, CITY.blocks * CITY.blocks);
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < CITY.blocks; i++) {
      for (let j = 0; j < CITY.blocks; j++) {
        const cx = (i - CITY.blocks / 2) * CITY.pitch + CITY.pitch / 2;
        const cz = (j - CITY.blocks / 2) * CITY.pitch + CITY.pitch / 2;
        m.makeTranslation(cx, 0.11, cz);
        pads.setMatrixAt(n++, m);
      }
    }
    pads.count = n;
    pads.instanceMatrix.needsUpdate = true;
    this.group.add(pads);

    // Kerb trim: a lighter lip around each pad.
    const kerbGeo = new THREE.BoxGeometry(BLOCK_SIZE + 0.5, 0.26, 0.34);
    const kerbMat = new THREE.MeshStandardMaterial({ color: PALETTE.kerb, roughness: 0.8 });
    const kerbs = new THREE.InstancedMesh(kerbGeo, kerbMat, CITY.blocks * CITY.blocks * 4);
    let k = 0;
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (let i = 0; i < CITY.blocks; i++) {
      for (let j = 0; j < CITY.blocks; j++) {
        const cx = (i - CITY.blocks / 2) * CITY.pitch + CITY.pitch / 2;
        const cz = (j - CITY.blocks / 2) * CITY.pitch + CITY.pitch / 2;
        const half = BLOCK_SIZE / 2;
        const ry = Math.PI / 2;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0);
        p.set(cx, 0.13, cz - half); m.compose(p, q, s); kerbs.setMatrixAt(k++, m);
        p.set(cx, 0.13, cz + half); m.compose(p, q, s); kerbs.setMatrixAt(k++, m);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
        p.set(cx - half, 0.13, cz); m.compose(p, q, s); kerbs.setMatrixAt(k++, m);
        p.set(cx + half, 0.13, cz); m.compose(p, q, s); kerbs.setMatrixAt(k++, m);
      }
    }
    kerbs.count = k;
    kerbs.instanceMatrix.needsUpdate = true;
    this.group.add(kerbs);

    // Lane dashes down the centre of every road.
    const dashGeo = new THREE.BoxGeometry(0.22, 0.02, 3.4);
    const dashMat = new THREE.MeshStandardMaterial({
      color: 0xc8c3a0, roughness: 0.7, emissive: 0x3a3524, emissiveIntensity: 0.5,
    });
    const dashesPerRoad = Math.floor((HALF_BOUND * 2) / 9);
    const total = GRID.length * 2 * dashesPerRoad;
    const dashes = new THREE.InstancedMesh(dashGeo, dashMat, total);
    let d = 0;
    for (const g of GRID) {
      for (let t = -HALF_BOUND + 4; t < HALF_BOUND; t += 9) {
        // North-south road at x = g: dashes run along z.
        p.set(g, 0.025, t); q.identity(); m.compose(p, q, s); dashes.setMatrixAt(d++, m);
        // East-west road at z = g: dashes run along x.
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
        p.set(t, 0.025, g); m.compose(p, q, s); dashes.setMatrixAt(d++, m);
      }
    }
    dashes.count = Math.min(d, total);
    dashes.instanceMatrix.needsUpdate = true;
    this.group.add(dashes);

    // Crosswalk stripes at every junction.
    const stripeGeo = new THREE.BoxGeometry(0.6, 0.02, 4.6);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xdedac4, roughness: 0.68, emissive: 0x2e2a1c, emissiveIntensity: 0.45,
    });
    const stripes = new THREE.InstancedMesh(stripeGeo, stripeMat, GRID.length * GRID.length * 16);
    let sN = 0;
    for (const gx of GRID) {
      for (const gz of GRID) {
        for (let sx = -3; sx <= 3; sx += 2) {
          if (sN >= stripes.instanceMatrix.count) break;
          p.set(gx + sx * 1.9, 0.03, gz - 10.4); q.identity(); m.compose(p, q, s); stripes.setMatrixAt(sN++, m);
          p.set(gx + sx * 1.9, 0.03, gz + 10.4); m.compose(p, q, s); stripes.setMatrixAt(sN++, m);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
          p.set(gx - 10.4, 0.03, gz + sx * 1.9); m.compose(p, q, s); stripes.setMatrixAt(sN++, m);
          p.set(gx + 10.4, 0.03, gz + sx * 1.9); m.compose(p, q, s); stripes.setMatrixAt(sN++, m);
        }
      }
    }
    stripes.count = sN;
    stripes.instanceMatrix.needsUpdate = true;
    this.group.add(stripes);
  }

  // --- buildings ---------------------------------------------------------

  _blockCenter(i, j) {
    return {
      x: (i - CITY.blocks / 2) * CITY.pitch + CITY.pitch / 2,
      z: (j - CITY.blocks / 2) * CITY.pitch + CITY.pitch / 2,
    };
  }

  _keepClear(x, z) {
    // Mission targets and the respawn point stay open so a building never swallows them.
    const clear = [
      [214, -40], [282, -150], [150, 190], [-240, 210], [150, -150], [96, -196],
    ];
    for (const [cx, cz] of clear) {
      if (Math.hypot(x - cx, z - cz) < 21) return true;
    }
    return false;
  }

  _buildBuildings() {
    const rng = this.rng;
    const tints = [0x2a2f42, 0x33304a, 0x272b36, 0x36323f, 0x2e3a44, 0x3a3448];
    const textures = [];
    for (let i = 0; i < 6; i++) textures.push(makeWindowTexture(rng, tints[i]));

    const localBox = new THREE.BoxGeometry(1, 1, 1);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1a1d26, roughness: 0.95 });
    const neonColors = PALETTE.neon;
    const target = CITY.buildingCount;
    const blocks = [];
    for (let i = 0; i < CITY.blocks; i++) {
      for (let j = 0; j < CITY.blocks; j++) blocks.push([i, j]);
    }
    // Shuffle deterministically so the building spread is not a raster scan.
    for (let i = blocks.length - 1; i > 0; i--) {
      const k = Math.floor(rng.next() * (i + 1));
      [blocks[i], blocks[k]] = [blocks[k], blocks[i]];
    }

    this.buildingGroup = new THREE.Group();
    this.group.add(this.buildingGroup);

    for (const [i, j] of blocks) {
      if (this.buildings.length >= target) break;
      const c = this._blockCenter(i, j);
      if (c.x > CITY.seaEdge - 30) continue;                    // in the sea
      if (this._keepClear(c.x, c.z)) continue;

      const perBlock = rng.chance(0.3) ? 2 : 1;
      for (let b = 0; b < perBlock; b++) {
        if (this.buildings.length >= target) break;
        const maxW = perBlock === 1 ? INNER : INNER * 0.46;
        const w = rng.range(maxW * 0.62, maxW);
        const d = rng.range(maxW * 0.62, maxW);
        const ox = perBlock === 1 ? 0 : (b === 0 ? -1 : 1) * (INNER * 0.25);
        const oz = perBlock === 1 ? 0 : (b === 0 ? -1 : 1) * (INNER * 0.25);
        const x = c.x + ox + rng.range(-1.5, 1.5);
        const z = c.z + oz + rng.range(-1.5, 1.5);
        const h = rng.chance(0.12) ? rng.range(42, 78) : rng.range(12, 34);
        this._addBuilding(x, z, w, d, h, rng, textures, localBox, roofMat, neonColors);
      }
    }

    // Fill any block left empty with a low lot so the grid never reads as a hole.
    for (const [i, j] of blocks) {
      const c = this._blockCenter(i, j);
      if (c.x > CITY.seaEdge - 30) continue;
      const near = this.buildings.some((b) => Math.abs(b.x - c.x) < 30 && Math.abs(b.z - c.z) < 30);
      if (!near && this._keepClear(c.x, c.z) === false) {
        this._addLot(c.x, c.z, rng);
      }
    }
  }

  _addBuilding(x, z, w, d, h, rng, textures, geo, roofMat, neonColors) {
    const texIndex = rng.int(0, textures.length - 1);
    const map = textures[texIndex].clone();
    map.needsUpdate = true;
    const sx = Math.max(1, Math.round(w / 4.6));
    const sy = Math.max(1, Math.round(h / 3.6));
    map.repeat.set(sx, sy);

    const mat = new THREE.MeshStandardMaterial({
      map,
      emissiveMap: map,
      emissive: new THREE.Color(0xffcf94),
      emissiveIntensity: 1.05,
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.12,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2 + 0.18, z);
    mesh.scale.set(w, h, d);
    this.buildingGroup.add(mesh);

    this.buildings.push({ x, z, w, d, h, mesh, material: mat });

    // Roof slab and a little mechanical box, so the skyline has silhouette detail.
    const roof = new THREE.Mesh(geo, roofMat);
    roof.position.set(x, h + 0.32, z);
    roof.scale.set(w * 0.98, 0.32, d * 0.98);
    this.buildingGroup.add(roof);
    if (h > 16 && rng.chance(0.55)) {
      const unit = new THREE.Mesh(geo, roofMat);
      unit.position.set(x + rng.range(-w * 0.2, w * 0.2), h + 1.1, z + rng.range(-d * 0.2, d * 0.2));
      unit.scale.set(w * 0.24, 1.4, d * 0.24);
      this.buildingGroup.add(unit);
    }

    this._addBlocker({ x, z, halfX: w / 2, halfZ: d / 2, kind: 'building' });

    // Neon signage on the street-facing side of most buildings.
    if (rng.chance(0.55)) {
      const color = new THREE.Color(rng.pick(neonColors));
      const side = rng.int(0, 3);
      const signH = rng.range(1.4, 3.2);
      const signW = rng.range(2.2, Math.min(w, d) * 0.7);
      const sy2 = rng.range(4.5, Math.max(5.5, Math.min(h - 2, 22)));
      const t = 0.26;
      let nx = x;
      let nz = z;
      let sw = signW;
      let sd = t;
      if (side === 0) { nz = z - d / 2 - t / 2; }
      else if (side === 1) { nz = z + d / 2 + t / 2; }
      else if (side === 2) { nx = x - w / 2 - t / 2; sw = t; sd = signW; }
      else { nx = x + w / 2 + t / 2; sw = t; sd = signW; }

      const signMat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
      const sign = new THREE.Mesh(geo, signMat);
      sign.position.set(nx, sy2, nz);
      sign.scale.set(sw, signH, sd);
      this.buildingGroup.add(sign);
      this.neon.push({ mesh: sign, material: signMat, base: color.clone() });

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: color.clone(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.5,
      }));
      halo.position.set(nx, sy2, nz);
      halo.scale.set(signW * 2.1, signH * 3.4, 1);
      this.buildingGroup.add(halo);
      this.glows.push({ sprite: halo, base: 0.5, kind: 'neon' });
      this.neon[this.neon.length - 1].halo = halo;
    }

    // Shopfront glow at street level on about a third of the buildings.
    if (rng.chance(0.32)) {
      const color = new THREE.Color(rng.pick([0xffc98a, 0x9fe8ff, 0xffb0d0]));
      const shop = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.poolTexture,
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.32,
      }));
      shop.position.set(x + rng.range(-w * 0.2, w * 0.2), 1.4, z + d / 2 + 0.6);
      shop.scale.set(7, 3.6, 1);
      this.buildingGroup.add(shop);
      this.glows.push({ sprite: shop, base: 0.32, kind: 'shop' });
    }
  }

  _addLot(x, z, rng) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x24262e, roughness: 0.95 });
    const slab = new THREE.Mesh(geo, mat);
    const w = rng.range(14, INNER * 0.7);
    const d = rng.range(12, INNER * 0.7);
    slab.position.set(x, 0.3, z);
    slab.scale.set(w, 0.5, d);
    this.group.add(slab);
    // A few crates and a skip on the empty lot.
    for (let i = 0; i < 3; i++) {
      this._addCrate(x + rng.range(-w / 2, w / 2), z + rng.range(-d / 2, d / 2), rng);
    }
  }

  // --- props -------------------------------------------------------------

  _addBlocker(b) {
    this.blockers.push(b);
    const minX = Math.floor((b.x - b.halfX) / 32);
    const maxX = Math.floor((b.x + b.halfX) / 32);
    const minZ = Math.floor((b.z - b.halfZ) / 32);
    const maxZ = Math.floor((b.z + b.halfZ) / 32);
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        const key = `${ix},${iz}`;
        let list = this.buckets.get(key);
        if (!list) { list = []; this.buckets.set(key, list); }
        list.push(b);
      }
    }
  }

  _addCrate(x, z, rng, size) {
    const s = size ?? rng.range(0.75, 1.25);
    const mat = new THREE.MeshStandardMaterial({ color: rng.pick([0x6b5136, 0x4d5b46, 0x5a4a3c]), roughness: 0.9 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    mesh.position.set(x, 0.18 + s / 2, z);
    mesh.scale.set(s, s, s);
    mesh.rotation.y = rng.range(0, Math.PI);
    this.group.add(mesh);
    const prop = { x, z, r: s * 0.6, mesh, type: 'crate', height: s, knocked: false, vy: 0, vx: 0, vz: 0, rot: 0 };
    this.props.push(prop);
    this._addBlocker({ x, z, halfX: s * 0.45, halfZ: s * 0.45, kind: 'prop', weak: true, prop });
  }

  _addHydrant(x, z) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xc44238, roughness: 0.6, metalness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.72, 8), mat);
    body.position.set(x, 0.54, z);
    this.group.add(body);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), mat);
    cap.position.set(x, 0.9, z);
    this.group.add(cap);
    const prop = { x, z, r: 0.24, mesh: body, type: 'hydrant', height: 0.7, knocked: false, vy: 0, vx: 0, vz: 0, rot: 0 };
    this.props.push(prop);
    this._addBlocker({ x, z, halfX: 0.22, halfZ: 0.22, kind: 'prop', weak: true, prop });
  }

  _addPalm(x, z, rng) {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4634, roughness: 0.95 });
    const h = rng.range(6, 9);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, h, 6), trunkMat);
    trunk.position.set(x, h / 2 + 0.18, z);
    trunk.rotation.z = rng.range(-0.06, 0.06);
    this.group.add(trunk);

    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5c3e, roughness: 0.9, side: THREE.DoubleSide });
    const fronds = new THREE.Group();
    fronds.position.set(x, h + 0.18, z);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3.2), leafMat);
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / 7) * Math.PI * 2 + rng.range(-0.2, 0.2);
      leaf.position.set(0, 0, 1.5);
      leaf.rotation.x = -0.5 - rng.range(0, 0.3);
      pivot.add(leaf);
      fronds.add(pivot);
    }
    this.group.add(fronds);
    this.props.push({ x, z, r: 0.34, mesh: trunk, type: 'palm', height: h, knocked: false, vy: 0, vx: 0, vz: 0, rot: 0 });
    this._addBlocker({ x, z, halfX: 0.32, halfZ: 0.32, kind: 'prop' });
  }

  _addLamp(x, z, axis, withPool) {
    this._lampData.push({ x, z, axis, withPool });
    this._addBlocker({ x, z, halfX: 0.2, halfZ: 0.2, kind: 'lamp' });
  }

  _buildLamps() {
    const data = this._lampData;
    if (data.length === 0) return;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.6, metalness: 0.6 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const cyl = new THREE.CylinderGeometry(0.09, 0.13, 7.2, 6);

    const poles = new THREE.InstancedMesh(cyl, poleMat, data.length);
    const arms = new THREE.InstancedMesh(box, poleMat, data.length);
    const heads = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }), data.length);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const armLen = 2.1;

    const haloPos = [];
    const poolPos = [];

    for (let i = 0; i < data.length; i++) {
      const d = data[i];
      const ax = d.axis === 'x' ? armLen : 0;
      const az = d.axis === 'z' ? armLen : 0;
      q.identity();
      p.set(d.x, 3.78, d.z); m.compose(p, q, s); poles.setMatrixAt(i, m);
      p.set(d.x + ax / 2, 7.1, d.z + az / 2);
      s.set(d.axis === 'x' ? armLen : 0.14, 0.14, d.axis === 'z' ? armLen : 0.14);
      m.compose(p, q, s); arms.setMatrixAt(i, m);
      p.set(d.x + ax, 7.0, d.z + az); s.set(0.7, 0.2, 0.4);
      m.compose(p, q, s); heads.setMatrixAt(i, m);
      s.set(1, 1, 1);

      haloPos.push(d.x + ax, 7.0, d.z + az);
      if (d.withPool) poolPos.push(d.x + ax, 0.1, d.z + az);
      this.lamps.push({ x: d.x + ax, z: d.z + az, intensity: 1 });
    }
    for (const mesh of [poles, arms, heads]) {
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }

    // Every lamp halo in one additive Points cloud: one draw call for the whole city's lights.
    if (haloPos.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(haloPos, 3));
      this.lampHaloMat = new THREE.PointsMaterial({
        map: this.glowTexture, color: 0xffc978, size: 7.5, sizeAttenuation: true,
        transparent: true, opacity: 0.72, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geo, this.lampHaloMat);
      points.frustumCulled = false;
      this.group.add(points);
    }

    // Ground pools, one instanced flat quad each.
    if (poolPos.length > 0) {
      const count = poolPos.length / 3;
      const plane = new THREE.PlaneGeometry(1, 1);
      plane.rotateX(-Math.PI / 2);
      const poolMat = new THREE.MeshBasicMaterial({
        map: this.poolTexture, color: 0xffb96a, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const pools = new THREE.InstancedMesh(plane, poolMat, count);
      for (let i = 0; i < count; i++) {
        p.set(poolPos[i * 3], poolPos[i * 3 + 1], poolPos[i * 3 + 2]);
        s.set(15, 1, 15);
        q.identity();
        m.compose(p, q, s);
        pools.setMatrixAt(i, m);
      }
      pools.instanceMatrix.needsUpdate = true;
      this.group.add(pools);
      this.lampPoolMat = poolMat;
    }
  }

  _buildStreetFurniture() {
    const rng = this.rng;
    this._lampData = [];
    // Lamps along every road, alternating sides, evenly spaced.
    for (const g of GRID) {
      for (let t = -HALF_BOUND + 16, n = 0; t < HALF_BOUND - 8; t += CITY.lampSpacing, n++) {
        const side = n % 2 === 0 ? 1 : -1;
        const off = CITY.roadWidth / 2 + 1.2;
        if (g < CITY.seaEdge - 8) this._addLamp(g + side * off, t, 'x', true);
        this._addLamp(t, g + side * off, 'z', true);
      }
    }
    this._buildLamps();

    // Hydrants and crates on pavements.
    for (let i = 0; i < 54; i++) {
      const horizontal = rng.chance(0.5);
      const g = rng.pick(GRID);
      const along = rng.range(-HALF_BOUND + 30, HALF_BOUND - 30);
      const side = rng.sign();
      const off = CITY.roadWidth / 2 + 2.4;
      const x = horizontal ? along : g + side * off;
      const z = horizontal ? g + side * off : along;
      if (x > CITY.seaEdge - 10) continue;
      if (rng.chance(0.45)) this._addHydrant(x, z);
      else this._addCrate(x, z, rng, rng.range(0.6, 1.1));
    }

    // Palms along the sea front and the marina, where the city meets the water.
    for (let i = 0; i < 26; i++) {
      const x = rng.range(CITY.seaEdge - 78, CITY.seaEdge - 12);
      const z = rng.range(-HALF_BOUND + 20, HALF_BOUND - 20);
      if (this.isBlocked(x, z, 1.6)) continue;
      this._addPalm(x, z, rng);
    }
    for (let i = 0; i < 12; i++) {
      const x = rng.range(-HALF_BOUND + 40, CITY.seaEdge - 100);
      const z = rng.range(-HALF_BOUND + 40, -HALF_BOUND + 200);
      if (this.isBlocked(x, z, 1.6)) continue;
      this._addPalm(x, z, rng);
    }
  }

  _buildWater() {
    const startX = CITY.seaEdge;
    const width = HALF_BOUND * 2 + 200;
    const geo = new THREE.PlaneGeometry(width, HALF_BOUND * 2 + 200, 40, 40);
    const mat = new THREE.MeshStandardMaterial({
      color: PALETTE.water, roughness: 0.18, metalness: 0.62,
      emissive: 0x0a2233, emissiveIntensity: 0.6,
    });
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(startX + width / 2 - 60, -0.5, 0);
    this.group.add(water);
    this.water = water;
    this.waterMaterial = mat;

    // Glints on the water: additive strips that catch the sun.
    const glintMat = new THREE.MeshBasicMaterial({
      color: 0xffb070, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const glints = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const w = this.rng.range(8, 46);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, this.rng.range(0.4, 1.2)), glintMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(this.rng.range(startX + 10, startX + 260), -0.42, this.rng.range(-HALF_BOUND, HALF_BOUND));
      glints.add(mesh);
    }
    this.group.add(glints);

    // Quay wall so the sea edge reads as a wall, not a floating plane.
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c2e36, roughness: 0.9 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, HALF_BOUND * 2), wallMat);
    wall.position.set(startX, 0.6, 0);
    this.group.add(wall);
  }

  _buildGlowPools() {
    // Baked warm glow cards floating just above the asphalt at junctions; they read as
    // pooled light and give the road a wet sheen without any real point lights.
    const rng = this.rng;
    this.junctionGlow = new THREE.Group();
    for (const gx of GRID) {
      for (const gz of GRID) {
        if (rng.chance(0.55)) continue;
        const color = new THREE.Color(rng.pick([0xffb96a, 0xffc98a, 0x8fd8ff]));
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: this.poolTexture, color, blending: THREE.AdditiveBlending,
          depthWrite: false, transparent: true, opacity: 0.14,
        }));
        sprite.position.set(gx + rng.range(-6, 6), 0.09, gz + rng.range(-6, 6));
        sprite.scale.set(rng.range(22, 38), rng.range(22, 38), 1);
        this.junctionGlow.add(sprite);
        this.glows.push({ sprite, base: 0.14, kind: 'pool' });
      }
    }
    this.group.add(this.junctionGlow);
  }

  // --- collision ---------------------------------------------------------

  _nearBuildBlockers(x, z, pad = 0) {
    const ix = Math.floor(x / 32);
    const iz = Math.floor(z / 32);
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.buckets.get(`${ix + dx},${iz + dz}`);
        if (!list) continue;
        for (const b of list) {
          if (b.x + b.halfX + pad < x) continue;
          if (b.x - b.halfX - pad > x) continue;
          if (b.z + b.halfZ + pad < z) continue;
          if (b.z - b.halfZ - pad > z) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  isBlocked(x, z, pad = 0) {
    if (Math.abs(x) > HALF_BOUND || Math.abs(z) > HALF_BOUND) return true;
    if (x > CITY.seaEdge - 1) return true;
    for (const b of this._nearBuildBlockers(x, z, pad)) {
      // A knocked-over crate stops blocking traffic and feet.
      if (b.prop && b.prop.knocked) continue;
      return true;
    }
    return false;
  }

  // Pushes a circle out of solid geometry. Mutates and returns `pos` ({x, z}).
  resolveCircle(pos, radius, prev) {
    const r = radius;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const b of this._nearBuildBlockers(pos.x, pos.z, r)) {
        if (b.prop && b.prop.knocked) continue;
        const dx = pos.x - b.x;
        const dz = pos.z - b.z;
        const px = b.halfX + r - Math.abs(dx);
        const pz = b.halfZ + r - Math.abs(dz);
        if (px <= 0 || pz <= 0) continue;
        if (px < pz) {
          pos.x += dx >= 0 ? px : -px;
        } else {
          pos.z += dz >= 0 ? pz : -pz;
        }
        moved = true;
      }
      // The sea and the city bound.
      if (pos.x > CITY.seaEdge - 2) pos.x = CITY.seaEdge - 2;
      if (pos.x < -HALF_BOUND + 1) pos.x = -HALF_BOUND + 1;
      if (pos.z > HALF_BOUND - 1) pos.z = HALF_BOUND - 1;
      if (pos.z < -HALF_BOUND + 1) pos.z = -HALF_BOUND + 1;
      if (!moved) break;
    }
    return pos;
  }

  // Knocks over a small prop if the car hit it. Returns true if something fell.
  knockProp(x, z, radius, impact) {
    for (const prop of this.props) {
      if (prop.knocked) continue;
      if (prop.type === 'palm') continue;
      const d = Math.hypot(prop.x - x, prop.z - z);
      if (d > radius + prop.r) continue;
      prop.knocked = true;
      prop.vy = 3.2 + impact * 0.35;
      const nx = (prop.x - x) / (d || 1);
      const nz = (prop.z - z) / (d || 1);
      prop.vx = nx * (2 + impact * 0.5);
      prop.vz = nz * (2 + impact * 0.5);
      prop.rot = 0;
      return true;
    }
    return false;
  }

  updateProps(dt) {
    for (const prop of this.props) {
      if (!prop.knocked || !prop.mesh) continue;
      prop.vy -= 18 * dt;
      prop.mesh.position.y += prop.vy * dt;
      prop.mesh.position.x += prop.vx * dt;
      prop.mesh.position.z += prop.vz * dt;
      prop.rot += dt * 2.4;
      prop.mesh.rotation.z = prop.rot;
      const floor = 0.2 + (prop.height ?? 1) * 0.15;
      if (prop.mesh.position.y < floor) {
        prop.mesh.position.y = floor;
        prop.vy = 0;
        prop.vx *= 0.6;
        prop.vz *= 0.6;
      }
    }
  }

  // --- parking -----------------------------------------------------------

  _collectParking() {
    const off = CITY.roadWidth / 2 + 1.9;
    for (const g of GRID) {
      for (let t = -HALF_BOUND + 24; t < HALF_BOUND - 24; t += 12) {
        for (const side of [-1, 1]) {
          // Along a north-south road: cars face along z.
          const x1 = g + side * off;
          if (x1 < CITY.seaEdge - 6 && !this.isBlocked(x1, t, 1.2)) {
            this.parkingSpots.push({ x: x1, z: t, angle: side > 0 ? -Math.PI / 2 : Math.PI / 2, axis: 'z' });
          }
          // Along an east-west road: cars face along x.
          const z1 = g + side * off;
          if (!this.isBlocked(t, z1, 1.2)) {
            this.parkingSpots.push({ x: t, z: z1, angle: side > 0 ? Math.PI : 0, axis: 'x' });
          }
        }
      }
    }
  }

  findParkingSpot(x, z, occupied = [], minDist = 0) {
    let best = null;
    let bestD = Infinity;
    for (const spot of this.parkingSpots) {
      if (this.isBlocked(spot.x, spot.z, 1.4)) continue;
      let taken = false;
      for (const o of occupied) {
        if (Math.hypot(o.x - spot.x, o.z - spot.z) < 5.2) { taken = true; break; }
      }
      if (taken) continue;
      const d = Math.hypot(spot.x - x, spot.z - z);
      if (d < minDist) continue;
      if (d < bestD) { bestD = d; best = spot; }
    }
    return best ? { ...best } : null;
  }

  // A free place to put a car for staging: near a point, clear of buildings.
  findClearSpot(x, z, radius = 40) {
    for (let r = 2; r <= radius; r += 3) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const px = x + Math.cos(ang) * r;
        const pz = z + Math.sin(ang) * r;
        if (!this.isBlocked(px, pz, 2.4)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  // --- road helpers ------------------------------------------------------

  isOnRoad(x, z) {
    const nearLine = (v) => {
      const mod = ((v % CITY.pitch) + CITY.pitch) % CITY.pitch;
      const d = Math.min(mod, CITY.pitch - mod);
      return d <= CITY.roadWidth / 2;
    };
    return nearLine(x) || nearLine(z);
  }

  nearestRoadPoint(x, z) {
    // Snap to the nearer road axis: returns a point on that road's centre line.
    const snap = (v) => Math.round(v / CITY.pitch) * CITY.pitch;
    const dx = Math.abs(x - snap(x));
    const dz = Math.abs(z - snap(z));
    if (dx <= dz) return { x: snap(x), z, axis: 'z', angle: 0 };
    return { x, z: snap(z), axis: 'x', angle: Math.PI / 2 };
  }

  // --- day / night -------------------------------------------------------

  setClockT(t) {
    this.clockT = t;
    const dayT = ((t % 1) + 1) % 1;
    const hour = dayT * 24;

    // Daylight is a single readable scalar: 1 at 13:00, 0 at 01:00, smooth in between.
    // Everything below is driven off it, so every clock time has an obviously bright or
    // obviously dark city rather than a murky half-lit one.
    const daylight = 0.5 + 0.5 * Math.cos(((hour - 13) / 24) * Math.PI * 2);
    const night = Math.pow(1 - daylight, 1.35);          // 0 in daylight, 1 at night
    const golden = Math.max(0, 1 - Math.abs(hour - 19) / 3.2);  // warm band around sunset

    // Sun position: rises in the east at 06:00, sets in the west at 19:30.
    const arc = Math.max(0, Math.min(1, (hour - 6) / 13.5));
    const azimuth = arc * Math.PI;
    const sunX = Math.cos(azimuth) * 560;
    const sunY = Math.max(26, Math.sin(azimuth) * 430);
    const lift = this.nightLift;

    this.sun.position.set(sunX, sunY, -330 - Math.sin(azimuth) * 120);
    this.sunSprite.position.set(sunX * 1.22, Math.max(34, sunY * 0.82), (this.sun.position.z) * 1.3);
    this.skyMaterial.uniforms.uSunDir.value.copy(this.sun.position).normalize();

    // Light intensities. Dusk keeps a real sun, night keeps a moonlit floor. The hemisphere
    // and ambient floor are deliberately generous: a dusk city lit only by a horizon sun is
    // unreadably dark, and the spec asks for a readable city.
    this.sun.intensity = (0.4 + daylight * 1.9) * (1 + lift * 0.4);
    this.sun.color.setHSL(0.075 - golden * 0.02, 0.72, 0.5 + golden * 0.12);
    this.hemi.intensity = (1.85 + daylight * 1.1) * (1 + lift * 0.28);
    this.hemi.color.setHSL(0.62, 0.36, 0.52 + daylight * 0.14);
    this.ambient.intensity = (1.15 + daylight * 0.9) * (1 + lift * 0.6);
    this.rim.intensity = (0.55 + night * 0.75) * (1 + lift * 0.5);

    // Sky colours: warm horizon at dusk, deep blue at night, lifted for the night shot.
    const top = new THREE.Color(PALETTE.skyTop);
    const mid = new THREE.Color(PALETTE.skyMid);
    const horizon = new THREE.Color(PALETTE.skyHorizon);
    top.lerp(new THREE.Color(0x060a18), night * 0.72);
    mid.lerp(new THREE.Color(0x0c1226), night * 0.78);
    horizon.lerp(new THREE.Color(0x1a2340), night * 0.8);
    if (lift > 0) {
      top.lerp(new THREE.Color(0x22305e), lift * 0.8);
      mid.lerp(new THREE.Color(0x3c4c86), lift * 0.8);
      horizon.lerp(new THREE.Color(0x8a7ea0), lift * 0.7);
    }
    this.skyMaterial.uniforms.uTop.value.copy(top);
    this.skyMaterial.uniforms.uMid.value.copy(mid);
    this.skyMaterial.uniforms.uHorizon.value.copy(horizon);
    this.skyMaterial.uniforms.uSunPower.value = 0.35 + golden * 0.9 + daylight * 0.35;

    // Fog picks up the horizon so distance reads as haze, not black.
    const fogColor = horizon.clone().lerp(new THREE.Color(PALETTE.fog), 0.55);
    if (lift > 0) fogColor.lerp(new THREE.Color(0x39436a), lift * 0.55);
    this.fog.color.copy(fogColor);
    this.fog.near = 70 - lift * 6;
    this.fog.far = 520 + lift * 320;

    if (this.waterMaterial) {
      this.waterMaterial.emissiveIntensity = 0.5 + night * 0.9 + lift * 0.7;
      this.waterMaterial.color.setHex(0x0e2234).lerp(new THREE.Color(0x1a3c58), lift * 0.5);
    }

    // Buildings glow at night; the screenshot night lift pushes them further so the frame is
    // bright, never murky.
    const windowGlow = 0.8 + night * 1.1 + lift * 1.5;
    for (const b of this.buildings) b.material.emissiveIntensity = windowGlow;
    for (const n of this.neon) {
      if (n.material) n.material.color.copy(n.base).multiplyScalar(0.8 + night * 0.5 + lift * 0.7);
    }
    for (const g of this.glows) {
      const scale = 1 + night * 0.4 + lift * 1.5;
      g.sprite.material.opacity = Math.min(1, g.base * scale);
    }
    if (this.lampHaloMat) this.lampHaloMat.opacity = Math.min(1, 0.55 + night * 0.35 + lift * 0.3);
    if (this.lampPoolMat) this.lampPoolMat.opacity = Math.min(1, 0.2 + night * 0.16 + lift * 0.3);
  }

  setNightLift(amount) {
    this.nightLift = clamp(amount, 0, 1);
    this.setClockT(this.clockT);
  }

  onFrame(dt) {
    this.updateProps(dt);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
  }
}

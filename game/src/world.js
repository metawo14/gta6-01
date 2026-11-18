// The city: a seeded 12x12 grid of blocks, its roads, its buildings, its props,
// its dusk sky and the baked glow overlays that make dusk and night readable.

import * as THREE from 'three';
import { CITY, ROADS, COLORS, RESERVED } from './config.js';
import { Rand, clamp } from './random.js';

const TILE = 8; // one window tile of the facade texture, in world units

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// A radial glow card, shared by lamps, neon and light pools.
function glowTexture(inner = 'rgba(255,255,255,0.9)', outer = 'rgba(255,255,255,0)') {
  const c = canvas2d(128, 128);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.45, inner.replace(/[\d.]+\)$/, '0.35)'));
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A facade: dark wall with a grid of lit and unlit windows. Eight variants.
function facadeTexture(rand, wallHex) {
  const W = 128;
  const H = 256;
  const c = canvas2d(W, H);
  const g = c.getContext('2d');
  const wall = new THREE.Color(wallHex);
  g.fillStyle = `#${wall.getHexString()}`;
  g.fillRect(0, 0, W, H);
  // faint vertical seams so the wall is not a flat fill
  for (let i = 0; i < 6; i++) {
    g.fillStyle = `rgba(0,0,0,${0.04 + rand.next() * 0.05})`;
    g.fillRect(Math.floor(rand.range(0, W)), 0, 1 + Math.floor(rand.range(0, 3)), H);
  }
  const cols = 4;
  const rows = 8;
  const cw = W / cols;
  const ch = H / rows;
  const warmth = rand.pick([
    [255, 214, 148],
    [255, 232, 190],
    [255, 190, 120],
    [190, 244, 255],
    [255, 176, 196],
  ]);
  for (let y = 0; y < rows; y++) {
    const floorLit = rand.chance(0.82);
    for (let x = 0; x < cols; x++) {
      const px = x * cw + cw * 0.2;
      const py = y * ch + ch * 0.24;
      const pw = cw * 0.6;
      const ph = ch * 0.42;
      const lit = floorLit && rand.chance(0.55);
      if (lit) {
        const a = 0.5 + rand.next() * 0.5;
        g.fillStyle = `rgba(${warmth[0]},${warmth[1]},${warmth[2]},${a.toFixed(2)})`;
      } else {
        g.fillStyle = rand.chance(0.5) ? 'rgba(12,16,26,0.92)' : 'rgba(22,28,40,0.8)';
      }
      g.fillRect(px, py, pw, ph);
      if (lit) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(px, py + ph * 0.72, pw, ph * 0.12);
      }
    }
    // a slab line between floors
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(0, y * ch + ch * 0.9, W, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// The whole street plan baked into one texture: asphalt, kerbs, lane paint, crossings.
function streetTexture() {
  const SPAN = 840;
  const SIZE = 2048;
  const s = SIZE / SPAN;
  const c = canvas2d(SIZE, SIZE);
  const g = c.getContext('2d');
  const px = (v) => (v + SPAN / 2) * s;
  const rect = (x, z, w, d, color) => {
    g.fillStyle = color;
    g.fillRect(px(x), px(z), w * s, d * s);
  };
  // pavement everywhere, then block interiors as dark lots
  rect(-SPAN / 2, -SPAN / 2, SPAN, SPAN, '#3a3f49');
  for (let i = 0; i < CITY.blocks; i++) {
    for (let j = 0; j < CITY.blocks; j++) {
      const x0 = ROADS[i] + CITY.roadWidth / 2 + CITY.pavement;
      const z0 = ROADS[j] + CITY.roadWidth / 2 + CITY.pavement;
      const w = CITY.pitch - CITY.roadWidth - CITY.pavement * 2;
      rect(x0, z0, w, w, '#2f333c');
      rect(x0 + 0.9, z0 + 0.9, w - 1.8, w - 1.8, '#333845');
    }
  }
  // roads
  for (const r of ROADS) {
    rect(r - CITY.roadWidth / 2, -SPAN / 2, CITY.roadWidth, SPAN, '#13161d');
    rect(-SPAN / 2, r - CITY.roadWidth / 2, SPAN, CITY.roadWidth, '#13161d');
  }
  // kerb lines
  for (const r of ROADS) {
    const e = CITY.roadWidth / 2;
    rect(r - e - 0.7, -SPAN / 2, 0.7, SPAN, '#565c6b');
    rect(r + e, -SPAN / 2, 0.7, SPAN, '#565c6b');
    rect(-SPAN / 2, r - e - 0.7, SPAN, 0.7, '#565c6b');
    rect(-SPAN / 2, r + e, SPAN, 0.7, '#565c6b');
  }
  // lane dashes down each road centre
  for (const r of ROADS) {
    for (let t = -SPAN / 2 + 4; t < SPAN / 2; t += 9) {
      rect(r - 0.16, t, 0.32, 4.4, 'rgba(214,206,180,0.55)');
      rect(t, r - 0.16, 4.4, 0.32, 'rgba(214,206,180,0.55)');
    }
  }
  // crossings at every junction
  for (const rx of ROADS) {
    for (const rz of ROADS) {
      for (let k = -CITY.roadWidth / 2 + 1.6; k < CITY.roadWidth / 2 - 1; k += 2.6) {
        rect(rx + k, rz - CITY.roadWidth / 2 - 2.6, 1.3, 2.4, 'rgba(226,222,208,0.5)');
        rect(rx + k, rz + CITY.roadWidth / 2 + 0.2, 1.3, 2.4, 'rgba(226,222,208,0.5)');
        rect(rx - CITY.roadWidth / 2 - 2.6, rz + k, 2.4, 1.3, 'rgba(226,222,208,0.5)');
        rect(rx + CITY.roadWidth / 2 + 0.2, rz + k, 2.4, 1.3, 'rgba(226,222,208,0.5)');
      }
    }
  }
  // wet patches: broad soft smears of a lighter, bluer asphalt
  for (let i = 0; i < 160; i++) {
    const x = rand0(i * 3.1) * SPAN - SPAN / 2;
    const z = rand0(i * 7.7 + 3) * SPAN - SPAN / 2;
    const w = 8 + rand0(i * 1.3) * 26;
    const d = 4 + rand0(i * 2.7) * 12;
    g.fillStyle = 'rgba(70,86,110,0.14)';
    g.beginPath();
    g.ellipse(px(x), px(z), w * s * 0.5, d * s * 0.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function rand0(x) {
  const v = Math.sin(x * 127.1) * 43758.5453;
  return v - Math.floor(v);
}

// Scale a box's UVs so the window tile keeps its size whatever the building's shape.
function scaleBoxUV(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const sizes = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      const su = sizes[f][0] / TILE;
      const sv = sizes[f][1] / TILE;
      uv.setXY(idx, uv.getX(idx) * su, uv.getY(idx) * sv);
    }
  }
  uv.needsUpdate = true;
}

export class World {
  constructor(scene, seed = CITY.seed) {
    this.scene = scene;
    this.seed = seed;
    this.rand = new Rand(seed);
    this.root = new THREE.Group();
    this.root.name = 'city';
    scene.add(this.root);
    this.buildings = [];
    this.props = [];
    this.glows = { window: [], neon: [], shop: [], pool: [], lamp: [] };
    this.glowScale = 1;
    this.minutes = 19 * 60 + 40;
    this.lampLights = [];
    this._disposables = [];
    this.buildAll();
  }

  buildAll() {
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildWater();
    this.buildBuildings();
    this.buildProps();
    this.setTimeOfDay(this.minutes);
  }

  // ---------- sky ----------

  buildSky() {
    this.skyUniforms = {
      topColor: { value: new THREE.Color(COLORS.skyTop) },
      midColor: { value: new THREE.Color(COLORS.skyMid) },
      horizonColor: { value: new THREE.Color(COLORS.skyHorizon) },
      glowColor: { value: new THREE.Color(0xffb070) },
      sunDir: { value: new THREE.Vector3(0.6, 0.12, -0.5).normalize() },
      sunStrength: { value: 1 },
      starStrength: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 glowColor;
        uniform vec3 sunDir;
        uniform float sunStrength;
        uniform float starStrength;
        varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vWorld - vec3(0.0, 0.0, 0.0));
          float h = clamp(d.y, -1.0, 1.0);
          vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.34, h));
          col = mix(col, topColor, smoothstep(0.28, 0.92, h));
          float sun = max(0.0, dot(d, normalize(sunDir)));
          col += glowColor * pow(sun, 6.0) * 0.55 * sunStrength;
          col += glowColor * pow(sun, 42.0) * 1.4 * sunStrength;
          float band = smoothstep(0.02, 0.12, h) * (1.0 - smoothstep(0.12, 0.4, h));
          col += glowColor * band * 0.16 * sunStrength;
          if (starStrength > 0.01 && h > 0.1) {
            vec2 grid = floor(d.xz * 260.0 + d.y * 40.0);
            float s = hash(grid);
            if (s > 0.9955) col += vec3(0.8, 0.86, 1.0) * starStrength * smoothstep(0.1, 0.5, h);
          }
          if (h < 0.0) col = mix(col, horizonColor * 0.5, smoothstep(0.0, -0.25, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), mat);
    this.sky.name = 'sky';
    this.sky.frustumCulled = false;
    this.root.add(this.sky);

    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(16, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd0a0, fog: false }),
    );
    this.sun.position.set(320, 70, -300);
    this.root.add(this.sun);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0x8fa8d8, 0x2a2620, 0.55);
    this.root.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xa0b4d8, 0.28);
    this.root.add(this.ambient);
    this.sunLight = new THREE.DirectionalLight(0xffb27a, 1.15);
    this.sunLight.position.set(180, 90, -220);
    this.root.add(this.sunLight);
    this.rimLight = new THREE.DirectionalLight(0x54b8e0, 0.5);
    this.rimLight.position.set(-260, 60, 200);
    this.root.add(this.rimLight);
  }

  buildGround() {
    const geo = new THREE.PlaneGeometry(900, 900, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const tex = streetTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      // the same plan as a faint emissive map: wet asphalt and lane paint stay readable
      // at night, the way retroreflective paint does, without washing the frame out
      emissiveMap: tex,
      emissive: new THREE.Color(0xa8c4e0),
      emissiveIntensity: 0.1,
      roughness: 0.5,
      metalness: 0.24,
      color: 0xffffff,
    });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.position.y = 0;
    this.ground.name = 'ground';
    this.ground.receiveShadow = false;
    this.root.add(this.ground);
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(400, 900, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.water,
      roughness: 0.18,
      metalness: 0.75,
      emissive: 0x0a2230,
      emissiveIntensity: 1,
    });
    this.water = new THREE.Mesh(geo, mat);
    this.water.position.set(CITY.waterX + 200, -0.25, 0);
    this.water.name = 'water';
    this.root.add(this.water);

    // the sea wall
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(4, 3.4, 900),
      new THREE.MeshStandardMaterial({ color: 0x39404d, roughness: 0.9 }),
    );
    wall.position.set(CITY.seaWall - 1, 1.0, 0);
    this.root.add(wall);

    // long shimmer streaks on the water
    this.waterStreaks = new THREE.Group();
    const gtex = glowTexture('rgba(150,230,255,0.55)', 'rgba(150,230,255,0)');
    const gmat = new THREE.MeshBasicMaterial({
      map: gtex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.22,
    });
    for (let i = 0; i < 26; i++) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(30 + this.rand.range(0, 60), 2.2), gmat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(
        CITY.waterX + 18 + this.rand.range(0, 200),
        -0.18,
        this.rand.range(-400, 400),
      );
      s.rotation.z = this.rand.range(-0.05, 0.05);
      this.waterStreaks.add(s);
    }
    this.root.add(this.waterStreaks);
    this.glows.pool.push({ mat: gmat, base: 0.22 });
  }

  // ---------- buildings ----------

  facadeVariants() {
    if (!this._facades) {
      const r = new Rand(this.seed * 13 + 5);
      this._facades = COLORS.buildingColors.map((hex) => facadeTexture(r, hex));
    }
    return this._facades;
  }

  blockRects() {
    const out = [];
    for (let i = 0; i < CITY.blocks; i++) {
      for (let j = 0; j < CITY.blocks; j++) {
        const x0 = ROADS[i] + CITY.roadWidth / 2 + CITY.pavement;
        const z0 = ROADS[j] + CITY.roadWidth / 2 + CITY.pavement;
        const w = CITY.pitch - CITY.roadWidth - CITY.pavement * 2;
        const cx = x0 + w / 2;
        const cz = z0 + w / 2;
        if (cx > CITY.waterX - 12) continue; // the harbour
        let reserved = false;
        for (const r of RESERVED) {
          if (Math.hypot(cx - r.x, cz - r.z) < r.r + 16) reserved = true;
        }
        out.push({ x0, z0, w, cx, cz, reserved });
      }
    }
    return out;
  }

  buildBuildings() {
    const facades = this.facadeVariants();
    const r = this.rand;
    const blocks = this.blockRects();
    this.buildingGroup = new THREE.Group();
    this.root.add(this.buildingGroup);

    const neonColors = [COLORS.teal, COLORS.pink, 0xffd257, 0x7ce0ff, 0xa4ff8a];
    const signTex = [];
    for (let i = 0; i < 5; i++) signTex.push(glowTexture('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)'));

    for (const b of blocks) {
      if (b.reserved) continue;
      const roll = r.next();
      const count = roll < 0.15 ? 0 : roll < 0.86 ? 1 : 2;
      for (let k = 0; k < count; k++) {
        let w;
        let d;
        let x;
        let z;
        if (count === 1) {
          w = r.range(17, Math.min(34, b.w - 3));
          d = r.range(17, Math.min(34, b.w - 3));
          x = b.cx + r.range(-3, 3);
          z = b.cz + r.range(-3, 3);
        } else {
          const split = b.w / 2;
          const along = r.chance(0.5);
          w = along ? split - 2.5 : b.w - 4;
          d = along ? b.w - 4 : split - 2.5;
          x = b.cx + (along ? -split / 2 : 0);
          z = b.cz + (along ? 0 : -split / 2);
        }
        // keep the footprint inside the block
        w = Math.min(w, b.w - 2);
        d = Math.min(d, b.w - 2);
        x = clamp(x, b.x0 + w / 2 + 1, b.x0 + b.w - w / 2 - 1);
        z = clamp(z, b.z0 + d / 2 + 1, b.z0 + b.w - d / 2 - 1);

        const tall = r.chance(0.22);
        const h = tall ? r.range(34, 62) : r.range(9, 30);
        this.addBuilding(x, z, w, d, h, facades, neonColors, signTex, r);
      }
    }
    this.buildingCount = this.buildings.length;
  }

  addBuilding(x, z, w, d, h, facades, neonColors, signTex, r) {
    const tex = r.pick(facades);
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(geo, w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissive: new THREE.Color(0xffe0b0),
      emissiveMap: tex,
      emissiveIntensity: 0.85,
      roughness: 0.86,
      metalness: 0.06,
      color: 0xffffff,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    this.buildingGroup.add(mesh);

    // roof slab and a bit of rooftop detail
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x22262f, roughness: 0.95 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.7, d + 0.6), roofMat);
    roof.position.set(x, h + 0.3, z);
    this.buildingGroup.add(roof);
    if (r.chance(0.4)) {
      const ac = new THREE.Mesh(
        new THREE.BoxGeometry(r.range(1.5, 3.5), r.range(0.8, 2), r.range(1.5, 3.5)),
        new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.9 }),
      );
      ac.position.set(x + r.range(-w / 3, w / 3), h + 1.3, z + r.range(-d / 3, d / 3));
      this.buildingGroup.add(ac);
    }
    if (h > 40 && r.chance(0.7)) {
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, r.range(4, 11), 5),
        new THREE.MeshStandardMaterial({ color: 0x606876, roughness: 0.7 }),
      );
      mast.position.set(x, h + 3.5, z);
      this.buildingGroup.add(mast);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xff5b5b }),
      );
      bulb.position.set(x, h + 8.2, z);
      this.buildingGroup.add(bulb);
    }

    const entry = { x, z, w, d, h, mesh };
    this.buildings.push(entry);

    // neon sign on one street-facing side
    if (r.chance(0.34)) {
      const colorHex = r.pick(neonColors);
      const side = r.int(0, 3);
      const sw = r.range(3.5, Math.min(w, d) * 0.7);
      const sh = r.range(1.1, 2.4);
      const signGeo = new THREE.PlaneGeometry(sw, sh);
      const signMat = new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
      });
      const sign = new THREE.Mesh(signGeo, signMat);
      const sy = r.range(Math.min(9, h * 0.5), Math.max(10, h - 4));
      const off = 0.12;
      if (side === 0) {
        sign.position.set(x, sy, z + d / 2 + off);
      } else if (side === 1) {
        sign.position.set(x, sy, z - d / 2 - off);
        sign.rotation.y = Math.PI;
      } else if (side === 2) {
        sign.position.set(x + w / 2 + off, sy, z);
        sign.rotation.y = Math.PI / 2;
      } else {
        sign.position.set(x - w / 2 - off, sy, z);
        sign.rotation.y = -Math.PI / 2;
      }
      this.buildingGroup.add(sign);

      const halo = new THREE.Mesh(
        new THREE.PlaneGeometry(sw * 1.8, sh * 4.2),
        new THREE.MeshBasicMaterial({
          map: signTex[0],
          color: colorHex,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      halo.position.copy(sign.position);
      halo.rotation.copy(sign.rotation);
      halo.position.y += 0;
      this.buildingGroup.add(halo);
      this.glows.neon.push({ mat: signMat, base: 0.95 });
      this.glows.neon.push({ mat: halo.material, base: 0.5 });
    }

    // a warm storefront strip at street level
    if (r.chance(0.5)) {
      const side = r.int(0, 3);
      const sw = Math.min(w, d) * r.range(0.4, 0.85);
      const shop = new THREE.Mesh(
        new THREE.PlaneGeometry(sw, 2.4),
        new THREE.MeshBasicMaterial({
          color: r.chance(0.55) ? 0xffc074 : 0x9ff2e4,
          transparent: true,
          opacity: 0.8,
          side: THREE.DoubleSide,
        }),
      );
      const off = 0.1;
      const yy = 1.5;
      if (side === 0) shop.position.set(x, yy, z + d / 2 + off);
      else if (side === 1) {
        shop.position.set(x, yy, z - d / 2 - off);
        shop.rotation.y = Math.PI;
      } else if (side === 2) {
        shop.position.set(x + w / 2 + off, yy, z);
        shop.rotation.y = Math.PI / 2;
      } else {
        shop.position.set(x - w / 2 - off, yy, z);
        shop.rotation.y = -Math.PI / 2;
      }
      this.buildingGroup.add(shop);
      this.glows.shop.push({ mat: shop.material, base: 0.8 });
    }
  }

  // ---------- props ----------

  buildProps() {
    this.propGroup = new THREE.Group();
    this.root.add(this.propGroup);
    const r = this.rand;

    // street lamps along the roads, alternating sides
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.8, metalness: 0.4 });
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const halo = glowTexture('rgba(255,214,150,0.85)', 'rgba(255,180,110,0)');
    const poolTex = glowTexture('rgba(255,200,140,0.7)', 'rgba(255,180,110,0)');
    let lampCount = 0;
    for (let i = 0; i < ROADS.length; i++) {
      for (let j = 0; j < ROADS.length; j++) {
        if ((i + j) % 2 !== 0) continue;
        const rx = ROADS[i];
        const rz = ROADS[j];
        for (const [dx, dz] of [
          [0, 1],
          [1, 0],
        ]) {
          if (r.chance(0.45)) continue;
          const off = CITY.roadWidth / 2 + 1.4;
          const x = rx + (dx ? off : 0) + r.range(-1, 1);
          const z = rz + (dz ? off : 0) + r.range(-1, 1);
          if (x > CITY.waterX - 8) continue;
          if (this.isBlocked(x, z, 1.2)) continue;
          const grp = new THREE.Group();
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 8.2, 6), lampMat);
          pole.position.y = 4.1;
          grp.add(pole);
          const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.16), lampMat);
          arm.position.set(dz ? 0.7 : 0, 8.1, dz ? 0 : 0.7);
          arm.rotation.y = dz ? 0 : Math.PI / 2;
          grp.add(arm);
          const head = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.22, 0.44), headMat);
          head.position.set(dz ? 1.3 : 0, 8.0, dz ? 0 : 1.3);
          grp.add(head);
          grp.position.set(x, 0, z);
          this.propGroup.add(grp);

          const sp = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: halo,
              color: 0xffcf96,
              transparent: true,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              opacity: 0.55,
            }),
          );
          sp.position.set(x + (dz ? 1.3 : 0), 8.0, z + (dz ? 0 : 1.3));
          sp.scale.setScalar(5.5);
          this.propGroup.add(sp);
          this.glows.lamp.push({ mat: sp.material, base: 0.55 });

          const pool = new THREE.Mesh(
            new THREE.PlaneGeometry(13, 13),
            new THREE.MeshBasicMaterial({
              map: poolTex,
              color: 0xffc488,
              transparent: true,
              opacity: 0.3,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          );
          pool.rotation.x = -Math.PI / 2;
          pool.position.set(x + (dz ? 1.3 : 0), 0.06, z + (dz ? 0 : 1.3));
          this.propGroup.add(pool);
          this.glows.pool.push({ mat: pool.material, base: 0.3 });
          lampCount++;
        }
      }
    }
    this.lampCount = lampCount;

    // hydrants, crates and palms
    const hydrantMat = new THREE.MeshStandardMaterial({ color: 0xb6322c, roughness: 0.7 });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x8a6a3c, roughness: 0.9 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.95 });
    const frondMat = new THREE.MeshStandardMaterial({
      color: 0x2c6b4a,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });

    let hydrants = 0;
    for (let i = 0; i < 240 && hydrants < 26; i++) {
      const p = this.randomSidewalkPoint();
      if (!p) continue;
      if (this.props.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 9)) continue;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 1.0, 8), hydrantMat);
      m.position.set(p.x, 0.5, p.z);
      this.propGroup.add(m);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), hydrantMat);
      cap.position.set(p.x, 1.02, p.z);
      this.propGroup.add(cap);
      this.props.push({ x: p.x, z: p.z, r: 0.6, kind: 'hydrant', mesh: m });
      hydrants++;
    }

    let crates = 0;
    for (let i = 0; i < 300 && crates < 34; i++) {
      const p = this.randomSidewalkPoint();
      if (!p) continue;
      if (this.isBlocked(p.x, p.z, 1)) continue;
      const sz = r.range(0.8, 1.5);
      const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), crateMat);
      m.position.set(p.x, sz / 2, p.z);
      m.rotation.y = r.range(0, Math.PI);
      this.propGroup.add(m);
      this.props.push({ x: p.x, z: p.z, r: sz * 0.7, kind: 'crate', mesh: m, knockable: true, sz });
      crates++;
    }

    let palms = 0;
    for (let i = 0; i < 300 && palms < 30; i++) {
      const p = this.randomSidewalkPoint(palms % 3 === 0 ? 'waterfront' : 'any');
      if (!p) continue;
      if (this.isBlocked(p.x, p.z, 1.6)) continue;
      if (this.props.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 12)) continue;
      const g = new THREE.Group();
      const hgt = r.range(6, 9.5);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, hgt, 6), trunkMat);
      trunk.position.y = hgt / 2;
      trunk.rotation.z = r.range(-0.08, 0.08);
      g.add(trunk);
      for (let f = 0; f < 6; f++) {
        const frond = new THREE.Mesh(new THREE.ConeGeometry(1.1, 4.6, 4, 1, true), frondMat);
        frond.position.y = hgt + 0.4;
        frond.rotation.z = Math.PI / 2.4;
        frond.rotation.y = (f / 6) * Math.PI * 2 + r.range(-0.2, 0.2);
        frond.translateY(2.0);
        g.add(frond);
      }
      g.position.set(p.x, 0, p.z);
      g.rotation.y = r.range(0, Math.PI * 2);
      this.propGroup.add(g);
      this.props.push({ x: p.x, z: p.z, r: 0.8, kind: 'palm', mesh: g });
      palms++;
    }
    this.palmCount = palms;
  }

  randomSidewalkPoint(where) {
    const r = this.rand;
    for (let tries = 0; tries < 24; tries++) {
      const i = r.int(0, ROADS.length - 1);
      const j = r.int(0, CITY.blocks - 1);
      const rx = ROADS[i];
      const along = ROADS[j] + r.range(6, CITY.pitch - 6);
      const side = r.sign();
      const off = CITY.roadWidth / 2 + r.range(1.4, CITY.pavement - 0.8);
      let x;
      let z;
      if (r.chance(0.5)) {
        x = rx + side * off;
        z = along;
      } else {
        x = along;
        z = rx + side * off;
      }
      if (x > CITY.waterX - 10 || Math.abs(x) > CITY.bound - 12 || Math.abs(z) > CITY.bound - 12) continue;
      if (where === 'waterfront' && x < 240) continue;
      if (where === 'any' && r.chance(0.35)) continue;
      return { x, z };
    }
    return null;
  }

  // ---------- queries ----------

  isBlocked(x, z, pad = 0) {
    for (const b of this.buildings) {
      if (
        Math.abs(x - b.x) < b.w / 2 + pad &&
        Math.abs(z - b.z) < b.d / 2 + pad
      ) {
        return true;
      }
    }
    for (const p of this.props) {
      if (p.knockable && p.knocked) continue;
      if (Math.hypot(x - p.x, z - p.z) < p.r + pad) return true;
    }
    if (x > CITY.seaWall - 1.4) return true;
    if (Math.abs(x) > CITY.bound + 6 || Math.abs(z) > CITY.bound + 6) return true;
    return false;
  }

  // Push a circle out of solid things; returns the corrected position.
  resolveCircle(x, z, radius) {
    let px = x;
    let pz = z;
    let hit = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const b of this.buildings) {
        const hw = b.w / 2 + radius;
        const hd = b.d / 2 + radius;
        const dx = px - b.x;
        const dz = pz - b.z;
        if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
          const ox = hw - Math.abs(dx);
          const oz = hd - Math.abs(dz);
          if (ox < oz) px += Math.sign(dx || 1) * ox;
          else pz += Math.sign(dz || 1) * oz;
          moved = true;
          hit = true;
        }
      }
      for (const p of this.props) {
        if (p.knockable && p.knocked) continue;
        const dx = px - p.x;
        const dz = pz - p.z;
        const d = Math.hypot(dx, dz);
        const want = p.r + radius;
        if (d < want && d > 0.0001) {
          px += (dx / d) * (want - d);
          pz += (dz / d) * (want - d);
          moved = true;
          hit = true;
        }
      }
      if (!moved) break;
    }
    if (px > CITY.seaWall - radius) px = CITY.seaWall - radius;
    const lim = CITY.bound + 4;
    px = clamp(px, -lim, lim);
    pz = clamp(pz, -lim, lim);
    return { x: px, z: pz, hit };
  }

  // A knockable crate tips over and stops blocking anything.
  knockProp(p) {
    if (!p || !p.knockable || p.knocked) return;
    p.knocked = true;
    if (p.mesh) {
      p.mesh.rotation.z = Math.PI / 2.2;
      p.mesh.rotation.x = (Math.random() - 0.5) * 0.5;
      p.mesh.position.y = (p.sz || 1) * 0.3;
    }
  }

  // A free kerbside spot near a point, for traffic spawning and the shot staging.
  findParkingSpot(nearX = 0, nearZ = 0, rand = this.rand) {
    let best = null;
    let bestD = Infinity;
    for (let tries = 0; tries < 90; tries++) {
      const i = rand.int(0, ROADS.length - 1);
      const rx = ROADS[i];
      const along = rand.range(-CITY.bound + 20, CITY.bound - 20);
      const side = rand.sign();
      const off = CITY.roadWidth / 2 + 1.6;
      const horiz = rand.chance(0.5);
      const x = horiz ? along : rx + side * off;
      const z = horiz ? rx + side * off : along;
      if (x > CITY.waterX - 14) continue;
      if (this.isBlocked(x, z, 2.4)) continue;
      const heading = horiz ? (side > 0 ? Math.PI : 0) : side > 0 ? -Math.PI / 2 : Math.PI / 2;
      const d = Math.hypot(x - nearX, z - nearZ);
      if (d < bestD) {
        bestD = d;
        best = { x, z, heading };
      }
      if (bestD < 26) break;
    }
    return best || { x: nearX + 6, z: nearZ, heading: 0 };
  }

  nearestRoad(x, z) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < ROADS.length; i++) {
      const d = Math.abs(ROADS[i] - z);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    let ci = 0;
    let cd = Infinity;
    for (let i = 0; i < ROADS.length; i++) {
      const d = Math.abs(ROADS[i] - x);
      if (d < cd) {
        cd = d;
        ci = i;
      }
    }
    const horiz = bd <= cd;
    return {
      road: horiz ? ROADS[bi] : ROADS[ci],
      along: horiz ? x : z,
      offset: horiz ? z - ROADS[bi] : x - ROADS[ci],
      horiz,
      roadIndex: horiz ? bi : ci,
      dist: Math.min(bd, cd),
    };
  }

  // ---------- time of day ----------

  setTimeOfDay(minutes) {
    this.minutes = ((minutes % 1440) + 1440) % 1440;
    const h = this.minutes / 60;
    // keyframes through the day; the city is authored for dusk but reads at any hour
    const keys = [
      { t: 0, top: 0x080d1e, mid: 0x111a33, hor: 0x1d2b45, sun: 0.10, hemi: 0.22, amb: 0.14, fog: 0x121a2c, exp: 1.55, stars: 1, sunCol: 0x6f8dd0 },
      { t: 4.5, top: 0x0c1226, mid: 0x1a2440, hor: 0x2a3555, sun: 0.14, hemi: 0.25, amb: 0.16, fog: 0x18203a, exp: 1.55, stars: 0.8, sunCol: 0x7d94c8 },
      { t: 6.2, top: 0x24365e, mid: 0x5a5a7e, hor: 0xd88a5e, sun: 0.7, hemi: 0.45, amb: 0.24, fog: 0x4a4a68, exp: 1.5, stars: 0.1, sunCol: 0xffa06a },
      { t: 9, top: 0x3a5a92, mid: 0x7d94bb, hor: 0xcdc3b4, sun: 1.05, hemi: 0.65, amb: 0.3, fog: 0x8b97a8, exp: 1.45, stars: 0, sunCol: 0xffe2bb },
      { t: 13, top: 0x3f63a0, mid: 0x8ea6c6, hor: 0xd9d4c8, sun: 1.2, hemi: 0.72, amb: 0.32, fog: 0x9aa6b4, exp: 1.42, stars: 0, sunCol: 0xfff3de },
      { t: 17.5, top: 0x2b3f74, mid: 0x8c6a86, hor: 0xf0a066, sun: 1.05, hemi: 0.5, amb: 0.26, fog: 0x6e5a6a, exp: 1.45, stars: 0, sunCol: 0xffb476 },
      { t: 19.7, top: 0x18244a, mid: 0x2e3d6c, hor: 0xe8864a, sun: 0.85, hemi: 0.42, amb: 0.24, fog: 0x28324e, exp: 1.5, stars: 0.12, sunCol: 0xff9a5a },
      { t: 21, top: 0x0d1630, mid: 0x172343, hor: 0x4a3a55, sun: 0.22, hemi: 0.3, amb: 0.18, fog: 0x1a2338, exp: 1.55, stars: 0.7, sunCol: 0x8a7ab0 },
      { t: 23, top: 0x080d1e, mid: 0x111a33, hor: 0x22304a, sun: 0.12, hemi: 0.24, amb: 0.15, fog: 0x141c2f, exp: 1.55, stars: 1, sunCol: 0x7a90c8 },
      { t: 24, top: 0x080d1e, mid: 0x111a33, hor: 0x1d2b45, sun: 0.10, hemi: 0.22, amb: 0.14, fog: 0x121a2c, exp: 1.55, stars: 1, sunCol: 0x6f8dd0 },
    ];
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (h >= keys[i].t && h <= keys[i + 1].t) {
        a = keys[i];
        b = keys[i + 1];
        break;
      }
    }
    const span = Math.max(0.001, b.t - a.t);
    const k = clamp((h - a.t) / span, 0, 1);
    const mix = (ka, kb) => new THREE.Color(ka).lerp(new THREE.Color(kb), k);
    const num = (ka, kb) => ka + (kb - ka) * k;

    this.skyUniforms.topColor.value.copy(mix(a.top, b.top));
    this.skyUniforms.midColor.value.copy(mix(a.mid, b.mid));
    this.skyUniforms.horizonColor.value.copy(mix(a.hor, b.hor));
    this.skyUniforms.glowColor.value.copy(mix(a.hor, b.hor)).lerp(new THREE.Color(0xffd2a0), 0.3);
    this.skyUniforms.starStrength.value = num(a.stars, b.stars);
    this.sunLight.intensity = num(a.sun, b.sun) * this.sunBoost;
    this.sunLight.color.copy(mix(a.sunCol, b.sunCol));
    this.hemi.intensity = num(a.hemi, b.hemi) * this.lightBoost;
    this.ambient.intensity = num(a.amb, b.amb) * this.lightBoost;
    const fogCol = mix(a.fog, b.fog);
    if (this.scene.fog) this.scene.fog.color.copy(fogCol);
    else this.scene.fog = new THREE.Fog(fogCol.getHex(), 90, 520);
    this.scene.fog.color.copy(fogCol);
    this.renderExposure = num(a.exp, b.exp) * this.exposureBoost;
    this.skyUniforms.sunStrength.value = clamp(num(a.sun, b.sun) * 1.4, 0, 1.6);

    // move the sun with the clock
    const sunAngle = ((h / 24) * Math.PI * 2 - Math.PI / 2) * -1;
    const elev = Math.sin(((h - 6) / 12) * Math.PI);
    this.sunLight.position.set(Math.cos(sunAngle) * 260, 30 + Math.max(0, elev) * 160, Math.sin(sunAngle) * 260);
    this.sun.position
      .copy(this.sunLight.position)
      .multiplyScalar(2.6)
      .setY(20 + Math.max(0.02, elev) * 120);
    this.skyUniforms.sunDir.value.copy(this.sunLight.position).normalize();
    this.sun.visible = elev > -0.12;
    const night = this.nightness();
    this.rimLight.intensity = 0.25 + night * 0.55;
    this.water.material.emissiveIntensity = 0.5 + night * 1.2;
    this.applyGlow();
  }

  get lightBoost() {
    return this._lightBoost || 1;
  }

  get sunBoost() {
    return this._sunBoost || 1;
  }

  get exposureBoost() {
    return this._exposureBoost || 1;
  }

  // 0 in daylight, 1 at deep night
  nightness() {
    const h = this.minutes / 60;
    if (h >= 20.5 || h < 5.5) return 1;
    if (h >= 18.5) return (h - 18.5) / 2;
    if (h < 7) return 1 - (h - 5.5) / 1.5;
    return 0;
  }

  // Night staging raises every baked glow so the frame reads bright, not murky.
  setGlow(scale) {
    this.glowScale = scale;
    this.applyGlow();
  }

  applyGlow() {
    const night = this.nightness();
    const s = this.glowScale * (0.45 + night * 0.9);
    for (const key of Object.keys(this.glows)) {
      for (const g of this.glows[key]) {
        if (!g.mat) continue;
        g.mat.opacity = clamp(g.base * s, 0, 1);
      }
    }
    for (const b of this.buildings) {
      if (b.mesh && b.mesh.material) {
        b.mesh.material.emissiveIntensity = 0.55 + night * 0.55 + (this.glowScale - 1) * 0.5;
      }
    }
    // the ground's own brick of light: faint by day, a wet sheen at night
    if (this.ground) {
      this.ground.material.emissiveIntensity = 0.05 + night * 0.42 + (this.glowScale - 1) * 0.22;
    }
  }

  // Brighter at night for the staged night frame: sky, fog, sun, lights, exposure and glow.
  liftForNight(amount = 1) {
    this._lightBoost = 1 + 0.75 * amount;
    this._sunBoost = 1 + 0.9 * amount;
    this._exposureBoost = 1 + 0.22 * amount;
    this.setGlow(1 + 1.15 * amount);
    this.skyUniforms.topColor.value.lerp(new THREE.Color(0x1b2a52), 0.35 * amount);
    this.skyUniforms.midColor.value.lerp(new THREE.Color(0x2b3d69), 0.35 * amount);
    if (this.scene.fog) this.scene.fog.color.lerp(new THREE.Color(0x33405e), 0.3 * amount);
    this.water.material.color.lerp(new THREE.Color(0x1a4055), 0.4 * amount);
    this.setTimeOfDay(this.minutes);
  }

  // A pool of warm light on the street, for staging a lamp-lit stretch.
  addStreetLampAt(x, z, warm = true) {
    if (!this.stageLights) {
      this.stageLights = new THREE.Group();
      this.root.add(this.stageLights);
    }
    const grp = new THREE.Group();
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.8, metalness: 0.4 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 8.2, 6), poleMat);
    pole.position.y = 4.1;
    grp.add(pole);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.22, 0.44),
      new THREE.MeshBasicMaterial({ color: warm ? 0xffd9a0 : 0xd8f0ff }),
    );
    head.position.y = 8.0;
    grp.add(head);
    grp.position.set(x, 0, z);
    this.stageLights.add(grp);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture('rgba(255,220,160,0.9)', 'rgba(255,180,110,0)'),
        color: warm ? 0xffd2a0 : 0xd8f0ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.75,
      }),
    );
    halo.scale.setScalar(7.5);
    halo.position.set(x, 8.0, z);
    this.stageLights.add(halo);

    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(19, 19),
      new THREE.MeshBasicMaterial({
        map: glowTexture('rgba(255,205,150,0.65)', 'rgba(255,180,110,0)'),
        color: warm ? 0xffc98c : 0xbcd8f0,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.4,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(x, 0.07, z);
    this.stageLights.add(pool);

    const light = new THREE.PointLight(warm ? 0xffb877 : 0xa8d0ff, 150, 38, 2);
    light.position.set(x, 7.4, z);
    this.stageLights.add(light);
    return grp;
  }

  clearStageLights() {
    if (!this.stageLights) return;
    for (const child of [...this.stageLights.children]) {
      if (child.geometry) child.geometry.dispose();
      if (child.material && child.material.dispose) child.material.dispose();
    }
    this.root.remove(this.stageLights);
    this.stageLights = null;
  }

  resetLift() {
    this._lightBoost = 1;
    this._sunBoost = 1;
    this._exposureBoost = 1;
    this.glowScale = 1;
    this.setTimeOfDay(this.minutes);
  }

  step(dt, minutes) {
    if (minutes !== undefined) this.setTimeOfDay(minutes);
    // the water breathes a little
    this.waterStreaks.position.x = Math.sin(performance.now() * 0.0002) * 2;
  }

  // A deterministic dump of the layout, for the determinism check.
  layoutHash() {
    let h = 0;
    for (const b of this.buildings) {
      h = (h * 31 + Math.round(b.x * 100) * 7 + Math.round(b.z * 100) * 13 + Math.round(b.h * 10)) | 0;
    }
    return h >>> 0;
  }
}

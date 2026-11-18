// Deterministic pseudo-random numbers.
// The whole city is rebuilt from a seed string, so the same seed must give the same city
// on every machine: mulberry32 over a hashed 32-bit key. No Math.random anywhere in the
// generator path.

export function hashSeed(seed) {
  const text = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Mix once more so neighbouring seeds land far apart.
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

export class Rng {
  constructor(seed) {
    this.state = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min, max) {
    return min + this.next() * (max - min);
  }

  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }

  chance(probability) {
    return this.next() < probability;
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}

// A small helper for smooth value noise in one dimension (used by the sky and lamps).
export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

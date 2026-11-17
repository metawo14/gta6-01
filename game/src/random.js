// Deterministic PRNG. Every layout decision in the city goes through one of these,
// so a seed always rebuilds the same Port Meridian.
export class Rng {
  constructor(seed = 1) {
    this.state = (seed >>> 0) || 1;
  }

  next() {
    let x = this.state;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.state = x || 1;
    return this.state / 4294967296;
  }

  range(a, b) {
    return a + this.next() * (b - a);
  }

  int(a, b) {
    return Math.floor(this.range(a, b + 1));
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length) % list.length];
  }

  chance(p) {
    return this.next() < p;
  }

  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
}

export function seedFromQuery(defaultSeed = 7) {
  const param = new URLSearchParams(location.search).get('seed');
  const parsed = Number.parseInt(param ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultSeed;
}

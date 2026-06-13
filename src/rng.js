// Seedable PRNG + sampling helpers. Deterministic given the same seed so that
// a configuration is fully reproducible (the seed box in the UI).

/** mulberry32: tiny, fast, decent-quality 32-bit seeded generator. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wraps a uniform() generator with common distributions/utilities. */
export class RNG {
  constructor(seed = 0) {
    this.uniform = mulberry32(seed);
    this._spare = null;
  }

  /** Standard normal via Box-Muller (caches the spare deviate). */
  gaussian(mean = 0, std = 1) {
    if (this._spare !== null) {
      const v = this._spare;
      this._spare = null;
      return mean + std * v;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this.uniform() * 2 - 1;
      v = this.uniform() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this._spare = v * mul;
    return mean + std * (u * mul);
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.uniform() * n);
  }

  /** In-place Fisher-Yates shuffle of an array. Returns the array. */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** A fresh permutation of [0..n). */
  permutation(n) {
    const a = Array.from({ length: n }, (_, i) => i);
    return this.shuffle(a);
  }

  /**
   * Weighted choice over indices given a probability array `p` (must sum to 1).
   * Linear scan — fine for the sizes here.
   */
  choiceWeighted(p) {
    const r = this.uniform();
    let acc = 0;
    for (let i = 0; i < p.length; i++) {
      acc += p[i];
      if (r <= acc) return i;
    }
    return p.length - 1;
  }
}

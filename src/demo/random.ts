/** A small seeded random number generator (mulberry32), so a demo seed always builds the same history. */
export class Random {
  private state: number;
  private spareNormal: number | null = null;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). */
  random(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** A whole number from a to b, both included. */
  randint(a: number, b: number): number {
    return a + Math.floor(this.random() * (b - a + 1));
  }

  pick<T>(items: T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }

  shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }

  /** Normally distributed (Box-Muller). */
  normal(mu: number, sigma: number): number {
    if (this.spareNormal !== null) {
      const z = this.spareNormal;
      this.spareNormal = null;
      return mu + sigma * z;
    }
    const u = 1 - this.random();
    const v = this.random();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spareNormal = r * Math.sin(2 * Math.PI * v);
    return mu + sigma * r * Math.cos(2 * Math.PI * v);
  }

  lognormal(mu: number, sigma: number): number {
    return Math.exp(this.normal(mu, sigma));
  }
}

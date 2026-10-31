/** Seeded generator (mulberry32): the same seed always produces the same scenario. */
export class Rng {
  private state: number;

  constructor(readonly seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() over an empty list');
    return items[Math.floor(this.next() * items.length)] as T;
  }

  /** A money string with two decimals in [min, max] whole units. */
  money(min: number, max: number): string {
    return `${this.int(min, max)}.${String(this.int(0, 99)).padStart(2, '0')}`;
  }
}

import type { ClockPort } from '../../../src/shared/application/ports/clock.port';

/** Clock frozen at a settable instant. */
export class FixedClock implements ClockPort {
  private current: Date;

  constructor(initial: Date | string = '2026-01-15T12:00:00.000Z') {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date | string): void {
    this.current = new Date(instant);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

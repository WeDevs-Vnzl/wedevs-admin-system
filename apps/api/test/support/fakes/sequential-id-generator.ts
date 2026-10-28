import type { IdGeneratorPort } from '../../../src/shared/application/ports/id-generator.port';

/** Deterministic ids: `id_1`, `id_2`, … */
export class SequentialIdGenerator implements IdGeneratorPort {
  private counter = 0;

  constructor(private readonly prefix: string = 'id') {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}_${this.counter}`;
  }
}

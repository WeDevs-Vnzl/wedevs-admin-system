import { createId } from '@paralleldrive/cuid2';
import { Injectable } from '@nestjs/common';
import type { IdGeneratorPort } from '../application/ports/id-generator.port';

/** CUID2 ids (Q-BE0-1, DT-97). */
@Injectable()
export class CuidGenerator implements IdGeneratorPort {
  next(): string {
    return createId();
  }
}

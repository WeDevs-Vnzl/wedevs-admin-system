import { Injectable } from '@nestjs/common';
import {
  SEQUENCE_NAMES,
  type SequenceName,
  type SequencePort,
} from '../../application/ports/sequence.port';
import { TransactionHost } from './transaction-host';

const PAD = 4;

/**
 * `UPDATE "Sequence" SET value = value + 1 ... RETURNING value` inside the current transaction
 * (data-rules.md §5). The row lock serializes concurrent allocators; a rollback consumes nothing.
 */
@Injectable()
export class PrismaSequence implements SequencePort {
  constructor(private readonly host: TransactionHost) {}

  async next(name: SequenceName): Promise<string> {
    const tx = this.host.requireTransaction('SequencePort.next');
    if (!SEQUENCE_NAMES.includes(name)) throw new Error(`Unknown sequence: ${String(name)}`);
    const rows = await tx.$queryRaw<{ value: number }[]>`
      UPDATE "Sequence" SET value = value + 1 WHERE name = ${name} RETURNING value`;
    const row = rows[0];
    if (!row) throw new Error(`Sequence row missing: ${name}`);
    return `${name}-${String(row.value).padStart(PAD, '0')}`;
  }
}

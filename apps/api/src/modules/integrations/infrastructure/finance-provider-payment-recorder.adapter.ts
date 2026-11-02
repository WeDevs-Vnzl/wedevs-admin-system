import { Injectable } from '@nestjs/common';
import { SYSTEM_ACTOR } from '../../../shared/application/actor';
import { RecordProviderPayment } from '../../finance/application/use-cases/payments/record-provider-payment.use-case';
// eslint-disable-next-line no-restricted-imports -- Rule (i) matches the folder name `stripe/`; this is our own port, not the SDK
import type {
  ProviderPaymentRecordingPort,
  RecordProviderPaymentCommand,
  RecordProviderPaymentOutcome,
} from '../application/use-cases/stripe/provider-payment-recording.port';

/**
 * `ProviderPaymentRecordingPort` over finance's exported `RecordProviderPayment` (DT-110, rule (e)). Finance owns
 * the money mutation, the locks and the event row (C17, C18); this adapter only runs it as the `SYSTEM` actor and
 * hands back its four outcomes unchanged, so the webhook can tell a duplicate from a parked event.
 */
@Injectable()
export class FinanceProviderPaymentRecorder implements ProviderPaymentRecordingPort {
  constructor(private readonly recordPayment: RecordProviderPayment) {}

  async record(command: RecordProviderPaymentCommand): Promise<RecordProviderPaymentOutcome> {
    return this.recordPayment.execute(SYSTEM_ACTOR, command);
  }
}

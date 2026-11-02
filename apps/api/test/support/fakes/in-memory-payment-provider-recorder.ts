import type {
  ProviderPaymentRecorderPort,
  RecordProviderPaymentInput,
  RecordedProviderPayment,
} from '../../../src/modules/integrations/application/ports/provider-payment-recorder.port';

/** Fake `ProviderPaymentRecorderPort`: unique per `(provider, externalId)`, keeps what it was given. */
export class InMemoryPaymentProviderRecorder implements ProviderPaymentRecorderPort {
  readonly recorded: Array<RecordProviderPaymentInput & { paymentId: string }> = [];

  async record(input: RecordProviderPaymentInput): Promise<RecordedProviderPayment> {
    const existing = this.recorded.find(
      (r) => r.provider === input.provider && r.externalId === input.externalId,
    );
    if (existing) return { paymentId: existing.paymentId, created: false };
    const paymentId = `pay-fake-${this.recorded.length + 1}`;
    this.recorded.push({ ...input, paymentId });
    return { paymentId, created: true };
  }
}

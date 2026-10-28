import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { HealthProbePort } from '../ports/health-probe.port';

export interface HealthOutput {
  readonly status: 'ok';
  readonly database: 'up';
  readonly time: string;
}

/**
 * Public liveness/readiness query. It has no actor: the documented exemption from `can()` of
 * `api-contract.md` §5. A database failure propagates and leaves as a 500 `INTERNAL` envelope.
 */
export class GetHealth {
  constructor(
    private readonly probe: HealthProbePort,
    private readonly clock: ClockPort,
  ) {}

  async execute(): Promise<HealthOutput> {
    await this.probe.checkDatabase();
    return { status: 'ok', database: 'up', time: this.clock.now().toISOString() };
  }
}

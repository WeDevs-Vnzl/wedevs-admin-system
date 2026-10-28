import type { LoginActivityRepository } from '../../../src/modules/identity/application/ports/login-activity.repository.port';
import type { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';

/** Reads the committed `LOGIN` entries of the in-memory activity log. */
export class InMemoryLoginActivityRepository implements LoginActivityRepository {
  constructor(private readonly log: InMemoryActivityLog) {}

  existsForEvent(svixId: string): Promise<boolean> {
    return Promise.resolve(
      this.log.entries.some((e) => e.action === 'LOGIN' && e.metadata?.svixId === svixId),
    );
  }
}

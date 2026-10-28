/** Checks that the database answers. Throws when it is unreachable. */
export interface HealthProbePort {
  checkDatabase(): Promise<void>;
}

export const HEALTH_PROBE = Symbol('HEALTH_PROBE');

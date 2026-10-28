export const LOGIN_ACTIVITY_REPOSITORY = Symbol('LOGIN_ACTIVITY_REPOSITORY');

/** Read side of the `LOGIN` activity entries the webhook writes (Q-BE1-1 idempotency). */
export interface LoginActivityRepository {
  /**
   * Whether a `LOGIN` entry carrying `metadata.svixId = svixId` exists. Valid only inside
   * `UnitOfWorkPort.run`: it serializes concurrent calls for the same id, so check-then-write is atomic.
   */
  existsForEvent(svixId: string): Promise<boolean>;
}

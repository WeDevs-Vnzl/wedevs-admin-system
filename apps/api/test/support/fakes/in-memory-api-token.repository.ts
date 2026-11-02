import type {
  ApiTokenOwner,
  ApiTokenRecord,
  ApiTokenRepository,
  ApiTokenWithOwner,
} from '../../../src/modules/identity/application/ports/api-token.repository.port';

/** Fake `ApiTokenRepository`. Owners are seeded separately, as the adapter joins the `User` row. */
export class InMemoryApiTokenRepository implements ApiTokenRepository {
  private rows: ApiTokenRecord[] = [];
  private readonly owners = new Map<string, ApiTokenOwner>();
  /** Number of `touchLastUsed` calls that actually wrote. */
  touchWrites = 0;

  seedOwner(owner: ApiTokenOwner): void {
    this.owners.set(owner.id, owner);
  }

  all(): readonly ApiTokenRecord[] {
    return this.rows;
  }

  async insert(token: ApiTokenRecord): Promise<void> {
    this.rows.push(token);
  }

  async countActive(userId: string, now: Date): Promise<number> {
    return this.rows.filter(
      (r) => r.userId === userId && r.revokedAt === null && r.expiresAt.getTime() > now.getTime(),
    ).length;
  }

  async listByUser(userId: string): Promise<ApiTokenRecord[]> {
    return this.rows
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  }

  async findOwned(id: string, userId: string): Promise<ApiTokenRecord | null> {
    return this.rows.find((r) => r.id === id && r.userId === userId) ?? null;
  }

  async revoke(id: string, now: Date): Promise<void> {
    this.patch(id, { revokedAt: now });
  }

  async findByHash(tokenHash: string): Promise<ApiTokenWithOwner | null> {
    const token = this.rows.find((r) => r.tokenHash === tokenHash);
    const owner = token ? this.owners.get(token.userId) : undefined;
    return token && owner ? { token, owner } : null;
  }

  async touchLastUsed(id: string, now: Date, staleBefore: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || (row.lastUsedAt !== null && row.lastUsedAt.getTime() > staleBefore.getTime())) {
      return;
    }
    this.touchWrites += 1;
    this.patch(id, { lastUsedAt: now });
  }

  private patch(id: string, patch: Partial<ApiTokenRecord>): void {
    this.rows = this.rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
  }
}

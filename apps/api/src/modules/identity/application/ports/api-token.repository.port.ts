import type { UserRole } from '../../../../shared/domain/enums';

export const API_TOKEN_REPOSITORY = Symbol('API_TOKEN_REPOSITORY');

/** A personal access token row (Δ19). `tokenHash` is the hex SHA-256 of the secret; the secret is never stored. */
export interface ApiTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  /** First 12 characters of the secret, kept for display. */
  readonly prefix: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly createdAt: Date;
}

/** The owner of a token as the authenticator needs it; `deletedAt` set means archived. */
export interface ApiTokenOwner {
  readonly id: string;
  readonly clerkId: string;
  readonly role: UserRole;
  readonly email: string;
  readonly name: string;
  readonly deletedAt: Date | null;
}

export interface ApiTokenWithOwner {
  readonly token: ApiTokenRecord;
  readonly owner: ApiTokenOwner;
}

/** Persistence of personal access tokens. Every list or lookup by owner is scoped by `userId`. */
export interface ApiTokenRepository {
  insert(token: ApiTokenRecord): Promise<void>;
  /** Tokens of `userId` that are neither revoked nor expired at `now`. */
  countActive(userId: string, now: Date): Promise<number>;
  /** Newest first. */
  listByUser(userId: string): Promise<ApiTokenRecord[]>;
  findOwned(id: string, userId: string): Promise<ApiTokenRecord | null>;
  revoke(id: string, now: Date): Promise<void>;
  findByHash(tokenHash: string): Promise<ApiTokenWithOwner | null>;
  /** Sets `lastUsedAt = now` only when it is null or not newer than `staleBefore` (one write per minute at most). */
  touchLastUsed(id: string, now: Date, staleBefore: Date): Promise<void>;
}

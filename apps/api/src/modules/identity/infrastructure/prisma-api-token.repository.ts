import { Injectable } from '@nestjs/common';
import type {
  ApiTokenRecord,
  ApiTokenRepository,
  ApiTokenWithOwner,
} from '../application/ports/api-token.repository.port';
import type { UserRole } from '../../../shared/domain/enums';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

interface ApiTokenRow {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

function toRecord(row: ApiTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    prefix: row.prefix,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaApiTokenRepository implements ApiTokenRepository {
  constructor(private readonly tx: TransactionHost) {}

  async insert(token: ApiTokenRecord): Promise<void> {
    await this.tx.db.apiToken.create({ data: { ...token } });
  }

  countActive(userId: string, now: Date): Promise<number> {
    return this.tx.db.apiToken.count({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
    });
  }

  async listByUser(userId: string): Promise<ApiTokenRecord[]> {
    const rows = await this.tx.db.apiToken.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toRecord);
  }

  async findOwned(id: string, userId: string): Promise<ApiTokenRecord | null> {
    const row = await this.tx.db.apiToken.findFirst({ where: { id, userId } });
    return row ? toRecord(row) : null;
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.tx.db.apiToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  async findByHash(tokenHash: string): Promise<ApiTokenWithOwner | null> {
    // The unique hash is the lookup key; the owner is joined with its deletion state, so an archived owner
    // is visible to the use case instead of being silently filtered.
    const row = await this.tx.db.apiToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!row) return null;
    const { user } = row;
    return {
      token: toRecord(row),
      owner: {
        id: user.id,
        clerkId: user.clerkId,
        role: user.role as UserRole,
        email: user.email,
        name: user.name,
        deletedAt: user.deletedAt,
      },
    };
  }

  async touchLastUsed(id: string, now: Date, staleBefore: Date): Promise<void> {
    await this.tx.db.apiToken.updateMany({
      where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: staleBefore } }] },
      data: { lastUsedAt: now },
    });
  }
}

import { Injectable } from '@nestjs/common';
import type {
  NewUser,
  UserProfileUpdate,
  UserRepository,
} from '../application/ports/user.repository.port';
import type { UserRecord } from '../domain/user';
import { USER_ROLE_VALUES, type UserRole } from '../../../shared/domain/enums';
import type { ListQuery } from '../../../shared/domain/list-query';
import type { Paginated } from '../../../shared/domain/pagination';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { listPage } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

interface UserRow {
  id: string;
  clerkId: string;
  email: string;
  name: string;
  imageUrl: string | null;
  role: string;
  locale: string;
  theme: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function toRecord(row: UserRow): UserRecord {
  return { ...row, role: row.role as UserRole };
}

const SORT_MAP = {
  name: 'name',
  email: 'email',
  role: 'role',
  createdAt: 'createdAt',
} as const;

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly tx: TransactionHost) {}

  async findActiveById(id: string): Promise<UserRecord | null> {
    // `findUnique` is not filtered by the soft-delete extension (C14): check `deletedAt` here.
    const row = await this.tx.db.user.findUnique({ where: { id } });
    return row && !row.deletedAt ? toRecord(row) : null;
  }

  async findActiveByClerkId(clerkId: string): Promise<UserRecord | null> {
    const row = await this.tx.db.user.findUnique({ where: { clerkId } });
    return row && !row.deletedAt ? toRecord(row) : null;
  }

  async findAnyByClerkId(clerkId: string): Promise<UserRecord | null> {
    const row = await this.tx.db.user.findUnique({ where: { clerkId } });
    return row ? toRecord(row) : null;
  }

  async findActiveByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.tx.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    return row ? toRecord(row) : null;
  }

  async findAnyByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.tx.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, deletedAt: undefined },
    });
    return row ? toRecord(row) : null;
  }

  countActiveOwners(): Promise<number> {
    return this.tx.db.user.count({ where: { role: 'OWNER' } });
  }

  async list(query: ListQuery): Promise<Paginated<UserRecord>> {
    const raw = query.filters.role;
    const roles = (raw === undefined ? [] : Array.isArray(raw) ? raw : [raw]).filter((role) =>
      (USER_ROLE_VALUES as readonly string[]).includes(role),
    );
    const db = this.tx.db;
    const page = await listPage(db, {
      table: 'User',
      searchColumns: ['name', 'email'],
      sortMap: SORT_MAP,
      defaultSort: { field: 'name', direction: 'asc' },
      ...(roles.length > 0
        ? {
            where: { role: { in: roles } },
            sqlWhere: Prisma.sql`"role"::text = ANY(${roles})`,
          }
        : {}),
      query,
      find: (args) =>
        db.user.findMany({
          where: args.where as Prisma.UserWhereInput,
          orderBy: args.orderBy as Prisma.UserOrderByWithRelationInput[],
          skip: args.skip,
          take: args.take,
        }),
      count: (args) => db.user.count({ where: args.where as Prisma.UserWhereInput }),
    });
    return { ...page, items: page.items.map(toRecord) };
  }

  async insert(user: NewUser): Promise<UserRecord> {
    const row = await this.tx.db.user.create({
      data: {
        id: user.id,
        clerkId: user.clerkId,
        email: user.email,
        name: user.name,
        imageUrl: user.imageUrl,
        role: user.role,
        createdAt: user.now,
        updatedAt: user.now,
      },
    });
    return toRecord(row);
  }

  async insertIfAbsent(user: NewUser): Promise<UserRecord | null> {
    // `ON CONFLICT DO NOTHING` (skipDuplicates) does not abort the surrounding transaction, unlike a
    // caught unique violation.
    const result = await this.tx.db.user.createMany({
      data: [
        {
          id: user.id,
          clerkId: user.clerkId,
          email: user.email,
          name: user.name,
          imageUrl: user.imageUrl,
          role: user.role,
          createdAt: user.now,
          updatedAt: user.now,
        },
      ],
      skipDuplicates: true,
    });
    if (result.count === 0) return null;
    return toRecord(await this.tx.db.user.findUniqueOrThrow({ where: { id: user.id } }));
  }

  async updateRole(id: string, role: UserRole, now: Date): Promise<UserRecord> {
    return toRecord(
      await this.tx.db.user.update({ where: { id }, data: { role, updatedAt: now } }),
    );
  }

  async updateProfile(id: string, update: UserProfileUpdate): Promise<UserRecord> {
    return toRecord(
      await this.tx.db.user.update({
        where: { id },
        data: {
          email: update.email,
          name: update.name,
          imageUrl: update.imageUrl,
          updatedAt: update.now,
        },
      }),
    );
  }

  async softDelete(id: string, now: Date): Promise<void> {
    await this.tx.db.user.update({ where: { id }, data: { deletedAt: now, updatedAt: now } });
  }
}

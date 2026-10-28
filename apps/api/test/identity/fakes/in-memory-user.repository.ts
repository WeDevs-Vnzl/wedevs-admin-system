import type {
  NewUser,
  UserProfileUpdate,
  UserRepository,
} from '../../../src/modules/identity/application/ports/user.repository.port';
import type { UserRecord } from '../../../src/modules/identity/domain/user';
import { USER_ROLE_VALUES, type UserRole } from '../../../src/shared/domain/enums';
import { foldText, type ListQuery } from '../../../src/shared/domain/list-query';
import { pageWindow, paginated, type Paginated } from '../../../src/shared/domain/pagination';

export function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  const base: UserRecord = {
    id: 'usr_1',
    clerkId: 'user_clerk_1',
    email: 'user1@example.com',
    name: 'User One',
    imageUrl: null,
    role: 'ADMIN',
    locale: 'es',
    theme: 'system',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };
  return { ...base, ...overrides };
}

type Sortable = 'name' | 'email' | 'role' | 'createdAt';

export class InMemoryUserRepository implements UserRepository {
  private rows: UserRecord[] = [];

  seed(...users: UserRecord[]): void {
    this.rows.push(...users);
  }

  /** Every row, deleted included. */
  all(): readonly UserRecord[] {
    return this.rows;
  }

  byId(id: string): UserRecord | undefined {
    return this.rows.find((row) => row.id === id);
  }

  findActiveById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.rows.find((r) => r.id === id && !r.deletedAt) ?? null);
  }

  findActiveByClerkId(clerkId: string): Promise<UserRecord | null> {
    return Promise.resolve(this.rows.find((r) => r.clerkId === clerkId && !r.deletedAt) ?? null);
  }

  findAnyByClerkId(clerkId: string): Promise<UserRecord | null> {
    return Promise.resolve(this.rows.find((r) => r.clerkId === clerkId) ?? null);
  }

  findActiveByEmail(email: string): Promise<UserRecord | null> {
    const wanted = email.toLowerCase();
    return Promise.resolve(
      this.rows.find((r) => r.email.toLowerCase() === wanted && !r.deletedAt) ?? null,
    );
  }

  findAnyByEmail(email: string): Promise<UserRecord | null> {
    const wanted = email.toLowerCase();
    return Promise.resolve(this.rows.find((r) => r.email.toLowerCase() === wanted) ?? null);
  }

  countActiveOwners(): Promise<number> {
    return Promise.resolve(this.rows.filter((r) => r.role === 'OWNER' && !r.deletedAt).length);
  }

  list(query: ListQuery): Promise<Paginated<UserRecord>> {
    let rows = this.rows.filter((r) =>
      query.archived === 'exclude'
        ? !r.deletedAt
        : query.archived === 'only'
          ? !!r.deletedAt
          : true,
    );
    const roles = query.filters.role;
    if (roles !== undefined) {
      const wanted = Array.isArray(roles) ? roles : [roles];
      rows = rows.filter((r) => wanted.includes(r.role));
    }
    if (query.q) {
      const needle = foldText(query.q);
      rows = rows.filter(
        (r) => foldText(r.name).includes(needle) || foldText(r.email).includes(needle),
      );
    }
    const sort = query.sort ?? { field: 'name', direction: 'asc' as const };
    const field = sort.field as Sortable;
    const sign = sort.direction === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const value = (user: UserRecord): string | number =>
        field === 'createdAt'
          ? user.createdAt.getTime()
          : field === 'role'
            ? USER_ROLE_VALUES.indexOf(user.role) // enum declaration order, as Postgres sorts it
            : user[field];
      const left = value(a);
      const right = value(b);
      if (left < right) return -sign;
      if (left > right) return sign;
      return a.id < b.id ? -1 : 1;
    });
    const { skip, take } = pageWindow(query.page, query.pageSize);
    return Promise.resolve(paginated(rows.slice(skip, skip + take), rows.length, query));
  }

  insertIfAbsent(user: NewUser): Promise<UserRecord | null> {
    const taken = this.rows.some(
      (row) => row.clerkId === user.clerkId || row.email.toLowerCase() === user.email.toLowerCase(),
    );
    return taken ? Promise.resolve(null) : this.insert(user);
  }

  insert(user: NewUser): Promise<UserRecord> {
    const row = makeUser({
      id: user.id,
      clerkId: user.clerkId,
      email: user.email,
      name: user.name,
      imageUrl: user.imageUrl,
      role: user.role,
      createdAt: user.now,
      updatedAt: user.now,
    });
    this.rows.push(row);
    return Promise.resolve(row);
  }

  updateRole(id: string, role: UserRole, now: Date): Promise<UserRecord> {
    return this.replace(id, { role, updatedAt: now });
  }

  updateProfile(id: string, update: UserProfileUpdate): Promise<UserRecord> {
    return this.replace(id, {
      email: update.email,
      name: update.name,
      imageUrl: update.imageUrl,
      updatedAt: update.now,
    });
  }

  async softDelete(id: string, now: Date): Promise<void> {
    await this.replace(id, { deletedAt: now, updatedAt: now });
  }

  private replace(id: string, patch: Partial<UserRecord>): Promise<UserRecord> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index < 0) return Promise.reject(new Error(`No user ${id}`));
    const next = { ...(this.rows[index] as UserRecord), ...patch };
    this.rows[index] = next;
    return Promise.resolve(next);
  }
}

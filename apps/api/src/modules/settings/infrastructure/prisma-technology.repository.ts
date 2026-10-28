import { Injectable } from '@nestjs/common';
import type { TechnologyRepository } from '../application/ports/technology.repository.port';
import {
  TECHNOLOGY_IN_USE_KEY,
  TECHNOLOGY_NAME_TAKEN_KEY,
  TECHNOLOGY_SLUG_TAKEN_KEY,
  type TechnologyRecord,
} from '../domain/technology';
import { ConflictError, IntegrityLockedError } from '../../../shared/domain/domain-error';
import type { TechCategory } from '../../../shared/domain/enums';
import { isUniqueViolation } from '../../../shared/infrastructure/prisma/unique-violation';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

/** Unique indexes of `Technology` (migration `init`): name and slug are unique, case-sensitively. */
const NAME_CONSTRAINT = 'Technology_name_key';
const SLUG_CONSTRAINT = 'Technology_slug_key';

interface TechnologyRow {
  id: string;
  name: string;
  nameEn: string | null;
  slug: string;
  category: TechCategory;
  iconSlug: string | null;
  color: string | null;
  active: boolean;
}

function toRecord(row: TechnologyRow): TechnologyRecord {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    slug: row.slug,
    category: row.category,
    iconSlug: row.iconSlug,
    color: row.color,
    active: row.active,
  };
}

function toValues(record: TechnologyRecord): Omit<TechnologyRecord, 'id'> {
  return {
    name: record.name,
    nameEn: record.nameEn,
    slug: record.slug,
    category: record.category,
    iconSlug: record.iconSlug,
    color: record.color,
    active: record.active,
  };
}

/** Maps a unique violation of a write to `ConflictError` naming the field; anything else passes through. */
function translateWriteError(error: unknown): unknown {
  if (isUniqueViolation(error, NAME_CONSTRAINT)) {
    return new ConflictError({ fieldErrors: { name: [TECHNOLOGY_NAME_TAKEN_KEY] } });
  }
  if (isUniqueViolation(error, SLUG_CONSTRAINT)) {
    return new ConflictError({ fieldErrors: { slug: [TECHNOLOGY_SLUG_TAKEN_KEY] } });
  }
  if (isUniqueViolation(error)) return new ConflictError();
  return error;
}

/** Postgres `23503` (foreign key violation) as Prisma or the driver adapter surfaces it. */
function isForeignKeyViolation(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 4) return false;
  const e = error as { code?: unknown; originalCode?: unknown; kind?: unknown; cause?: unknown };
  if (e.code === 'P2003' || e.originalCode === '23503') return true;
  if (e.kind === 'ForeignKeyConstraintViolation') return true;
  return isForeignKeyViolation(e.cause, depth + 1);
}

/**
 * `Technology` rows through the current transaction (or the base client outside a unit of work). Writes
 * run in the caller's unit of work; the domain decides the rules, this adapter only translates the
 * database's answers into `DomainError`s.
 */
@Injectable()
export class PrismaTechnologyRepository implements TechnologyRepository {
  constructor(private readonly host: TransactionHost) {}

  async findAll(): Promise<TechnologyRecord[]> {
    const rows = await this.host.db.technology.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toRecord);
  }

  async findById(id: string): Promise<TechnologyRecord | null> {
    const row = await this.host.db.technology.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  }

  async findByIds(ids: readonly string[]): Promise<TechnologyRecord[]> {
    const rows = await this.host.db.technology.findMany({ where: { id: { in: [...ids] } } });
    return rows.map(toRecord);
  }

  async insert(record: TechnologyRecord): Promise<void> {
    try {
      await this.host.db.technology.create({ data: { id: record.id, ...toValues(record) } });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async update(record: TechnologyRecord): Promise<void> {
    try {
      await this.host.db.technology.update({
        where: { id: record.id },
        data: toValues(record),
      });
    } catch (error) {
      throw translateWriteError(error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.host.db.technology.delete({ where: { id } });
    } catch (error) {
      // A project still lists the technology (`ProjectTechnology` is RESTRICT): the lock of HU-06 CA3.
      if (isForeignKeyViolation(error)) {
        throw new IntegrityLockedError({ message: TECHNOLOGY_IN_USE_KEY });
      }
      throw error;
    }
  }
}

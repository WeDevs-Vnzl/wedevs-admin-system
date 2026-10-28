import { Inject, Injectable } from '@nestjs/common';
import type { DocumentTypeRepository } from '../application/ports/document-type.repository.port';
import type { DocumentType } from '../domain/document-type';
import type { DocumentFormat } from '../../../shared/domain/enums';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

interface TypeRow {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly nameEn: string | null;
  readonly requiresSignature: boolean;
  readonly hasExpiration: boolean;
  readonly defaultFormat: string;
  readonly active: boolean;
}

function toType(row: TypeRow): DocumentType {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    nameEn: row.nameEn,
    requiresSignature: row.requiresSignature,
    hasExpiration: row.hasExpiration,
    defaultFormat: row.defaultFormat as DocumentFormat,
    active: row.active,
  };
}

/**
 * `DocumentType` rows through the current transaction (or the base client outside a unit of work). The
 * usage lock (a type with documents) is checked by the use case through the usage port, not here.
 */
@Injectable()
export class PrismaDocumentTypeRepository implements DocumentTypeRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async list(): Promise<DocumentType[]> {
    const rows = await this.host.db.documentType.findMany({ orderBy: [{ id: 'asc' }] });
    return rows.map(toType);
  }

  async find(id: string): Promise<DocumentType | null> {
    const row = await this.host.db.documentType.findUnique({ where: { id } });
    return row ? toType(row) : null;
  }

  async insert(type: DocumentType): Promise<void> {
    await this.host.db.documentType.create({
      data: {
        id: type.id,
        categoryId: type.categoryId,
        name: type.name,
        nameEn: type.nameEn,
        requiresSignature: type.requiresSignature,
        hasExpiration: type.hasExpiration,
        defaultFormat: type.defaultFormat,
        active: type.active,
      },
    });
  }

  async update(type: DocumentType): Promise<void> {
    await this.host.db.documentType.update({
      where: { id: type.id },
      data: {
        categoryId: type.categoryId,
        name: type.name,
        nameEn: type.nameEn,
        requiresSignature: type.requiresSignature,
        hasExpiration: type.hasExpiration,
        defaultFormat: type.defaultFormat,
        active: type.active,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.host.db.documentType.delete({ where: { id } });
  }
}

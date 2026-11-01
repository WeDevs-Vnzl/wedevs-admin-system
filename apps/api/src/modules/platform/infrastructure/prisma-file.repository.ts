import { Injectable } from '@nestjs/common';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import type { FileRepository } from '../application/ports/file.repository.port';
import type { StoredFile } from '../domain/file';

/** Prisma adapter of `FileRepository`. Joins the ambient unit of work through `TransactionHost`. */
@Injectable()
export class PrismaFileRepository implements FileRepository {
  constructor(private readonly host: TransactionHost) {}

  async insert(file: StoredFile): Promise<void> {
    await this.host.db.file.create({
      data: {
        id: file.id,
        storageKey: file.storageKey,
        bucket: file.bucket,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        status: file.status,
        uploadedById: file.uploadedById,
        createdAt: file.createdAt,
      },
    });
  }

  async findById(id: string): Promise<StoredFile | null> {
    // `findUnique` is not covered by the soft-delete extension: check `deletedAt` here (C14, C19).
    const row = await this.host.db.file.findUnique({ where: { id } });
    if (!row || row.deletedAt !== null) return null;
    return {
      id: row.id,
      storageKey: row.storageKey,
      bucket: row.bucket,
      originalName: row.originalName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      status: row.status,
      uploadedById: row.uploadedById,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    };
  }

  async lockForUpdate(id: string): Promise<StoredFile | null> {
    const tx = this.host.requireTransaction('FileRepository.lockForUpdate');
    // The lock query blocks while another transaction holds the row; the read after it sees what that
    // transaction committed (READ COMMITTED), so the caller's checks run on fresh state.
    await tx.$queryRaw`SELECT "id" FROM "File" WHERE "id" = ${id} FOR UPDATE`;
    return this.findById(id);
  }

  async markReady(id: string, verified: { sizeBytes: number; mimeType: string }): Promise<boolean> {
    const result = await this.host.db.file.updateMany({
      where: { id, status: 'PENDING', deletedAt: null },
      data: { status: 'READY', sizeBytes: verified.sizeBytes, mimeType: verified.mimeType },
    });
    return result.count === 1;
  }

  async softDelete(id: string, at: Date): Promise<boolean> {
    const result = await this.host.db.file.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: at },
    });
    return result.count === 1;
  }

  async isReferenced(id: string): Promise<boolean> {
    // The relations of `File` itself: every business row that points at it, deleted or not.
    const row = await this.host.db.file.findUnique({
      where: { id },
      select: {
        invoice: { select: { id: true } },
        paymentReceipt: { select: { id: true } },
        expenseReceipt: { select: { id: true } },
        documentVersions: { select: { id: true }, take: 1 },
        noteAttachments: { select: { noteId: true }, take: 1 },
      },
    });
    if (!row) return false;
    return (
      row.invoice !== null ||
      row.paymentReceipt !== null ||
      row.expenseReceipt !== null ||
      row.documentVersions.length > 0 ||
      row.noteAttachments.length > 0
    );
  }
}

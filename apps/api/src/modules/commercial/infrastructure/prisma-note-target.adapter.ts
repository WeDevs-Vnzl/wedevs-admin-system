import { Injectable } from '@nestjs/common';
import type { NoteTargetPort, ResolvedNoteTarget } from '../application/ports/note-target.port';
import { linkKey, type NoteLinkTarget } from '../domain/note-link';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';

/**
 * Resolves the clients, contacts and projects a note can hang from. Archived rows are returned flagged so
 * an existing link keeps its label; `findMany` is asked for `deletedAt` explicitly because the soft-delete
 * extension would otherwise hide them. Never trusts a client id without a lookup (C14).
 */
@Injectable()
export class PrismaNoteTargetAdapter implements NoteTargetPort {
  constructor(private readonly host: TransactionHost) {}

  async resolve(targets: readonly NoteLinkTarget[]): Promise<Map<string, ResolvedNoteTarget>> {
    const db = this.host.db;
    const idsOf = (type: NoteLinkTarget['entityType']): string[] => [
      ...new Set(targets.filter((t) => t.entityType === type).map((t) => t.entityId)),
    ];
    const found = new Map<string, ResolvedNoteTarget>();
    const put = (
      type: 'CLIENT' | 'CONTACT' | 'PROJECT',
      id: string,
      label: string,
      deletedAt: Date | null,
      code?: string,
    ): void => {
      found.set(linkKey({ entityType: type, entityId: id }), {
        ref: { type, id, label, ...(code ? { code } : {}) },
        archived: deletedAt !== null,
      });
    };

    const clientIds = idsOf('CLIENT');
    if (clientIds.length > 0) {
      const rows = await db.client.findMany({
        where: { id: { in: clientIds }, deletedAt: undefined },
        select: { id: true, code: true, tradeName: true, deletedAt: true },
      });
      for (const r of rows) put('CLIENT', r.id, r.tradeName, r.deletedAt, r.code);
    }
    const contactIds = idsOf('CONTACT');
    if (contactIds.length > 0) {
      const rows = await db.contact.findMany({
        where: { id: { in: contactIds }, deletedAt: undefined },
        select: { id: true, fullName: true, deletedAt: true },
      });
      for (const r of rows) put('CONTACT', r.id, r.fullName, r.deletedAt);
    }
    const projectIds = idsOf('PROJECT');
    if (projectIds.length > 0) {
      const rows = await db.project.findMany({
        where: { id: { in: projectIds }, deletedAt: undefined },
        select: { id: true, code: true, name: true, deletedAt: true },
      });
      for (const r of rows) put('PROJECT', r.id, r.name, r.deletedAt, r.code);
    }
    return found;
  }
}

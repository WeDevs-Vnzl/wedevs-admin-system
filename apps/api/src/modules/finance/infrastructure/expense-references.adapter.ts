import { Inject, Injectable } from '@nestjs/common';
import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { FinanceLookups } from '../../commercial/application/finance-lookups';
import type { ReserveFileForAttachment } from '../../platform/application/use-cases/reserve-file-for-attachment.use-case';
import type {
  ExpenseAccountRef,
  ExpenseReceiptFilesPort,
  ExpenseReferencesPort,
  ReservedExpenseReceipt,
} from '../application/ports/expense-references.port';

/**
 * What an expense points at. The project goes through commercial's exported `FinanceLookups` (rule (e)). The
 * account is finance's own table. The category is a read-only select of settings' `ExpenseCategory`: settings
 * exports no category query, so this is a new cross-context read reported for DT-118.
 */
@Injectable()
export class PrismaExpenseReferences implements ExpenseReferencesPort {
  constructor(
    @Inject(TransactionHost) private readonly host: TransactionHost,
    @Inject(FinanceLookups) private readonly lookups: FinanceLookups,
  ) {}

  async activeCategory(id: string): Promise<{ id: string } | null> {
    return this.host.db.expenseCategory.findFirst({
      where: { id, active: true },
      select: { id: true },
    });
  }

  async activeAccount(id: string): Promise<ExpenseAccountRef | null> {
    return this.host.db.account.findFirst({
      where: { id, active: true, deletedAt: null },
      select: { id: true, name: true, currency: true },
    });
  }

  async liveProject(id: string): Promise<EntityRef | null> {
    return (await this.lookups.liveProject(id))?.ref ?? null;
  }
}

/** `ExpenseReceiptFilesPort` answered by platform's exported `ReserveFileForAttachment` (C23). */
export class PlatformExpenseReceiptFiles implements ExpenseReceiptFilesPort {
  constructor(private readonly reserveFile: ReserveFileForAttachment) {}

  async reserve(actor: CurrentUser, fileId: string): Promise<ReservedExpenseReceipt> {
    const file = await this.reserveFile.execute(actor, fileId);
    return { id: file.id };
  }
}

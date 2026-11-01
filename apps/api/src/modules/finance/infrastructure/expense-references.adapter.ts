import { Inject, Injectable } from '@nestjs/common';
import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { FinanceLookups } from '../../commercial/application/finance-lookups';
import { ExpenseCategoryCatalogQuery } from '../../settings/application/expense-category-catalog.query';
import type { ReserveFileForAttachment } from '../../platform/application/use-cases/reserve-file-for-attachment.use-case';
import type {
  ExpenseAccountRef,
  ExpenseReceiptFilesPort,
  ExpenseReferencesPort,
  ReservedExpenseReceipt,
} from '../application/ports/expense-references.port';

/**
 * What an expense points at. The project goes through commercial's exported `FinanceLookups` and the category
 * through settings' exported `ExpenseCategoryCatalogQuery` (rule (e)). The account is finance's own table.
 */
@Injectable()
export class PrismaExpenseReferences implements ExpenseReferencesPort {
  constructor(
    @Inject(TransactionHost) private readonly host: TransactionHost,
    @Inject(FinanceLookups) private readonly lookups: FinanceLookups,
    @Inject(ExpenseCategoryCatalogQuery) private readonly categories: ExpenseCategoryCatalogQuery,
  ) {}

  activeCategory(id: string): Promise<{ id: string } | null> {
    return this.categories.activeCategory(id);
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

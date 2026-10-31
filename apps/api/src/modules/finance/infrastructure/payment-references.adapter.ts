import { Inject, Injectable } from '@nestjs/common';
import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { FinanceLookups } from '../../commercial/application/finance-lookups';
import type { ReserveFileForAttachment } from '../../platform/application/use-cases/reserve-file-for-attachment.use-case';
import { PaymentMethodCatalogQuery } from '../../settings/application/payment-method-catalog.query';
import type {
  PaymentAccountRef,
  PaymentMethodRule,
  PaymentReceiptFilesPort,
  PaymentReferencesPort,
  ReservedPaymentReceipt,
} from '../application/ports/payment-references.port';

/**
 * What a payment points at. The client goes through commercial's exported `FinanceLookups` (rule (e)). The account
 * is finance's own table. The method goes through settings' exported `PaymentMethodCatalogQuery` (rule (e)).
 */
@Injectable()
export class PrismaPaymentReferences implements PaymentReferencesPort {
  constructor(
    @Inject(TransactionHost) private readonly host: TransactionHost,
    @Inject(FinanceLookups) private readonly lookups: FinanceLookups,
    @Inject(PaymentMethodCatalogQuery) private readonly methods: PaymentMethodCatalogQuery,
  ) {}

  liveClient(id: string): Promise<EntityRef | null> {
    return this.lookups.liveClientRef(id);
  }

  async account(id: string): Promise<PaymentAccountRef | null> {
    return this.host.db.account.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, name: true, currency: true, active: true },
    });
  }

  activeMethod(id: string): Promise<PaymentMethodRule | null> {
    return this.methods.activeMethod(id);
  }
}

/** `PaymentReceiptFilesPort` answered by platform's exported `ReserveFileForAttachment` (C23). */
export class PlatformPaymentReceiptFiles implements PaymentReceiptFilesPort {
  constructor(private readonly reserveFile: ReserveFileForAttachment) {}

  async reserve(actor: CurrentUser, fileId: string): Promise<ReservedPaymentReceipt> {
    const file = await this.reserveFile.execute(actor, fileId);
    return { id: file.id, mimeType: file.mimeType, sizeBytes: file.sizeBytes };
  }
}

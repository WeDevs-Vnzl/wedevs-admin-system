import { Inject, Injectable } from '@nestjs/common';
import type { CurrentUser } from '../../../shared/application/current-user';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import { FinanceLookups } from '../../commercial/application/finance-lookups';
import type { ReserveFileForAttachment } from '../../platform/application/use-cases/reserve-file-for-attachment.use-case';
import { FiscalSettingsQuery } from '../../settings/application/fiscal-settings.query';
import type {
  InvoiceFilesPort,
  InvoiceFiscalPort,
  InvoiceReferencesPort,
  ReservedInvoiceFile,
} from '../application/ports/invoice-references.port';

/**
 * What an invoice points at in `commercial`, through its exported `FinanceLookups` (rule (e), C14): an unknown
 * or archived client or project answers `null`.
 */
@Injectable()
export class CommercialInvoiceReferences implements InvoiceReferencesPort {
  constructor(@Inject(FinanceLookups) private readonly lookups: FinanceLookups) {}

  liveClient(id: string): Promise<EntityRef | null> {
    return this.lookups.liveClientRef(id);
  }

  async liveProject(id: string): Promise<EntityRef | null> {
    return (await this.lookups.liveProject(id))?.ref ?? null;
  }

  projectBelongsToClient(projectId: string, clientId: string): Promise<boolean> {
    return this.lookups.projectBelongsToClient(projectId, clientId);
  }

  async liveProjectsOfClient(clientId: string): Promise<EntityRef[]> {
    return (await this.lookups.liveProjectsOfClient(clientId)).map((project) => project.ref);
  }
}

/** The allowed VAT rates, from settings' exported `FiscalSettingsQuery` (DT-44). */
@Injectable()
export class SettingsInvoiceFiscal implements InvoiceFiscalPort {
  constructor(@Inject(FiscalSettingsQuery) private readonly fiscal: FiscalSettingsQuery) {}

  async allowedIvaRates(): Promise<readonly string[]> {
    return (await this.fiscal.read()).ivaRates;
  }
}

/** `InvoiceFilesPort` answered by platform's exported `ReserveFileForAttachment` (C23). */
export class PlatformInvoiceFiles implements InvoiceFilesPort {
  constructor(private readonly reserveFile: ReserveFileForAttachment) {}

  async reserve(actor: CurrentUser, fileId: string): Promise<ReservedInvoiceFile> {
    const file = await this.reserveFile.execute(actor, fileId);
    return { id: file.id, mimeType: file.mimeType, sizeBytes: file.sizeBytes };
  }
}

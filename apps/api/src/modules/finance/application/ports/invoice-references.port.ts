import type { CurrentUser } from '../../../../shared/application/current-user';
import type { EntityRef } from '../../../../shared/domain/entity-ref';

export const INVOICE_REFERENCES = Symbol('INVOICE_REFERENCES');
export const INVOICE_FISCAL = Symbol('INVOICE_FISCAL');
export const INVOICE_FILES = Symbol('INVOICE_FILES');

/**
 * What an invoice points at in `commercial`, checked against the database (a client or project id is never
 * trusted, C14). Every method answers `null`/`false`/`[]` for an unknown or archived row; the use case throws
 * its own error. Valid inside the caller's unit of work, after it took the row locks.
 */
export interface InvoiceReferencesPort {
  liveClient(id: string): Promise<EntityRef | null>;
  liveProject(id: string): Promise<EntityRef | null>;
  projectBelongsToClient(projectId: string, clientId: string): Promise<boolean>;
  liveProjectsOfClient(clientId: string): Promise<EntityRef[]>;
}

/** The fiscal parameters an invoice needs (settings owns them). */
export interface InvoiceFiscalPort {
  /** The VAT rates a line may use, in percent (`["16","8","0"]`). */
  allowedIvaRates(): Promise<readonly string[]>;
}

export interface ReservedInvoiceFile {
  readonly id: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/**
 * Claims a file as an invoice document (C23). Valid only inside the invoice's unit of work: it takes the file
 * row lock a concurrent delete also takes. Throws `NOT_FOUND` for a file that is unknown, not `READY`, or
 * neither the caller's own upload nor claimed by a resource the caller can read.
 */
export interface InvoiceFilesPort {
  reserve(actor: CurrentUser, fileId: string): Promise<ReservedInvoiceFile>;
}

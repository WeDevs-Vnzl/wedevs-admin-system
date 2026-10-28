import { Injectable } from '@nestjs/common';
import type { DocumentTypeUsagePort } from '../application/ports/document-type-usage.port';

/**
 * Neutral usage adapter bound to `DOCUMENT_TYPE_USAGE` until the `documents` context (BE-4) exists (DT-110):
 * no document can point at a type yet, so every type is unused and deletable. BE-4 rebinds the token to its
 * own adapter; this one is then removed with the binding.
 */
@Injectable()
export class NoDocumentsYetDocumentTypeUsageAdapter implements DocumentTypeUsagePort {
  async countDocuments(_typeId: string): Promise<number> {
    return 0;
  }
}

/**
 * DI token of the usage port. Settings owns the port (DT-110); the adapter bound in
 * `document-types.module.ts` answers "no documents" until the `documents` context (BE-4) rebinds it.
 */
export const DOCUMENT_TYPE_USAGE = Symbol('DOCUMENT_TYPE_USAGE');

/** How many documents use a type, the way the C19 integrity lock needs it. */
export interface DocumentTypeUsagePort {
  /** Documents that point at the type, archived ones included (HU-21 CA2, the mock's rule). */
  countDocuments(typeId: string): Promise<number>;
}

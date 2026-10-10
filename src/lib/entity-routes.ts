import type { EntityType } from "@/lib/validators/enums";

// Detail routes of PRD §11 keyed by entity type. A type missing from this map has no route of its own
// (contacts live inside their client, files inside their document, tags and settings in the settings section).
const DETAIL_PATHS: Partial<Record<EntityType, (id: string) => string>> = {
  CLIENT: (id) => `/clients/${id}`,
  PROJECT: (id) => `/projects/${id}`,
  INVOICE: (id) => `/invoices/${id}`,
  PAYMENT: (id) => `/payments/${id}`,
  EXPENSE: (id) => `/expenses/${id}`,
  RECURRING_EXPENSE: (id) => `/expenses/recurring/${id}`,
  ACCOUNT: (id) => `/accounts/${id}`,
  DOCUMENT: (id) => `/documents/${id}`,
  NOTE: (id) => `/notes/${id}`,
  SHARE_LINK: (id) => `/documents/shares/${id}`,
};

// Detail href of an entity, or `null` when the type has no route of its own (PRD §11).
export function entityHref({ type, id }: { type: EntityType; id: string }): string | null {
  const path = DETAIL_PATHS[type];
  return path ? path(encodeURIComponent(id)) : null;
}

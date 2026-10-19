import {
  Banknote,
  Building2,
  Contact,
  CreditCard,
  FileText,
  FolderKanban,
  Landmark,
  Receipt,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { entityHref } from "@/lib/entity-routes";
import type { SearchableEntityType } from "@/lib/validators/search";

// Presentation of the searchable entity types in Cmd+K (PRD §7.6): the same icons as the sidebar
// (`config/nav.ts`), the enum that translates each type's raw status, and the detail routes.

export const SEARCH_ENTITY_ICONS: Record<SearchableEntityType, LucideIcon> = {
  CLIENT: Building2,
  CONTACT: Contact,
  PROJECT: FolderKanban,
  INVOICE: Receipt,
  PAYMENT: Banknote,
  EXPENSE: CreditCard,
  ACCOUNT: Landmark,
  DOCUMENT: FileText,
  NOTE: StickyNote,
};

/** `enums` namespace entry of each type's status; types without one show no status. */
export const SEARCH_STATUS_ENUMS: Partial<Record<SearchableEntityType, string>> = {
  CLIENT: "ClientStatus",
  PROJECT: "ProjectStatus",
  INVOICE: "InvoiceStatus",
  PAYMENT: "PaymentStatus",
  EXPENSE: "ExpenseStatus",
  DOCUMENT: "DocumentStatus",
};

/** Detail href of a hit; `null` for contacts, which have no route of their own (PRD §11). */
export function searchHitHref(hit: { entityType: SearchableEntityType; entityId: string }) {
  return entityHref({ type: hit.entityType, id: hit.entityId });
}

const DETAIL_ROUTE_TYPES: Record<string, SearchableEntityType> = {
  clients: "CLIENT",
  projects: "PROJECT",
  invoices: "INVOICE",
  payments: "PAYMENT",
  expenses: "EXPENSE",
  accounts: "ACCOUNT",
  documents: "DOCUMENT",
  notes: "NOTE",
};

/**
 * The record a pathname shows (`/clients/cli_1`, `/clients/cli_1/graph`), or `null`. Paths like
 * `/clients/new` also match; callers only keep a match whose id segment has a breadcrumb label, which
 * only detail pages register.
 */
export function recordOfPath(pathname: string) {
  const match = /^\/([a-z]+)\/([^/]+)(?:\/.*)?$/.exec(pathname);
  const entityType = match?.[1] ? DETAIL_ROUTE_TYPES[match[1]] : undefined;
  if (!match?.[2] || !entityType) return null;
  const entityId = decodeURIComponent(match[2]);
  return { entityType, entityId, segment: match[2], href: `/${match[1]}/${match[2]}` };
}

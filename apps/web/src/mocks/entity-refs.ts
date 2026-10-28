// MOCK — entity references of Hito 1 (C8, C9). Services resolve the `EntityRef` of a stored id here instead
// of importing each other (a mock service never imports another mock service). Framework-free (C11).
// Replaced by the relations the Prisma services join in Hito 2; deleted with `src/mocks/` (C9).
import type { EntityRef } from "@/lib/validators/common";
import type { EntityType } from "@/lib/validators/enums";
import type { MockStore } from "./store";

const NOTE_LABEL_WORDS = 6;

/** Plain-text projection of a Tiptap node (blocks separated by a space), for previews and labels. */
export function richTextToPlainText(node: {
  text?: string | undefined;
  content?: readonly unknown[] | undefined;
}): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? [])
    .map((child) => richTextToPlainText(child as { text?: string; content?: readonly unknown[] }))
    .filter((part) => part.length > 0)
    .join(" ");
}

/** First words of `value`, for entities that have no name (an untitled note). */
export function firstWords(value: string, count: number = NOTE_LABEL_WORDS): string {
  return value.trim().split(/\s+/).slice(0, count).join(" ");
}

function ref(type: EntityType, id: string, label: string, code?: string): EntityRef {
  return code === undefined ? { id, label, type } : { id, code, label, type };
}

/**
 * The `EntityRef` of `entityType` / `id`, or `null` when the type has no collection or the row does not
 * exist (an archived row still resolves: history keeps pointing at it). `label` is the trade name, name or
 * title (the first words for an untitled note) and `code` is set for the entities that have one. Finance
 * entities answer from their collections, which are empty until H1-B3.
 */
export function resolveEntityRef(
  db: MockStore,
  entityType: EntityType,
  id: string,
): EntityRef | null {
  switch (entityType) {
    case "CLIENT": {
      const row = db.clients.find((item) => item.id === id);
      return row ? ref("CLIENT", row.id, row.tradeName, row.code) : null;
    }
    case "CONTACT": {
      const row = db.contacts.find((item) => item.id === id);
      return row ? ref("CONTACT", row.id, row.fullName) : null;
    }
    case "PROJECT": {
      const row = db.projects.find((item) => item.id === id);
      return row ? ref("PROJECT", row.id, row.name, row.code) : null;
    }
    case "DOCUMENT": {
      const row = db.documents.find((item) => item.id === id);
      return row ? ref("DOCUMENT", row.id, row.title, row.code) : null;
    }
    case "NOTE": {
      const row = db.notes.find((item) => item.id === id);
      if (!row) return null;
      return ref(
        "NOTE",
        row.id,
        row.title ?? (firstWords(richTextToPlainText(row.content)) || row.id),
      );
    }
    case "FILE": {
      const row = db.files.find((item) => item.id === id);
      return row ? ref("FILE", row.id, row.originalName) : null;
    }
    case "TAG": {
      const row = db.tags.find((item) => item.id === id);
      return row ? ref("TAG", row.id, row.name) : null;
    }
    case "USER": {
      const row = db.users.find((item) => item.id === id);
      return row ? ref("USER", row.id, row.name) : null;
    }
    case "INVOICE": {
      const row = db.invoices.find((item) => item.id === id);
      return row ? ref("INVOICE", row.id, row.invoiceNumber, row.code) : null;
    }
    case "PAYMENT": {
      const row = db.payments.find((item) => item.id === id);
      return row ? ref("PAYMENT", row.id, row.code, row.code) : null;
    }
    case "EXPENSE": {
      const row = db.expenses.find((item) => item.id === id);
      return row ? ref("EXPENSE", row.id, row.description, row.code) : null;
    }
    case "RECURRING_EXPENSE": {
      const row = db.recurringExpenses.find((item) => item.id === id);
      return row ? ref("RECURRING_EXPENSE", row.id, row.name) : null;
    }
    case "ACCOUNT": {
      const row = db.accounts.find((item) => item.id === id);
      return row ? ref("ACCOUNT", row.id, row.name) : null;
    }
    case "TRANSFER": {
      const row = db.transfers.find((item) => item.id === id);
      return row
        ? ref("TRANSFER", row.id, `${row.fromAccount.label} → ${row.toAccount.label}`)
        : null;
    }
    case "ACCOUNT_MOVEMENT": {
      const row = db.movements.find((item) => item.id === id);
      return row ? ref("ACCOUNT_MOVEMENT", row.id, row.description) : null;
    }
    case "BILLING_PLAN": {
      const row = db.billingPlans.find((item) => item.id === id);
      if (!row) return null;
      const project = db.projects.find((item) => item.id === row.projectId);
      return ref("BILLING_PLAN", row.id, project?.name ?? row.id);
    }
    case "INSTALLMENT": {
      const row = db.installments.find((item) => item.id === id);
      return row ? ref("INSTALLMENT", row.id, row.label) : null;
    }
    case "RECURRING_CHARGE": {
      const row = db.recurringCharges.find((item) => item.id === id);
      return row ? ref("RECURRING_CHARGE", row.id, row.label) : null;
    }
    case "SHARE_LINK": {
      const row = db.shareLinks.find((item) => item.id === id);
      return row ? ref("SHARE_LINK", row.id, row.title) : null;
    }
    case "SETTING":
      return null;
  }
}

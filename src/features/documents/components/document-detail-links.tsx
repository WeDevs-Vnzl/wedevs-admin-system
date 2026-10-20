"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { EntityCodeChip } from "@/components/patterns/entity-code-chip";
import { AsyncCombobox, type AsyncComboboxOption } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { searchClientsAction } from "@/features/clients/actions";
import { searchContactsAction } from "@/features/contacts/actions";
import { searchExpensesAction } from "@/features/expenses/actions";
import { searchInvoicesAction } from "@/features/invoices/actions";
import { searchPaymentsAction } from "@/features/payments/actions";
import { searchProjectsAction } from "@/features/projects/actions";
import { entityHref } from "@/lib/entity-routes";
import type { ActionResult, EntityRef } from "@/lib/validators/common";
import {
  DOCUMENT_LINK_ENTITY_TYPE_VALUES,
  type DocumentLinkDTO,
  type DocumentLinkEntityType,
} from "@/lib/validators/documents";
import { linkDocumentAction, unlinkDocumentAction } from "../actions";

type SearchAction = (input: { q: string }) => Promise<ActionResult<EntityRef[]>>;

/** The W2 typeahead of each record type a document can be linked to (at most 20, archived left out). */
const SEARCH: Record<DocumentLinkEntityType, SearchAction> = {
  CLIENT: (input) => searchClientsAction(input),
  CONTACT: (input) => searchContactsAction(input),
  PROJECT: (input) => searchProjectsAction(input),
  INVOICE: (input) => searchInvoicesAction(input),
  PAYMENT: (input) => searchPaymentsAction(input),
  EXPENSE: (input) => searchExpensesAction(input),
};

const LINKABLE: readonly string[] = DOCUMENT_LINK_ENTITY_TYPE_VALUES;

export interface DocumentDetailLinksProps {
  documentId: string;
  links: readonly DocumentLinkDTO[];
  /** `document` UPDATE: linking and unlinking are changes of the document (HU-20). */
  canUpdate: boolean;
}

/**
 * *Vínculos* tab (PRD §8.9.2, HU-20): the records the document belongs to, each one opening its page, plus linking
 * one more record (type, then search) and unlinking one after confirmation. Removing one link leaves the others and
 * the document untouched, and is logged as `UNLINK` by the service.
 */
export function DocumentDetailLinks({ documentId, links, canUpdate }: DocumentDetailLinksProps) {
  const t = useTranslations("documents.detail.links");
  const tEntity = useTranslations("enums.EntityType");
  const tErrors = useTranslations("common.errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<DocumentLinkEntityType>("CLIENT");
  const [unlinking, setUnlinking] = useState<DocumentLinkDTO | null>(null);

  async function loadOptions(q: string): Promise<AsyncComboboxOption[]> {
    const result = await SEARCH[type]({ q });
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return [];
    }
    return result.data.map((ref) => ({ value: ref.id, label: ref.label, description: ref.code }));
  }

  function link(option: AsyncComboboxOption | null) {
    if (!option) return;
    startTransition(async () => {
      const result = await linkDocumentAction({
        documentId,
        target: { entityType: type, entityId: option.value },
      });
      if (!result.ok) {
        toast.error(t("failed"));
        return;
      }
      toast.success(t("linked"));
      router.refresh();
    });
  }

  function unlink(target: DocumentLinkDTO) {
    if (!LINKABLE.includes(target.entity.type)) return;
    startTransition(async () => {
      const result = await unlinkDocumentAction({
        documentId,
        target: {
          entityType: target.entity.type as DocumentLinkEntityType,
          entityId: target.entity.id,
        },
      });
      setUnlinking(null);
      if (!result.ok) {
        toast.error(t("failed"));
        return;
      }
      toast.success(t("unlinked"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {canUpdate ? (
        <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <Select
            value={type}
            onValueChange={(next) => setType(next as DocumentLinkEntityType)}
            disabled={pending}
          >
            <SelectTrigger aria-label={t("type")} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_LINK_ENTITY_TYPE_VALUES.map((entity) => (
                <SelectItem key={entity} value={entity}>
                  {tEntity(entity)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AsyncCombobox
            key={type}
            multiple={false}
            value={null}
            onChange={link}
            loadOptions={loadOptions}
            placeholder={t("search")}
            aria-label={t("search")}
            disabled={pending}
          />
        </div>
      ) : null}

      {links.length === 0 ? (
        <EmptyState icon={Link2} title={t("empty")} />
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {links.map((item) => {
            const href = entityHref(item.entity);
            return (
              <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{tEntity(item.entity.type)}</span>
                  {item.entity.code ? <EntityCodeChip code={item.entity.code} /> : null}
                  {href ? (
                    <Link href={href} className="truncate font-medium hover:underline">
                      {item.entity.label}
                    </Link>
                  ) : (
                    <span className="truncate font-medium">{item.entity.label}</span>
                  )}
                </div>
                {canUpdate ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("unlinkLabel", { label: item.entity.label })}
                    disabled={pending}
                    onClick={() => setUnlinking(item)}
                  >
                    <Unlink aria-hidden />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        variant="unlink"
        open={unlinking !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinking(null);
        }}
        description={t("unlinkDescription")}
        pending={pending}
        onConfirm={() => {
          if (unlinking) unlink(unlinking);
        }}
      />
    </div>
  );
}

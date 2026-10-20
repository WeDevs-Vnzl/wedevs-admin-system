"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import type { DocumentCategoryDetailDTO } from "@/lib/validators/document-types";
import {
  deleteDocumentCategoryAction,
  deleteDocumentTypeAction,
  reorderDocumentCategoriesAction,
  setDocumentTypeActiveAction,
} from "../actions";
import {
  DocumentCategoryFormDialog,
  type DocumentCategoryFormTarget,
} from "./document-category-form-dialog";
import {
  DocumentTypeFormDialog,
  type DocumentTypeFormTarget,
  type DocumentTypeItem,
} from "./document-type-form-dialog";

type DocumentTypesSettingsProps = {
  /** Every category in its configured order, each with all its types (active or not). */
  categories: DocumentCategoryDetailDTO[];
};

type DeleteTarget =
  | { kind: "category"; category: DocumentCategoryDetailDTO }
  | { kind: "type"; type: DocumentTypeItem }
  | null;

/** `confirm` asks before deleting; `locked` explains why the row cannot be deleted (C19, HU-21 CA2). */
type DeleteMode = "confirm" | "locked";

// Settings → Tipos de documento (PRD §8.9.1, HU-21): categories in their configured order, each with its types.
// Categories move up and down; a category with types and a type in use are never deleted (the type is deactivated).
export function DocumentTypesSettings({ categories }: DocumentTypesSettingsProps) {
  const t = useTranslations("catalogs.documentTypes");
  const tShared = useTranslations("catalogs.shared");
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const router = useRouter();
  const [categoryTarget, setCategoryTarget] = useState<DocumentCategoryFormTarget>(null);
  const [typeTarget, setTypeTarget] = useState<DocumentTypeFormTarget>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("confirm");
  const [pending, startTransition] = useTransition();

  function move(index: number, offset: -1 | 1) {
    const ids = categories.map((category) => category.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(index + offset, 0, moved);
    startTransition(async () => {
      const result = await reorderDocumentCategoriesAction({ orderedIds: ids });
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      toast.success(t("toast.reordered"));
      router.refresh();
    });
  }

  function setActive(type: DocumentTypeItem, active: boolean) {
    startTransition(async () => {
      const result = await setDocumentTypeActiveAction({ id: type.id, active });
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      toast.success(active ? t("toast.typeActivated") : t("toast.typeDeactivated"));
      router.refresh();
    });
  }

  function openDelete(target: NonNullable<DeleteTarget>) {
    // Known locks open as a notice at once: no request is sent for a row that cannot go.
    const locked =
      target.kind === "category" ? target.category.types.length > 0 : target.type.documentCount > 0;
    setDeleteMode(locked ? "locked" : "confirm");
    setDeleteTarget(target);
  }

  function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    startTransition(async () => {
      const result =
        target.kind === "category"
          ? await deleteDocumentCategoryAction({ id: target.category.id })
          : await deleteDocumentTypeAction({ id: target.type.id });
      if (!result.ok) {
        // Archived documents also hold a type, so the server may lock a type the list shows unused.
        if (result.error.code === "INTEGRITY_LOCK") {
          setDeleteMode("locked");
          return;
        }
        toast.error(tErrors(result.error.code));
        return;
      }
      setDeleteTarget(null);
      toast.success(
        target.kind === "category" ? t("toast.categoryDeleted") : t("toast.typeDeleted"),
      );
      router.refresh();
    });
  }

  const deleteName = !deleteTarget
    ? ""
    : catalogLabel(
        deleteTarget.kind === "category" ? deleteTarget.category : deleteTarget.type,
        locale,
      );

  function typeRow(type: DocumentTypeItem, categoryId: string) {
    const label = catalogLabel(type, locale);
    const nameId = `document-type-${type.id}`;
    return (
      <li
        key={type.id}
        aria-labelledby={nameId}
        className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span id={nameId} className="truncate font-medium">
            {label}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{tEnums(`DocumentFormat.${type.defaultFormat}`)}</Badge>
            {type.requiresSignature ? (
              <Badge variant="secondary">{t("types.signature")}</Badge>
            ) : null}
            {type.hasExpiration ? <Badge variant="secondary">{t("types.expiration")}</Badge> : null}
            <span className="text-xs text-muted-foreground">
              {t("types.documents", { count: type.documentCount })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={type.active}
            disabled={pending}
            onCheckedChange={(checked) => setActive(type, checked)}
            aria-label={t("types.toggle", { name: label })}
          />
          <span className="w-16 text-sm text-muted-foreground">
            {type.active ? tShared("active") : tShared("inactive")}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("types.edit", { name: label })}
            onClick={() => setTypeTarget({ mode: "edit", type, categoryId })}
          >
            <Pencil aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("types.delete", { name: label })}
            onClick={() => openDelete({ kind: "type", type })}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </li>
    );
  }

  function categorySection(category: DocumentCategoryDetailDTO, index: number) {
    const label = catalogLabel(category, locale);
    const headingId = `document-category-${category.id}`;
    return (
      <section key={category.id} aria-labelledby={headingId} className="rounded-2xl border">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
            style={category.color ? { backgroundColor: category.color } : undefined}
          />
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="truncate font-medium">
              {label}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("categories.typeCount", { count: category.types.length })}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pending || index === 0}
              aria-label={t("categories.moveUp", { name: label })}
              onClick={() => move(index, -1)}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={pending || index === categories.length - 1}
              aria-label={t("categories.moveDown", { name: label })}
              onClick={() => move(index, 1)}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("categories.addType", { name: label })}
              onClick={() => setTypeTarget({ mode: "create", categoryId: category.id })}
            >
              <Plus aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("categories.edit", { name: label })}
              onClick={() => setCategoryTarget({ mode: "edit", category })}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("categories.delete", { name: label })}
              onClick={() => openDelete({ kind: "category", category })}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>
        {category.types.length > 0 ? (
          <ul className="divide-y border-t px-4">
            {category.types.map((type) => typeRow(type, category.id))}
          </ul>
        ) : (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground">
            {t("categories.noTypes")}
          </p>
        )}
      </section>
    );
  }

  const lockedType = deleteTarget?.kind === "type" ? deleteTarget.type : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setCategoryTarget({ mode: "create" })}>
          <Plus data-icon="inline-start" aria-hidden />
          {t("categories.new")}
        </Button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          title={t("categories.empty.title")}
          description={t("categories.empty.description")}
        />
      ) : (
        <div className="flex flex-col gap-4">{categories.map(categorySection)}</div>
      )}

      <DocumentCategoryFormDialog
        target={categoryTarget}
        onOpenChange={(open) => {
          if (!open) setCategoryTarget(null);
        }}
        onSaved={() => {
          setCategoryTarget(null);
          router.refresh();
        }}
      />

      <DocumentTypeFormDialog
        target={typeTarget}
        categories={categories}
        onOpenChange={(open) => {
          if (!open) setTypeTarget(null);
        }}
        onSaved={() => {
          setTypeTarget(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        variant="delete"
        open={deleteTarget !== null && deleteMode === "confirm"}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        description={
          deleteTarget?.kind === "category"
            ? t("delete.categoryDescription", { name: deleteName })
            : t("delete.typeDescription", { name: deleteName })
        }
        pending={pending}
        onConfirm={confirmDelete}
      />

      {/* The locks are notices, not confirmations: a type in use offers deactivation instead. */}
      <AlertDialog
        open={deleteTarget !== null && deleteMode === "locked"}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lockedType ? t("delete.typeInUseTitle") : t("delete.categoryLockedTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lockedType
                ? t("delete.typeInUseDescription", { name: deleteName })
                : t("delete.categoryLockedDescription", { name: deleteName })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {lockedType?.active ? t("delete.cancel") : t("delete.close")}
            </AlertDialogCancel>
            {lockedType?.active ? (
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  setActive(lockedType, false);
                  setDeleteTarget(null);
                }}
              >
                {t("delete.deactivate")}
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

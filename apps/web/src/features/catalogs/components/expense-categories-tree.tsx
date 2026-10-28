"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ExpenseCategoryDTO, ExpenseCategoryTreeNode } from "@/lib/validators/catalogs";
import { updateExpenseCategoryAction } from "../actions";
import { catalogLabel } from "./catalog-label";
import {
  ExpenseCategoryFormDialog,
  type ExpenseCategoryFormTarget,
} from "./expense-category-form-dialog";

type ExpenseCategoriesTreeProps = {
  /** Every root category with its children, active or not. */
  roots: ExpenseCategoryTreeNode[];
};

// Settings → Categorías de gasto (PRD §8.15): a two-level tree, activation instead of delete (C19).
export function ExpenseCategoriesTree({ roots }: ExpenseCategoriesTreeProps) {
  const t = useTranslations("catalogs.expenseCategories");
  const tShared = useTranslations("catalogs.shared");
  const tErrors = useTranslations("common.errors");
  const locale = useLocale();
  const router = useRouter();
  const [target, setTarget] = useState<ExpenseCategoryFormTarget>(null);
  const [pending, startTransition] = useTransition();

  function setActive(category: ExpenseCategoryDTO, active: boolean) {
    startTransition(async () => {
      const result = await updateExpenseCategoryAction({
        id: category.id,
        name: category.name,
        nameEn: category.nameEn ?? undefined,
        color: category.color,
        parentId: category.parentId,
        active,
      });
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      toast.success(active ? t("toast.activated") : t("toast.deactivated"));
      router.refresh();
    });
  }

  function row(category: ExpenseCategoryDTO, hasChildren: boolean, child: boolean) {
    const label = catalogLabel(category, locale);
    return (
      <div className="flex items-center gap-3 py-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full bg-muted-foreground"
          style={category.color ? { backgroundColor: category.color } : undefined}
        />
        <span className={child ? "min-w-0 flex-1 truncate" : "min-w-0 flex-1 truncate font-medium"}>
          {label}
        </span>
        <div className="flex items-center gap-2">
          <Switch
            checked={category.active}
            disabled={pending}
            onCheckedChange={(checked) => setActive(category, checked)}
            aria-label={t("tree.toggle", { name: label })}
          />
          <span className="hidden w-16 text-sm text-muted-foreground sm:inline">
            {category.active ? tShared("active") : tShared("inactive")}
          </span>
          {child ? null : (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("tree.addChild", { name: label })}
              onClick={() => setTarget({ mode: "create", parentId: category.id })}
            >
              <Plus aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("tree.edit", { name: label })}
            onClick={() => setTarget({ mode: "edit", category, hasChildren })}
          >
            <Pencil aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => setTarget({ mode: "create", parentId: null })}>
          <Plus data-icon="inline-start" aria-hidden />
          {t("tree.new")}
        </Button>
      </div>

      {roots.length === 0 ? (
        <EmptyState title={t("tree.empty.title")} description={t("tree.empty.description")} />
      ) : (
        <ul className="divide-y rounded-2xl border px-4">
          {roots.map((root) => (
            <li key={root.id} className="py-1">
              {row(root, root.children.length > 0, false)}
              <p className="pb-1 pl-5 text-xs text-muted-foreground">
                {t("tree.children", { count: root.children.length })}
              </p>
              {root.children.length > 0 ? (
                <ul className="ml-5 border-l pl-4">
                  {root.children.map((child) => (
                    <li key={child.id}>{row(child, false, true)}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ExpenseCategoryFormDialog
        target={target}
        roots={roots}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        onSaved={() => {
          setTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}

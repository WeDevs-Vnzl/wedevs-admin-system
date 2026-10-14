import { getLocale, getTranslations } from "next-intl/server";
import { SectionCard } from "@/components/patterns/section-card";
import { Badge } from "@/components/ui/badge";
import type { EntityRef } from "@/lib/validators/common";
import type { DocumentLinkTarget, DocumentListRowDTO } from "@/lib/validators/documents";
import { getDocumentPermissions, listDocumentCategories, listEntityDocuments } from "../queries";
import { AttachDocumentSheet } from "./attach-document-sheet";
import { EntityDocumentsTable } from "./entity-documents-table";

/** The link this record's documents get; `null` for entities the tab does not serve (CLIENT and PROJECT only). */
function linkTargetOf(entity: EntityRef): DocumentLinkTarget | null {
  if (entity.type !== "CLIENT" && entity.type !== "PROJECT") return null;
  return { entityType: entity.type, entityId: entity.id };
}

interface EntityDocumentsTabProps {
  /** The client or project whose documents the tab lists; any other entity renders nothing. */
  entity: EntityRef;
}

/**
 * "Documentos" tab of a client or project (wireframe 4.6): category chips with counts, the linked documents and the
 * "Adjuntar documento" sheet. A server component: it reads through `queries.ts` and passes the result down.
 * Category chips show counts only; filtering by category comes with the documents module (H1-B4).
 */
export async function EntityDocumentsTab({ entity }: EntityDocumentsTabProps) {
  const target = linkTargetOf(entity);
  if (!target) return null;
  const t = await getTranslations("documents.tab");
  const locale = await getLocale();
  const [page, categories, permissions] = await Promise.all([
    listEntityDocuments(entity),
    listDocumentCategories(),
    getDocumentPermissions(),
  ]);
  const counts = countByCategory(page.items);

  return (
    <SectionCard
      heading
      title={`${t("title")} (${page.total})`}
      actions={
        permissions.canCreate ? (
          <AttachDocumentSheet entity={entity} categories={categories} />
        ) : undefined
      }
    >
      <ul aria-label={t("title")} className="flex flex-wrap gap-2">
        <li>
          <Badge variant="outline">
            {t("all")} · {page.total}
          </Badge>
        </li>
        {categories.map((category) => (
          <li key={category.id}>
            <Badge variant="outline" data-category-id={category.id}>
              {localName(category, locale)} · {counts.get(category.id) ?? 0}
            </Badge>
          </li>
        ))}
      </ul>

      <EntityDocumentsTable rows={page.items} target={target} canUpdate={permissions.canUpdate} />
    </SectionCard>
  );
}

function countByCategory(rows: readonly DocumentListRowDTO[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.category.id, (counts.get(row.category.id) ?? 0) + 1);
  return counts;
}

/** Catalog label in the current locale: the English name in English when the catalog has one (PRD §7.8). */
function localName(item: { name: string; nameEn: string | null }, locale: string): string {
  return locale === "en" && item.nameEn ? item.nameEn : item.name;
}

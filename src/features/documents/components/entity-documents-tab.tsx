import { getTranslations } from "next-intl/server";
import { SectionCard } from "@/components/patterns/section-card";
import type { EntityRef } from "@/lib/validators/common";
import type { DocumentLinkTarget } from "@/lib/validators/documents";
import { CreateShareDialog } from "@/features/shares/components/create-share-dialog";
import { getShareableDocuments, getSharePermissions } from "@/features/shares/queries";
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
 * "Adjuntar documento" sheet. A server component: it reads through `queries.ts` and passes every linked document down;
 * the chips count and filter over all of them on the client.
 */
export async function EntityDocumentsTab({ entity }: EntityDocumentsTabProps) {
  const target = linkTargetOf(entity);
  if (!target) return null;
  const t = await getTranslations("documents.tab");
  const [page, categories, permissions, sharePermissions] = await Promise.all([
    listEntityDocuments(entity),
    listDocumentCategories(),
    getDocumentPermissions(),
    getSharePermissions(),
  ]);
  // "Compartir documentos…" (PRD §8.11): a portal link from this record's documents, for roles with the share grant.
  const shareable =
    sharePermissions.canCreate && page.items.length > 0
      ? await getShareableDocuments(page.items.map((row) => row.id))
      : [];

  return (
    <SectionCard
      heading
      title={`${t("title")} (${page.total})`}
      actions={
        permissions.canCreate || shareable.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {shareable.length > 0 ? (
              <CreateShareDialog
                origin={{
                  type: entity.type === "CLIENT" ? "CLIENT" : "PROJECT",
                  id: entity.id,
                  label: entity.label,
                }}
                documents={shareable}
              />
            ) : null}
            {permissions.canCreate ? (
              <AttachDocumentSheet entity={entity} categories={categories} />
            ) : null}
          </div>
        ) : undefined
      }
    >
      <EntityDocumentsTable
        rows={page.items}
        categories={categories.map(({ id, name, nameEn }) => ({ id, name, nameEn }))}
        target={target}
        canUpdate={permissions.canUpdate}
      />
    </SectionCard>
  );
}

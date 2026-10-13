import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { DateText } from "@/components/patterns/date-text";
import { EmptyState } from "@/components/patterns/empty-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { entityHref } from "@/lib/entity-routes";
import type { EntityRef } from "@/lib/validators/common";
import type { DocumentLinkTarget, DocumentListRowDTO } from "@/lib/validators/documents";
import { getDocumentPermissions, listDocumentCategories, listEntityDocuments } from "../queries";
import { AttachDocumentSheet } from "./attach-document-sheet";
import { DocumentRowActions } from "./document-row-actions";

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
    <section aria-labelledby="entity-documents-title" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="entity-documents-title" className="text-base font-semibold">
          {t("title")} <span className="text-muted-foreground">({page.total})</span>
        </h2>
        {permissions.canCreate ? (
          <AttachDocumentSheet entity={entity} categories={categories} />
        ) : null}
      </header>

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

      {page.items.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.code")}</TableHead>
              <TableHead>{t("columns.title")}</TableHead>
              <TableHead>{t("columns.type")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.version")}</TableHead>
              <TableHead>{t("columns.updated")}</TableHead>
              {permissions.canUpdate ? (
                <TableHead>
                  <span className="sr-only">{t("columns.actions")}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((row) => (
              <DocumentTableRow
                key={row.id}
                row={row}
                target={target}
                typeName={localName(row.type, locale)}
                canUpdate={permissions.canUpdate}
                versionLabel={(number) => t("versionLabel", { number })}
                noVersion={t("noVersion")}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

interface DocumentTableRowProps {
  row: DocumentListRowDTO;
  target: DocumentLinkTarget;
  typeName: string;
  canUpdate: boolean;
  versionLabel: (number: number) => string;
  noVersion: string;
}

function DocumentTableRow({
  row,
  target,
  typeName,
  canUpdate,
  versionLabel,
  noVersion,
}: DocumentTableRowProps) {
  const href = entityHref({ type: "DOCUMENT", id: row.id });
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.code}</TableCell>
      <TableCell className="font-medium">
        {href ? <Link href={href}>{row.title}</Link> : row.title}
      </TableCell>
      <TableCell>{typeName}</TableCell>
      <TableCell>
        <StatusBadge enumName="DocumentStatus" value={row.status} />
      </TableCell>
      <TableCell>
        {row.currentVersionNumber === null ? noVersion : versionLabel(row.currentVersionNumber)}
      </TableCell>
      <TableCell>
        <DateText value={new Date(row.updatedAt)} style="short" />
      </TableCell>
      {canUpdate ? (
        <TableCell className="text-right">
          <DocumentRowActions documentId={row.id} documentTitle={row.title} target={target} />
        </TableCell>
      ) : null}
    </TableRow>
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

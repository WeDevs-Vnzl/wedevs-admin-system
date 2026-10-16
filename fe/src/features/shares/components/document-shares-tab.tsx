import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DateText } from "@/components/patterns/date-text";
import { SectionCard } from "@/components/patterns/section-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getShareableDocuments, getSharePermissions, listShareLinks } from "../queries";
import { CreateShareDialog } from "./create-share-dialog";
import { ShareStatusBadge } from "./share-status-badge";

/** A document is in a handful of links; one page of 100 shows them all. */
const TAB_PAGE_SIZE = 100;

interface DocumentSharesTabProps {
  documentId: string;
}

/**
 * "Compartir" tab of a document (PRD §8.9.5: "enlaces del portal que lo incluyen"): every link that includes the
 * document, with status, expiry and counters, and the "Share" dialog. A server component: it reads through
 * `queries.ts`. Portal links are Owner/Admin only (`share`); other roles get a note and nothing is read.
 */
export async function DocumentSharesTab({ documentId }: DocumentSharesTabProps) {
  const t = await getTranslations("shares");
  const permissions = await getSharePermissions();
  if (!permissions.canRead) {
    return (
      <SectionCard heading title={t("tab.title")}>
        <p className="text-sm text-muted-foreground">{t("tab.noAccess")}</p>
      </SectionCard>
    );
  }

  const [page, shareable] = await Promise.all([
    listShareLinks({ documentId, pageSize: TAB_PAGE_SIZE, sort: "createdAt:desc" }),
    permissions.canCreate ? getShareableDocuments([documentId]) : Promise.resolve([]),
  ]);
  const doc = shareable[0];

  return (
    <SectionCard
      heading
      title={`${t("tab.title")} (${page.total})`}
      description={t("tab.description")}
      actions={
        doc ? (
          <CreateShareDialog
            origin={{ type: "DOCUMENT", id: doc.id, label: doc.title }}
            documents={shareable}
          />
        ) : undefined
      }
    >
      {page.items.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm font-medium">{t("tab.empty")}</p>
          <p className="text-sm text-muted-foreground">{t("tab.emptyDescription")}</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.columns.title")}</TableHead>
              <TableHead>{t("table.columns.status")}</TableHead>
              <TableHead>{t("table.columns.expiresAt")}</TableHead>
              <TableHead className="text-right">{t("table.columns.views")}</TableHead>
              <TableHead className="text-right">{t("table.columns.downloads")}</TableHead>
              <TableHead>{t("table.columns.lastAccessedAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    href={`/documents/shares/${row.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <ShareStatusBadge status={row.status} />
                </TableCell>
                <TableCell>
                  {row.expiresAt ? <DateText value={row.expiresAt} /> : t("table.noExpiry")}
                </TableCell>
                <TableCell className="text-right tabular-nums">{row.counters.viewCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.counters.downloadCount}
                </TableCell>
                <TableCell>
                  {row.lastAccessedAt ? (
                    <DateText value={new Date(row.lastAccessedAt)} style="short" />
                  ) : (
                    t("table.never")
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}

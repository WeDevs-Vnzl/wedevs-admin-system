import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { ShareDetail } from "@/features/shares/components/share-detail";
import { loadShareOr404 } from "@/features/shares/load-share";
import {
  getShareLink,
  getShareableDocuments,
  getSharePermissions,
  listShareAccessLog,
} from "@/features/shares/queries";

type SharePageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: SharePageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("shares.page");
  try {
    const share = await getShareLink(id);
    return { title: share.title };
  } catch {
    return { title: t("detailTitle") };
  }
}

// `/documents/shares/[id]` (PRD §8.11): public URL, QR, revoke, edit, documents with version pin and access keys
// (DT-45), counters and the access table. Owner/Admin only (`share`); other roles get the in-shell 404.
export default async function SharePage({ params }: SharePageProps) {
  const { id } = await params;
  const permissions = await getSharePermissions();
  if (!permissions.canRead) notFound();
  const share = await loadShareOr404(id);
  const [accessLog, shareableDocuments] = await Promise.all([
    listShareAccessLog({ shareLinkId: share.id, sort: "createdAt:desc" }),
    permissions.canUpdate
      ? getShareableDocuments(share.documents.map((doc) => doc.document.id))
      : Promise.resolve([]),
  ]);

  return (
    <>
      <BreadcrumbLabel segment={share.id} label={share.title} />
      <ShareDetail
        share={share}
        shareableDocuments={shareableDocuments}
        accessLog={accessLog}
        canUpdate={permissions.canUpdate}
      />
    </>
  );
}

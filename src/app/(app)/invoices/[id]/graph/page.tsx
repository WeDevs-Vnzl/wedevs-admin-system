import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EntityGraphScreen } from "@/features/graph/components/entity-graph-screen";

type GraphPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("graph.page");
  return { title: t("title") };
}

// `/invoices/[id]/graph` (PRD §8.12.4, §11): the graph rooted at the record.
export default async function GraphPage({ params }: GraphPageProps) {
  const { id } = await params;
  return <EntityGraphScreen type="INVOICE" id={id} />;
}

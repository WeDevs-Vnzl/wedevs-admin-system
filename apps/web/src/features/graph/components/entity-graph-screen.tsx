import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { DetailGraphToggle } from "@/components/patterns/detail-header";
import { PageHeader } from "@/components/patterns/page-header";
import { graphNodeId, type GraphNodeType, type GraphResponse } from "@/lib/validators/graph";
import { can } from "@/server/auth/permissions";
import { requireSessionUser } from "@/server/auth/session";
import { ServiceError } from "@/server/errors";
import { nodeDetailHref } from "../graph-model";
import { getEntityGraph } from "../queries";
import { EntityGraph } from "./entity-graph";

/** The entity graph, or `null` when the record does not exist or the role may not read it. */
async function readGraph(type: GraphNodeType, id: string): Promise<GraphResponse | null> {
  try {
    return await getEntityGraph(type, id);
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Server screen of every `/<entidad>/[id]/graph` route (PRD §11, §8.12.4): the record's header with the
 * "Detalle | Grafo" toggle on "Grafo", then the explorable graph rooted at the record. Unknown ids, archived
 * records without the trash grant and types the role cannot read answer the not-found page.
 */
export async function EntityGraphScreen({ type, id }: { type: GraphNodeType; id: string }) {
  const user = await requireSessionUser();
  const graph = await readGraph(type, id);
  const rootId = graphNodeId(type, id);
  const root = graph?.nodes.find((node) => node.id === rootId);
  if (!graph || !root) notFound();

  const t = await getTranslations("graph");
  const detailHref = nodeDetailHref(root) ?? "/";
  const typeLabel = t(`types.${type}`);

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel
        segment={id}
        label={root.code ? `${root.code} · ${root.label}` : root.label}
      />
      <PageHeader
        title={root.label}
        description={
          root.code ? t("page.entityDescription", { code: root.code, type: typeLabel }) : typeLabel
        }
        views={
          <DetailGraphToggle
            mode="graph"
            detailHref={detailHref}
            graphHref={`${detailHref}/graph`}
          />
        }
      />
      <EntityGraph initial={graph} rootId={rootId} canSeeArchived={can(user, "restore", "trash")} />
    </div>
  );
}

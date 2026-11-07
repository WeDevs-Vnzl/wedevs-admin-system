import "server-only";
import { getServerApi } from "@/lib/api/server";
import { toActionResult } from "@/lib/api/errors";
import type { TrashFilterInput } from "@/lib/validators/trash";
import { toTrashListQuery } from "./api-query";

/** First page of Settings → Papelera for the query in the URL. A refused read throws to the route boundary. */
export async function getTrash(filter: TrashFilterInput = {}) {
  const api = await getServerApi();
  const result = toActionResult(
    await api.GET("/api/v1/trash", { params: { query: toTrashListQuery(filter) } }),
  );
  if (!result.ok) throw new Error(`trash: ${result.error.code}`);
  return result.data;
}

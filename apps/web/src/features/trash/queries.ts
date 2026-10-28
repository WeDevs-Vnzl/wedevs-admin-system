import "server-only";
import { trashFilterSchema, type TrashFilterInput } from "@/lib/validators/trash";
import * as trash from "@/mocks/services/trash";
import { getServiceContext } from "@/server/context";

/** First page of Settings → Papelera for the query in the URL. */
export async function getTrash(filter: TrashFilterInput = {}) {
  return trash.listTrash(await getServiceContext(), trashFilterSchema.parse(filter));
}

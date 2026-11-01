import type { DbClient } from '../../../shared/infrastructure/prisma/transaction-host';
import type { UserRef } from '../application/ports/document.repository.port';

/** The seven `File` columns a document or version may show: never `storageKey` or `bucket` (DT-140). */
export const FILE_META = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  status: true,
  uploadedById: true,
  createdAt: true,
} as const;

/**
 * The `{ id, name, imageUrl }` of live users by id, for the "created by" references of the document adapters.
 * An id that is not live is absent from the map; each caller decides the fallback.
 */
export async function userRefsById(
  db: DbClient,
  ids: readonly string[],
): Promise<Map<string, UserRef>> {
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({
    where: { id: { in: [...new Set(ids)] }, deletedAt: undefined },
    select: { id: true, name: true, imageUrl: true },
  });
  return new Map(rows.map((user) => [user.id, user]));
}

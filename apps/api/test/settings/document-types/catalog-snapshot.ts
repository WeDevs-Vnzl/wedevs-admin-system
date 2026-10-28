import type { PrismaClient } from '../../../src/generated/prisma/client';

/**
 * The seeded document categories and types, read before a suite touches them. Other suites (seed,
 * constraints) read these rows, so every suite of this package puts them back exactly as they were.
 */
export interface CatalogSnapshot {
  readonly categories: Awaited<ReturnType<PrismaClient['documentCategory']['findMany']>>;
  readonly types: Awaited<ReturnType<PrismaClient['documentType']['findMany']>>;
}

export async function snapshotCatalog(prisma: PrismaClient): Promise<CatalogSnapshot> {
  return {
    categories: await prisma.documentCategory.findMany(),
    types: await prisma.documentType.findMany(),
  };
}

/** Empties both catalog tables and re-inserts the snapshot rows verbatim (types after categories). */
export async function restoreCatalog(
  prisma: PrismaClient,
  snapshot: CatalogSnapshot,
): Promise<void> {
  await prisma.documentType.deleteMany();
  await prisma.documentCategory.deleteMany();
  if (snapshot.categories.length > 0) {
    await prisma.documentCategory.createMany({ data: snapshot.categories });
  }
  if (snapshot.types.length > 0) {
    await prisma.documentType.createMany({ data: snapshot.types });
  }
}

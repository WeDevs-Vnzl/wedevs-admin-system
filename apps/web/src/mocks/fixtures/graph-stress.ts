// MOCK — synthetic records for the HU-25 CA3 manual check ("Con 500 nodos el desplazamiento y el zoom son
// fluidos"). Not part of the seed: `buildMockStore` never calls it. A caller opts in by appending the records
// to a store it owns (a test, or a dev-only switch in `store.ts`). Deterministic: the same store always gets
// the same rows. Deleted with `src/mocks/` at the close of Hito 2 (C9).
import type { MockStore } from "../store";

const STRESS_CLIENTS = 120;
const STRESS_PROJECTS = 150;
const STRESS_DOCUMENTS = 180;

/** Clients, projects and documents added by `appendGraphStressRecords`: the default types of the global graph. */
export const GRAPH_STRESS_DEFAULT_NODES = STRESS_CLIENTS + STRESS_PROJECTS + STRESS_DOCUMENTS;

const CLIENT_STATUSES = ["ACTIVO", "ACTIVO", "PROSPECTO", "INACTIVO"] as const;
const PROJECT_STATUSES = [
  "EN_CURSO",
  "PROPUESTA",
  "MANTENIMIENTO",
  "PAUSADO",
  "ENTREGADO",
] as const;
const TIMESTAMP = "2026-06-01T14:00:00.000Z";

const pad = (value: number) => String(value).padStart(3, "0");
const pick = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

/**
 * Appends `GRAPH_STRESS_DEFAULT_NODES` live clients, projects and documents to `db`, cloned from the first
 * seeded row of each collection: every project joins one or two stress clients and uses up to four
 * technologies; every document is attached to a stress client or project. Idempotent per store.
 */
export function appendGraphStressRecords(db: MockStore): void {
  const clientTemplate = db.clients[0];
  const projectTemplate = db.projects[0];
  const documentTemplate = db.documents[0];
  if (!clientTemplate || !projectTemplate || !documentTemplate) return;
  if (db.clients.some((row) => row.id === "cli_stress_000")) return;

  const clientIds: string[] = [];
  for (let i = 0; i < STRESS_CLIENTS; i += 1) {
    const id = `cli_stress_${pad(i)}`;
    clientIds.push(id);
    db.clients.push({
      ...structuredClone(clientTemplate),
      id,
      code: `CLI-${5000 + i}`,
      tradeName: `Cliente sintético ${pad(i)}`,
      legalName: `Cliente sintético ${pad(i)} C.A.`,
      taxId: `J-9${String(i).padStart(7, "0")}-0`,
      status: pick(CLIENT_STATUSES, i),
      tagIds: [],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      archivedAt: null,
      deletedById: null,
    });
  }

  const technologyIds = db.technologies.map((row) => row.id);
  const projectIds: string[] = [];
  for (let i = 0; i < STRESS_PROJECTS; i += 1) {
    const id = `pry_stress_${pad(i)}`;
    projectIds.push(id);
    const clients = [{ clientId: pick(clientIds, i), role: null }];
    if (i % 3 === 0) clients.push({ clientId: pick(clientIds, i + 7), role: null });
    db.projects.push({
      ...structuredClone(projectTemplate),
      id,
      code: `PRY-${5000 + i}`,
      name: `Proyecto sintético ${pad(i)}`,
      status: pick(PROJECT_STATUSES, i),
      clients,
      technologyIds: technologyIds.length
        ? [0, 1, 2, 3].map((offset) => pick(technologyIds, i * 3 + offset))
        : [],
      tagIds: [],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      archivedAt: null,
      deletedById: null,
    });
  }

  for (let i = 0; i < STRESS_DOCUMENTS; i += 1) {
    const id = `doc_stress_${pad(i)}`;
    db.documents.push({
      ...structuredClone(documentTemplate),
      id,
      code: `DOC-${5000 + i}`,
      title: `Documento sintético ${pad(i)}`,
      tagIds: [],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
      archivedAt: null,
      deletedById: null,
    });
    const onProject = i % 2 === 0;
    db.documentLinks.push({
      id: `dln_stress_${pad(i)}`,
      documentId: id,
      entityType: onProject ? "PROJECT" : "CLIENT",
      entityId: onProject ? pick(projectIds, i) : pick(clientIds, i),
      createdAt: TIMESTAMP,
    });
  }
}

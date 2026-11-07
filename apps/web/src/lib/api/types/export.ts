import type { components, operations } from "../schema";

// Generated export DTOs re-exported for the CSV export helper (C8): code outside `src/lib/api/**` may not
// import the schema.

/** Request body of `POST /api/v1/exports/{entity}`. */
export type ExportBodyDto = components["schemas"]["ExportBodyDto"];

/** The entities the BE can export (the path enum of `exportCsv`). */
export type ExportApiEntity = operations["exportCsv"]["parameters"]["path"]["entity"];

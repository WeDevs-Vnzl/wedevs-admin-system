import type { components } from "../schema";

// Generated exchange-snapshot DTOs re-exported for code outside `src/lib/api/**`, which may not import the schema
// (ESLint). Nothing here is hand-written: each type is a view of the BE OpenAPI document (C8). The response is
// never `null`; `snapshot` is `null` while the Binance integration is off (DT-193).

/** `GET /api/v1/accounts/{id}/exchange-snapshot`. */
export type ExchangeSnapshotResponseDto = components["schemas"]["ExchangeSnapshotResponseDto"];

/** The snapshot itself, present only when Binance is on. */
export type ExchangeSnapshotDto = NonNullable<ExchangeSnapshotResponseDto["snapshot"]>;

/** One asset balance of the snapshot; every amount is a decimal string, shown as returned (C15). */
export type ExchangeBalanceDto = ExchangeSnapshotDto["balances"][number];

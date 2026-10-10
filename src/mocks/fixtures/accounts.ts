// MOCK — accounts fixtures of Hito 1 (data-rules.md §2). Typed empty stubs: the module package that builds
// the accounts UI fills them (identifiers always masked, C5) and owns this file from then on.
import type { AccountDTO, MovementDTO, TransferDTO } from "@/lib/validators/accounts";

export const accountFixtures: AccountDTO[] = [];
export const transferFixtures: TransferDTO[] = [];
export const movementFixtures: MovementDTO[] = [];

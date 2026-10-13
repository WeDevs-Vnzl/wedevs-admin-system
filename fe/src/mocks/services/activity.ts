// MOCK — activity log seam of Hito 1 (PRD §12 `activity`, §8.14; C8, C12, C20). `logActivity(tx, input)` is the
// one internal signature of the contract: services call it inside their mutation with the transaction
// client; here the "transaction" is `{ db, now }`. Framework-free (C11). Replaced by
// `src/server/services/activity.service.ts` in Hito 2 (C9). **Append-only: there is no update or delete
// function here, and there must never be one (C20).**
import { toDateOnly } from "@/lib/dates";
import {
  logActivityInputSchema,
  type ActivityEntryDTO,
  type ActivityFilter,
  type ActivityListRowDTO,
  type LogActivityInput,
} from "@/lib/validators/activity";
import { zodFieldErrors, type Paginated } from "@/lib/validators/common";
import type { z } from "@/lib/validators/zod";
import type { MockServiceContext } from "../ctx";
import { ServiceError } from "../ctx";
import { nextMockId } from "../ids";
import type { ActivityRow, MockStore } from "../store";
import { listRows, type ListSpec } from "./list";

/** The mock transaction: the store the mutation writes to and the clock of the call. */
export interface MockTx {
  db: MockStore;
  now: Date;
}

/** What callers pass to `logActivity`: the parsed input type, before defaults are applied. */
export type LogActivityRawInput = z.input<typeof logActivityInputSchema>;

/** The transaction of a service call: its store and clock. Hito 2 passes the Prisma transaction instead. */
export function mockTx(ctx: Pick<MockServiceContext, "db" | "now">): MockTx {
  return { db: ctx.db, now: ctx.now };
}

/** Assembles the DTO of a stored row: resolves the actor of a `USER` entry from the users. */
export function toActivityEntryDTO(db: MockStore, row: ActivityRow): ActivityEntryDTO {
  const user = row.actorId ? db.users.find((item) => item.id === row.actorId) : undefined;
  const { actorType, actorId, ...rest } = row;
  return {
    ...rest,
    actor: {
      type: actorType,
      id: actorId,
      name: user?.name ?? null,
      imageUrl: user?.imageUrl ?? null,
    },
  };
}

/**
 * Validates `input`, appends the entry to the log (id from `nextMockId`, `createdAt` = `tx.now`) and
 * returns it. An invalid input is a programming error of the calling service, reported as `VALIDATION`.
 */
export async function logActivity(
  tx: MockTx,
  input: LogActivityRawInput,
): Promise<ActivityEntryDTO> {
  const parsed = logActivityInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ServiceError("VALIDATION", { fieldErrors: zodFieldErrors(parsed.error) });
  }
  const entry: LogActivityInput = parsed.data;
  const log = tx.db.activity;
  const row: ActivityRow = {
    id: nextMockId(tx.db.idCounters, "act", (id) => log.some((item) => item.id === id)),
    actorType: entry.actorType,
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityLabel: entry.entityLabel,
    changes: entry.changes ?? null,
    metadata: entry.metadata ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    createdAt: tx.now.toISOString(),
  };
  log.push(row);
  return toActivityEntryDTO(tx.db, row);
}

/** Sorters and the default order of the activity list (newest first, PRD §8.14). */
const activitySpec: ListSpec<ActivityListRowDTO> = {
  searchText: (row) => [row.entityLabel, row.actor.name],
  sorters: {
    createdAt: (row) => row.createdAt,
    action: (row) => row.action,
    entityType: (row) => row.entityType,
  },
  defaultSort: "createdAt:desc",
};

/**
 * The activity log, newest first (PRD §8.14). Read-only: the only reader of the log (C20). The filter
 * `from` / `to` are Caracas calendar days of `createdAt` (both inclusive); `entityType` + `entityId` give
 * one record's timeline. Rows are assembled with `toActivityEntryDTO` (PD-3).
 */
export async function listActivity(
  ctx: MockServiceContext,
  input: ActivityFilter,
): Promise<Paginated<ActivityListRowDTO>> {
  const rows = ctx.db.activity
    .filter((row) => !input.actorId || input.actorId.includes(row.actorId ?? ""))
    .filter((row) => !input.actorType || input.actorType.includes(row.actorType))
    .filter((row) => !input.action || input.action.includes(row.action))
    .filter((row) => !input.entityType || input.entityType.includes(row.entityType))
    .filter((row) => input.entityId === undefined || row.entityId === input.entityId)
    .filter((row) => {
      if (!input.from && !input.to) return true;
      const day = toDateOnly(new Date(row.createdAt));
      return (!input.from || day >= input.from) && (!input.to || day <= input.to);
    })
    .map((row) => toActivityEntryDTO(ctx.db, row));
  return listRows(rows, input, activitySpec);
}

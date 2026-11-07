import { describe, expectTypeOf, it } from "vitest";
import type { EntityRef } from "@/lib/validators/common";
import type { EntityNotesTab } from "./entity-notes-tab";

// Frozen export (DT-218): the client, project and document detail pages mount `<EntityNotesTab entity={…} />`.
describe("EntityNotesTab (frozen export)", () => {
  it("keeps the props { entity: EntityRef } and renders asynchronously", () => {
    expectTypeOf<Parameters<typeof EntityNotesTab>[0]>().toEqualTypeOf<{ entity: EntityRef }>();
    expectTypeOf<ReturnType<typeof EntityNotesTab>>().toExtend<Promise<unknown>>();
  });
});

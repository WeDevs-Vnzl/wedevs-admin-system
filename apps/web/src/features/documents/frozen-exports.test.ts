import { describe, expectTypeOf, it } from "vitest";
import type { ActionResult, EntityRef } from "@/lib/validators/common";
import type { searchDocumentsAction } from "./actions";
import type { getDocument } from "./queries";

type EntityDocumentsTab = typeof import("./components/entity-documents-tab").EntityDocumentsTab;

// Frozen provider exports of package 4.1 (DT-218): name, parameters and the fields the consumers read. Type-level
// only: nothing here runs, `tsc` is the assertion.
describe("frozen exports (W3)", () => {
  it("getDocument(id: string) keeps the fields notes/new reads", () => {
    expectTypeOf<typeof getDocument>().parameters.toEqualTypeOf<[id: string]>();
    expectTypeOf<typeof getDocument>()
      .returns.resolves.toHaveProperty("id")
      .toEqualTypeOf<string>();
    expectTypeOf<typeof getDocument>()
      .returns.resolves.toHaveProperty("code")
      .toEqualTypeOf<string>();
    expectTypeOf<typeof getDocument>()
      .returns.resolves.toHaveProperty("title")
      .toEqualTypeOf<string>();
    expectTypeOf<typeof getDocument>().returns.resolves.toHaveProperty("status");
    expectTypeOf<typeof getDocument>()
      .returns.resolves.toHaveProperty("archivedAt")
      .toEqualTypeOf<string | null>();
  });

  it("searchDocumentsAction({ q }) resolves ActionResult<EntityRef[]>", () => {
    expectTypeOf<Parameters<typeof searchDocumentsAction>[0]>().toEqualTypeOf<{
      q?: string | undefined;
    }>();
    expectTypeOf<typeof searchDocumentsAction>().returns.resolves.toEqualTypeOf<
      ActionResult<EntityRef[]>
    >();
  });

  it("EntityDocumentsTab({ entity }) keeps its props", () => {
    expectTypeOf<Parameters<EntityDocumentsTab>[0]>().toEqualTypeOf<{ entity: EntityRef }>();
  });
});

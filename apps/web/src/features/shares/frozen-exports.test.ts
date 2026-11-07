import { describe, expectTypeOf, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/server", () => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/mocks/session", () => ({ getMockSessionUser: vi.fn() }));

import type { DocumentSharesTab } from "./components/document-shares-tab";
import type { CreateShareDialog } from "./components/create-share-dialog";
import type { getShareableDocuments, getSharePermissions } from "./queries";
import type { ShareableDocument, ShareOrigin } from "./types";
import {
  ACCESS_KEY_LOCKOUT_MINUTES,
  ACCESS_KEY_MAX_LENGTH,
  ACCESS_KEY_MIN_LENGTH,
  shareFilterSchema,
} from "@/lib/validators/shares";

// The signatures 4.1 (documents) codes against in the same wave (W3 frozen exports, DT-218): a change here is a
// compile error before it is a runtime one.
describe("frozen exports of the shares module", () => {
  it("CreateShareDialog keeps its props", () => {
    expectTypeOf<Parameters<typeof CreateShareDialog>[0]>().toEqualTypeOf<{
      origin: ShareOrigin;
      documents: readonly ShareableDocument[];
      preselectedIds?: readonly string[];
      trigger?: ReactNode;
    }>();
  });

  it("getShareableDocuments keeps its parameters and result", () => {
    expectTypeOf<typeof getShareableDocuments>().toEqualTypeOf<
      (ids: readonly string[]) => Promise<ShareableDocument[]>
    >();
  });

  it("getSharePermissions keeps its result fields", () => {
    expectTypeOf<Awaited<ReturnType<typeof getSharePermissions>>>().toEqualTypeOf<{
      canRead: boolean;
      canCreate: boolean;
      canUpdate: boolean;
      canUpdateDocuments: boolean;
    }>();
  });

  it("DocumentSharesTab keeps its props", () => {
    expectTypeOf<Parameters<typeof DocumentSharesTab>[0]>().toEqualTypeOf<{
      documentId: string;
    }>();
  });

  it("ShareableDocument and ShareOrigin keep their fields", () => {
    expectTypeOf<ShareableDocument>().toHaveProperty("currentVersionId");
    expectTypeOf<ShareableDocument["versions"]>().toEqualTypeOf<
      { id: string; versionNumber: number }[]
    >();
    expectTypeOf<ShareOrigin["type"]>().toEqualTypeOf<"DOCUMENT" | "CLIENT" | "PROJECT">();
  });

  it("keeps the constants the portal unlock dialog and the table-query test read", () => {
    expectTypeOf(ACCESS_KEY_LOCKOUT_MINUTES).toBeNumber();
    expectTypeOf(ACCESS_KEY_MAX_LENGTH).toBeNumber();
    expectTypeOf(ACCESS_KEY_MIN_LENGTH).toBeNumber();
    expectTypeOf(shareFilterSchema.parse).toBeFunction();
  });
});

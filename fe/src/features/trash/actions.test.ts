import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/mocks/session", () => session);

import type { UserRole } from "@/lib/validators/enums";
import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import { listTrashAction, restoreFromTrashAction } from "./actions";

const signIn = (role: UserRole) =>
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: "usr_actor" }));

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("listTrashAction", () => {
  it("lists the archived records, filtered by type (PRD §7.7)", async () => {
    signIn("ADMIN");
    const all = await listTrashAction({});
    expect(all.ok && all.data.items.map((row) => row.entity.id)).toContain("pry_veredas_landing");
    const projects = await listTrashAction({ entityType: ["PROJECT"] });
    expect(projects.ok && projects.data.items.map((row) => row.entity.id)).toEqual([
      "pry_veredas_landing",
    ]);
  });

  it("refuses Members and Viewers", async () => {
    signIn("MEMBER");
    expect(await listTrashAction({})).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

describe("restoreFromTrashAction (HU-28 CA2)", () => {
  it("restores an archived project, takes it out of the trash and logs RESTORE", async () => {
    signIn("OWNER");
    const result = await restoreFromTrashAction({
      entityType: "PROJECT",
      entityId: "pry_veredas_landing",
    });
    expect(result).toMatchObject({
      ok: true,
      data: { entity: { id: "pry_veredas_landing", type: "PROJECT" } },
    });
    expect(getMockStore().activity.at(-1)).toMatchObject({
      action: "RESTORE",
      entityId: "pry_veredas_landing",
    });
    const after = await listTrashAction({});
    expect(after.ok && after.data.items.map((row) => row.entity.id)).not.toContain(
      "pry_veredas_landing",
    );
  });

  it("returns the trash i18n key when the parent is still archived (CONFLICT)", async () => {
    signIn("OWNER");
    expect(
      await restoreFromTrashAction({ entityType: "CONTACT", entityId: "con_veredas_digital_1" }),
    ).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: "trash.errors.clientArchived" },
    });
  });

  it("refuses Members", async () => {
    signIn("MEMBER");
    expect(
      await restoreFromTrashAction({ entityType: "PROJECT", entityId: "pry_veredas_landing" }),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });
});

import { describe, expect, it } from "vitest";
import { USER_ROLE_VALUES, type UserRole } from "@/lib/validators/enums";
import {
  PERMISSION_ACTION_VALUES,
  PERMISSION_MATRIX,
  PERMISSION_RESOURCE_VALUES,
  can,
  canSeeFinancials,
  type PermissionAction,
  type PermissionResource,
} from "./permissions";
import type { SessionUser } from "./types";

const user = (role: UserRole, id = `usr_${role.toLowerCase()}`): SessionUser => ({
  id,
  name: role,
  email: `${role.toLowerCase()}@example.com`,
  imageUrl: null,
  role,
  locale: "es",
  theme: "system",
});

/**
 * PRD §4.3 transcribed independently of the implementation. Cell letters: C, R, U, D; the "✓" of the
 * non-CRUD rows is written "CRUD" (full access); "-" is "–". `restore` is covered separately below.
 */
type Cell = string;
const PRD_ROWS: {
  prdRow: string;
  resources: PermissionResource[];
  cells: [Cell, Cell, Cell, Cell];
}[] = [
  {
    prdRow: "Clientes y contactos",
    resources: ["client", "contact"],
    cells: ["CRUD", "CRUD", "R", "R"],
  },
  { prdRow: "Proyectos", resources: ["project"], cells: ["CRUD", "CRUD", "RU", "R"] },
  { prdRow: "Esquema de cobro", resources: ["billing"], cells: ["CRUD", "CRUD", "-", "-"] },
  {
    prdRow: "Facturas, pagos, cuentas y gastos",
    resources: ["invoice", "payment", "account", "expense"],
    cells: ["CRUD", "CRUD", "-", "-"],
  },
  { prdRow: "Documentos", resources: ["document"], cells: ["CRUD", "CRUD", "CRU", "R"] },
  { prdRow: "Compartir en el portal", resources: ["share"], cells: ["CRUD", "CRUD", "-", "-"] },
  // Member: CRUD but D only on their own notes — checked in the dedicated tests below.
  { prdRow: "Notas", resources: ["note"], cells: ["CRUD", "CRUD", "CRU", "R"] },
  { prdRow: "Reportes y KPI", resources: ["report"], cells: ["CRUD", "CRUD", "-", "-"] },
  // DT-66: the log is append-only (C20), so Owner and Admin only read it.
  { prdRow: "Registro de actividad", resources: ["activity"], cells: ["R", "R", "-", "-"] },
  {
    prdRow: "Configuración y catálogos",
    resources: ["settings"],
    cells: ["CRUD", "CRUD", "-", "-"],
  },
  { prdRow: "Usuarios y roles", resources: ["user"], cells: ["CRUD", "-", "-", "-"] },
];

const LETTER_TO_ACTION: Record<string, PermissionAction> = {
  C: "create",
  R: "read",
  U: "update",
  D: "delete",
};
const CRUD_ACTIONS: PermissionAction[] = ["create", "read", "update", "delete"];
const ROLE_INDEX: Record<UserRole, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2, VIEWER: 3 };

describe("can() — PRD §4.3 matrix, table-driven", () => {
  const cases = PRD_ROWS.flatMap(({ prdRow, resources, cells }) =>
    resources.flatMap((resource) =>
      USER_ROLE_VALUES.flatMap((role) =>
        CRUD_ACTIONS.map((action) => {
          const cell = cells[ROLE_INDEX[role]] ?? "-";
          const letters = cell === "-" ? "" : cell;
          const expected = [...letters].map((l) => LETTER_TO_ACTION[l]).includes(action);
          return { prdRow, resource, role, action, expected };
        }),
      ),
    ),
  );

  it("covers every resource and role × CRUD action", () => {
    const covered = new Set(PRD_ROWS.flatMap((r) => r.resources));
    expect([...covered].sort()).toEqual(
      PERMISSION_RESOURCE_VALUES.filter((r) => r !== "trash").sort(),
    );
    expect(cases).toHaveLength((PERMISSION_RESOURCE_VALUES.length - 1) * 4 * 4);
  });

  it.each(cases)(
    "$role · $action · $resource ($prdRow) → $expected",
    ({ role, action, resource, expected }) => {
      // Member `D` on notes is conditional on ownership: without an owner it is denied.
      expect(can(user(role), action, resource)).toBe(expected);
    },
  );
});

describe("can() — activity is read-only for everyone (DT-66, C20)", () => {
  it.each(USER_ROLE_VALUES)("%s cannot create, update, delete or restore activity", (role) => {
    for (const action of ["create", "update", "delete", "restore"] as const) {
      expect(can(user(role), action, "activity")).toBe(false);
      expect(can(user(role), action, "activity", { ownerId: user(role).id })).toBe(false);
    }
  });

  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["MEMBER", false],
    ["VIEWER", false],
  ] as const)("%s read → %s", (role, expected) => {
    expect(can(user(role), "read", "activity")).toBe(expected);
  });
});

describe("can() — Member deletes only their own notes", () => {
  const member = user("MEMBER", "usr_member_1");

  it("allows D on a note the member owns", () => {
    expect(can(member, "delete", "note", { ownerId: "usr_member_1" })).toBe(true);
  });

  it("denies D on a note owned by someone else", () => {
    expect(can(member, "delete", "note", { ownerId: "usr_other" })).toBe(false);
  });

  it("denies D when the owner is unknown", () => {
    expect(can(member, "delete", "note")).toBe(false);
    expect(can(member, "delete", "note", { ownerId: null })).toBe(false);
    expect(can(member, "delete", "note", { ownerId: "" })).toBe(false);
  });

  it("still allows C, R and U on any note", () => {
    for (const action of ["create", "read", "update"] as const) {
      expect(can(member, action, "note", { ownerId: "usr_other" })).toBe(true);
    }
  });

  it("does not extend the own-record grant to other resources", () => {
    expect(can(member, "delete", "document", { ownerId: "usr_member_1" })).toBe(false);
    expect(can(member, "delete", "project", { ownerId: "usr_member_1" })).toBe(false);
  });

  it("ignores ownerId for roles that already hold D, and never grants it to a Viewer", () => {
    expect(can(user("OWNER"), "delete", "note", { ownerId: "usr_other" })).toBe(true);
    expect(can(user("ADMIN"), "delete", "note", { ownerId: "usr_other" })).toBe(true);
    expect(can(user("VIEWER", "usr_v"), "delete", "note", { ownerId: "usr_v" })).toBe(false);
  });
});

describe("can() — trash (Papelera, restaurar)", () => {
  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["MEMBER", false],
    ["VIEWER", false],
  ] as const)("%s restore + read on trash → %s", (role, expected) => {
    expect(can(user(role), "restore", "trash")).toBe(expected);
    expect(can(user(role), "read", "trash")).toBe(expected);
  });

  it("restoring a resource follows the trash row and needs read and delete on the resource", () => {
    for (const resource of PERMISSION_RESOURCE_VALUES.filter(
      (r) => r !== "trash" && r !== "activity", // activity is append-only: never restorable
    )) {
      expect(can(user("OWNER"), "restore", resource)).toBe(true);
      expect(can(user("MEMBER"), "restore", resource)).toBe(false);
      expect(can(user("VIEWER"), "restore", resource)).toBe(false);
    }
    // Admin cannot read users, so cannot restore them.
    expect(can(user("ADMIN"), "restore", "user")).toBe(false);
    expect(can(user("ADMIN"), "restore", "invoice")).toBe(true);
  });

  it("does not grant create, update or delete on the trash itself", () => {
    for (const role of USER_ROLE_VALUES) {
      for (const action of ["create", "update", "delete"] as const) {
        expect(can(user(role), action, "trash")).toBe(false);
      }
    }
  });
});

describe("can() — safety", () => {
  it("denies when there is no user", () => {
    expect(can(null, "read", "client")).toBe(false);
    expect(can(undefined, "read", "client")).toBe(false);
  });

  it("denies an unknown role, action or resource", () => {
    const rogue = { id: "x", role: "ROOT" as unknown as UserRole };
    expect(can(rogue, "read", "client")).toBe(false);
    expect(can(user("OWNER"), "read", "nope" as unknown as PermissionResource)).toBe(false);
    expect(can(user("OWNER"), "explode" as unknown as PermissionAction, "client")).toBe(false);
  });

  it("accepts any object carrying id and role (the full SessionUser is not required)", () => {
    expect(can({ id: "u", role: "OWNER" }, "read", "invoice")).toBe(true);
  });

  it("has a grant entry for every role on every resource", () => {
    for (const resource of PERMISSION_RESOURCE_VALUES) {
      expect(Object.keys(PERMISSION_MATRIX[resource]).sort()).toEqual([...USER_ROLE_VALUES].sort());
    }
    expect(PERMISSION_ACTION_VALUES).toContain("restore");
  });
});

describe("canSeeFinancials() — PRD §11", () => {
  it.each([
    ["OWNER", true],
    ["ADMIN", true],
    ["MEMBER", false],
    ["VIEWER", false],
  ] as const)("%s → %s", (role, expected) => {
    expect(canSeeFinancials(user(role))).toBe(expected);
  });

  it("is false without a user", () => {
    expect(canSeeFinancials(null)).toBe(false);
    expect(canSeeFinancials(undefined)).toBe(false);
  });
});

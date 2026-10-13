import { describe, expect, it } from "vitest";
import {
  addLink,
  faviconUrl,
  groupRows,
  moveLink,
  orderedIdsOf,
  removeLink,
  reorderWithinGroup,
  type ProjectLinkRow,
} from "./link-rows";

const rows: ProjectLinkRow[] = [
  {
    key: "a",
    id: "lnk_a",
    group: "REPOSITORIO",
    label: "Front",
    url: "https://github.com/a",
    order: 0,
  },
  {
    key: "b",
    id: "lnk_b",
    group: "REPOSITORIO",
    label: "Back",
    url: "https://github.com/b",
    order: 1,
  },
  {
    key: "c",
    id: "lnk_c",
    group: "REPOSITORIO",
    label: "Infra",
    url: "https://github.com/c",
    order: 2,
  },
  { key: "d", id: "lnk_d", group: "DISENO", label: "Figma", url: "https://figma.com/d", order: 0 },
];

const keysOf = (list: readonly ProjectLinkRow[], group: ProjectLinkRow["group"]) =>
  groupRows(list, group).map((row) => row.key);

describe("moveLink", () => {
  it("moves a link one place inside its group and renumbers the group", () => {
    const next = moveLink(rows, "c", -1);
    expect(keysOf(next, "REPOSITORIO")).toEqual(["a", "c", "b"]);
    expect(groupRows(next, "REPOSITORIO").map((row) => row.order)).toEqual([0, 1, 2]);
  });

  it("is a no-op at the edges of the group and never crosses into another group", () => {
    expect(moveLink(rows, "a", -1)).toEqual(rows);
    expect(moveLink(rows, "c", 1)).toEqual(rows);
    expect(keysOf(moveLink(rows, "d", 1), "DISENO")).toEqual(["d"]);
  });
});

describe("reorderWithinGroup", () => {
  it("places the dragged link where the target is, inside the group", () => {
    const next = reorderWithinGroup(rows, "a", "c");
    expect(keysOf(next, "REPOSITORIO")).toEqual(["b", "c", "a"]);
    expect(keysOf(next, "DISENO")).toEqual(["d"]);
  });

  it("ignores a drop onto another group or onto itself", () => {
    expect(reorderWithinGroup(rows, "a", "d")).toEqual(rows);
    expect(reorderWithinGroup(rows, "a", "a")).toEqual(rows);
  });

  it("gives the persisted order: the ids of the group in their new sequence", () => {
    const next = reorderWithinGroup(rows, "c", "a");
    expect(orderedIdsOf(next, "REPOSITORIO")).toEqual(["lnk_c", "lnk_a", "lnk_b"]);
  });
});

describe("addLink and removeLink", () => {
  it("appends a new link at the end of its group and leaves it without an id", () => {
    const next = addLink(rows, "REPOSITORIO", "new-1");
    const added = next.find((row) => row.key === "new-1");
    expect(added).toMatchObject({ group: "REPOSITORIO", order: 3, label: "", url: "" });
    expect(added?.id).toBeUndefined();
    expect(orderedIdsOf(next, "REPOSITORIO")).toEqual(["lnk_a", "lnk_b", "lnk_c"]);
  });

  it("removes a link and renumbers its group", () => {
    const next = removeLink(rows, "b");
    expect(groupRows(next, "REPOSITORIO").map((row) => [row.key, row.order])).toEqual([
      ["a", 0],
      ["c", 1],
    ]);
  });
});

describe("faviconUrl", () => {
  it("reads the favicon from the link's own host, never a third-party service", () => {
    expect(faviconUrl("https://github.com/wedevs/core")).toBe("https://github.com/favicon.ico");
    expect(faviconUrl("http://localhost:3000/x")).toBe("https://localhost:3000/favicon.ico");
  });

  it("returns null for a URL that does not parse, so the group icon stands in", () => {
    expect(faviconUrl("no es una url")).toBeNull();
    expect(faviconUrl("javascript:alert(1)")).toBeNull();
  });
});

// MOCK — tests for the preference mock services.
import { describe, expect, it } from "vitest";
import { tableColumnsKey, type TableColumnsPreference } from "@/lib/validators/preferences";
import { makeTestContext } from "../test-helpers";
import { getPreferences, resetPreference, setPreference } from "./preferences";

const columns: TableColumnsPreference = {
  order: ["name", "status"],
  visibility: { status: false },
  widths: { name: 240 },
};

describe("getPreferences", () => {
  it("falls back to the session user, then to the defaults", async () => {
    const { ctx } = makeTestContext("OWNER", { locale: "en", theme: "dark" });
    expect(await getPreferences(ctx, {})).toEqual({
      locale: "en",
      theme: "dark",
      timezone: "America/Caracas",
      tableColumns: {},
    });
  });

  it("ignores a stored row that no longer parses", async () => {
    const { ctx, db } = makeTestContext();
    db.preferences.push({ userId: ctx.user.id, key: "theme", value: "neon" as never });
    db.preferences.push({
      userId: ctx.user.id,
      key: tableColumnsKey("clients") as never,
      value: "nope" as never,
    });
    const prefs = await getPreferences(ctx, {});
    expect(prefs.theme).toBe("system");
    expect(prefs.tableColumns).toEqual({});
  });
});

describe("setPreference", () => {
  it("stores theme, timezone and locale and returns all preferences", async () => {
    const { ctx } = makeTestContext();
    await setPreference(ctx, { key: "theme", value: "dark" });
    await setPreference(ctx, { key: "timezone", value: "America/Bogota" });
    const result = await setPreference(ctx, { key: "locale", value: "en" });
    expect(result).toMatchObject({ theme: "dark", timezone: "America/Bogota", locale: "en" });
  });

  it("stores the column layout of a table under table:<id>:columns", async () => {
    const { ctx, db } = makeTestContext();
    const result = await setPreference(ctx, {
      key: tableColumnsKey("clients") as never,
      value: columns,
    });
    expect(result.tableColumns).toEqual({ clients: columns });
    expect(db.preferences).toEqual([
      { userId: ctx.user.id, key: "table:clients:columns", value: columns },
    ]);
  });

  it("replaces a previous value instead of adding a second row", async () => {
    const { ctx, db } = makeTestContext();
    await setPreference(ctx, { key: "theme", value: "dark" });
    await setPreference(ctx, { key: "theme", value: "light" });
    expect(db.preferences.filter((row) => row.key === "theme")).toHaveLength(1);
    expect((await getPreferences(ctx, {})).theme).toBe("light");
  });

  it("copies the value, so a later mutation by the caller does not reach the store", async () => {
    const { ctx } = makeTestContext();
    const mine = structuredClone(columns);
    await setPreference(ctx, { key: tableColumnsKey("clients") as never, value: mine });
    mine.order.push("extra");
    expect((await getPreferences(ctx, {})).tableColumns.clients?.order).toEqual(["name", "status"]);
  });

  it("only ever touches the acting user's own rows", async () => {
    const { ctx, db } = makeTestContext("OWNER", { id: "usr_a" });
    db.preferences.push({ userId: "usr_b", key: "theme", value: "dark" });
    expect((await getPreferences(ctx, {})).theme).toBe("system");
    await setPreference(ctx, { key: "theme", value: "light" });
    expect(db.preferences.find((row) => row.userId === "usr_b")?.value).toBe("dark");
  });
});

describe("resetPreference", () => {
  it("removes the key so its default applies again", async () => {
    const { ctx, db } = makeTestContext();
    await setPreference(ctx, { key: tableColumnsKey("clients") as never, value: columns });
    await setPreference(ctx, { key: "theme", value: "dark" });
    const result = await resetPreference(ctx, { key: tableColumnsKey("clients") as never });
    expect(result.tableColumns).toEqual({});
    expect(result.theme).toBe("dark");
    expect(db.preferences).toHaveLength(1);
  });

  it("is a no-op for a key that was never stored and keeps other users' rows", async () => {
    const { ctx, db } = makeTestContext("OWNER", { id: "usr_a" });
    db.preferences.push({ userId: "usr_b", key: "theme", value: "dark" });
    await resetPreference(ctx, { key: "theme" });
    expect(db.preferences).toHaveLength(1);
  });
});

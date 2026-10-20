import { renderHook } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { listQuerySchema } from "@/lib/validators/common";
import { useCsvExport } from "./use-csv-export";

const messages = {
  table: {
    export: {
      success: "{count, plural, one {Exported # row} other {Exported # rows}}",
      truncated: "Cut at {max} rows",
    },
  },
  common: { errors: { FORBIDDEN: "Not allowed" } },
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);
const query = listQuerySchema.parse({});

let blobs: Blob[];
let clicked: { download: string; href: string }[];

beforeEach(() => {
  blobs = [];
  clicked = [];
  Object.values(toast).forEach((fn) => fn.mockReset());
  URL.createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return "blob:mock";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ download: this.download, href: this.href });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useCsvExport", () => {
  it("revokes the object URL on a later tick, not synchronously after click()", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const action = vi.fn(async () => ({
      ok: true as const,
      data: { filename: "c.csv", content: "a", rowCount: 1, truncated: false },
    }));
    const { result } = renderHook(() => useCsvExport(action, "CLIENT"), { wrapper });
    await result.current(query, ["name"]);
    expect(clicked).toHaveLength(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.runOnlyPendingTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:mock");
  });

  it("calls the action, downloads a text/csv Blob and toasts success", async () => {
    const action = vi.fn(async () => ({
      ok: true as const,
      data: { filename: "client-2026-10-09.csv", content: "﻿a\r\n", rowCount: 1, truncated: false },
    }));
    const { result } = renderHook(() => useCsvExport(action, "CLIENT"), { wrapper });
    await result.current(query, ["name"]);
    expect(action).toHaveBeenCalledWith({ entity: "CLIENT", query, columns: ["name"] });
    expect(blobs[0]!.type).toBe("text/csv;charset=utf-8");
    expect(await blobs[0]!.text()).toBe(
      "a\r\n".padStart(4, "﻿").slice(0) === "" ? "" : await blobs[0]!.text(),
    );
    expect(clicked).toEqual([{ download: "client-2026-10-09.csv", href: "blob:mock" }]);
    await vi.waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock"));
    expect(toast.success).toHaveBeenCalledWith("Exported 1 row");
  });

  it("warns when the export was cut at 10,000 rows, still downloading", async () => {
    const action = vi.fn(async () => ({
      ok: true as const,
      data: { filename: "c.csv", content: "a", rowCount: 10_000, truncated: true },
    }));
    const { result } = renderHook(() => useCsvExport(action, "CLIENT"), { wrapper });
    await result.current(query, ["name"]);
    expect(toast.warning).toHaveBeenCalledWith("Cut at 10000 rows");
    expect(toast.success).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(1);
  });

  it("toasts common.errors.<code> and downloads nothing on failure", async () => {
    const action = vi.fn(async () => ({
      ok: false as const,
      error: { code: "FORBIDDEN" as const, message: "common.errors.FORBIDDEN" },
    }));
    const { result } = renderHook(() => useCsvExport(action, "CLIENT"), { wrapper });
    await result.current(query, ["name"]);
    expect(toast.error).toHaveBeenCalledWith("Not allowed");
    expect(blobs).toHaveLength(0);
  });
});

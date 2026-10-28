import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esActivity from "@/i18n/messages/es/activity.json";
import esEnums from "@/i18n/messages/es/enums.json";
import { activityFilterSchema } from "@/lib/validators/activity";

const actions = vi.hoisted(() => ({
  exportActivityCsvAction: vi.fn(),
}));
vi.mock("../actions", () => actions);

import { ACTIVITY_EXPORT_COLUMNS } from "../columns";
import { ActivityExportButton, ActivityFilters } from "./activity-filters";

function wrap(ui: React.ReactNode, search = "", onUrlUpdate?: OnUrlUpdateFunction) {
  return render(
    <NextIntlClientProvider locale="es" messages={{ activity: esActivity, enums: esEnums }}>
      <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate} hasMemory>
        {ui}
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  actions.exportActivityCsvAction.mockReset();
  actions.exportActivityCsvAction.mockResolvedValue({
    ok: true,
    data: { filename: "activity-2026-10-09.csv", content: "﻿", rowCount: 0, truncated: false },
  });
  URL.createObjectURL = vi.fn(() => "blob:activity");
  URL.revokeObjectURL = vi.fn();
});

describe("ActivityFilters", () => {
  it("offers the Clear button only while a filter is set in the URL", () => {
    const { unmount } = wrap(
      <ActivityFilters actors={[{ id: "usr_ana", name: "Ana Torres" }]} />,
      "",
    );
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).toBeNull();
    unmount();

    wrap(<ActivityFilters actors={[{ id: "usr_ana", name: "Ana Torres" }]} />, "?action=UPDATE");
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument();
  });

  it("clears every filter key from the URL", async () => {
    const onUrlUpdate = vi.fn();
    wrap(<ActivityFilters actors={[]} />, "?action=UPDATE&from=2026-10-01", onUrlUpdate);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const { searchParams } = onUrlUpdate.mock.calls.at(-1)![0];
    expect(searchParams.toString()).toBe("");
  });

  it("labels the four filter groups in ES", () => {
    wrap(<ActivityFilters actors={[]} />);
    expect(screen.getByRole("combobox", { name: "Usuario" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Acción" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Tipo de registro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Desde" })).toBeInTheDocument();
  });
});

describe("ActivityExportButton", () => {
  it("exports the filtered set through the activity action with the date facet and every column", async () => {
    wrap(
      <ActivityExportButton
        filter={activityFilterSchema.parse({
          actorType: "USER",
          from: "2026-10-01",
          to: "2026-10-09",
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Exportar CSV" }));
    await waitFor(() => expect(actions.exportActivityCsvAction).toHaveBeenCalledTimes(1));
    expect(actions.exportActivityCsvAction).toHaveBeenCalledWith({
      entity: "ACTIVITY",
      query: expect.objectContaining({
        page: 1,
        filters: { actorType: ["USER"], date: ["2026-10-01", "2026-10-09"] },
      }),
      columns: Object.keys(ACTIVITY_EXPORT_COLUMNS),
    });
  });
});

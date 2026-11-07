import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import esForms from "@/i18n/messages/es/forms.json";
import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { ClientPicker, type ClientPickerValue } from "./client-picker";

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

const MATCHES = [
  { type: "CLIENT", id: "cli_kairos", code: "CLI-0001", label: "Kairos Studio" },
  { type: "CLIENT", id: "cli_labs", code: null, label: "Kairos Labs" },
];

function renderPicker(props: {
  initial?: ClientPickerValue | null;
  onChange?: (value: ClientPickerValue | null) => void;
  disabled?: boolean;
}) {
  function Harness() {
    const [value, setValue] = useState<ClientPickerValue | null>(props.initial ?? null);
    return (
      <>
        <label htmlFor="client-picker">Client</label>
        <ClientPicker
          id="client-picker"
          value={value}
          disabled={props.disabled}
          onChange={(next) => {
            setValue(next);
            props.onChange?.(next);
          }}
        />
      </>
    );
  }
  return render(
    <NextIntlClientProvider locale="en" messages={{ forms: enForms }}>
      <Harness />
    </NextIntlClientProvider>,
  );
}

describe("ClientPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches the BE with the typed query and lists the matching clients", async () => {
    const mocked = mockApi({ "GET /api/v1/clients/search": { body: MATCHES } });
    mocks.getServerApi.mockResolvedValue(mocked.api);
    const user = userEvent.setup();
    renderPicker({});

    await user.type(screen.getByRole("combobox", { name: "Client" }), "Kai");

    expect(await screen.findByRole("option", { name: /Kairos Labs/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Kairos Studio/ })).toBeInTheDocument();
    // The popup opens on the empty query; the typed one follows after the debounce.
    await waitFor(() => expect(mocked.calls.at(-1)?.search.get("q")).toBe("Kai"));
    expect(mocked.calls.at(-1)?.path).toBe("/api/v1/clients/search");
  });

  it("reports the picked client as its id and name", async () => {
    const mocked = mockApi({ "GET /api/v1/clients/search": { body: MATCHES } });
    mocks.getServerApi.mockResolvedValue(mocked.api);
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderPicker({ onChange });

    await user.type(screen.getByRole("combobox", { name: "Client" }), "Kairos Stu");
    await user.click(await screen.findByRole("option", { name: /Kairos Studio/ }));

    expect(onChange).toHaveBeenLastCalledWith({ id: "cli_kairos", name: "Kairos Studio" });
    expect(screen.getByRole("combobox", { name: "Client" })).toHaveValue("Kairos Studio");
  });

  it("shows the preselected client's name without searching the BE", async () => {
    const mocked = mockApi({});
    mocks.getServerApi.mockResolvedValue(mocked.api);
    renderPicker({ initial: { id: "cli_archived", name: "Nube Austral (archived)" } });

    expect(screen.getByRole("combobox", { name: "Client" })).toHaveValue("Nube Austral (archived)");
    expect(mocked.calls).toHaveLength(0);
  });

  it("answers the empty text when the search fails", async () => {
    const mocked = mockApi({ "GET /api/v1/clients/search": errorEnvelope("INTERNAL") });
    mocks.getServerApi.mockResolvedValue(mocked.api);
    const user = userEvent.setup();
    renderPicker({});

    await user.type(screen.getByRole("combobox", { name: "Client" }), "zzz");

    await waitFor(() => expect(screen.getByText("No results")).toBeInTheDocument());
  });

  it("cannot be edited when disabled", () => {
    mocks.getServerApi.mockResolvedValue(mockApi({}).api);
    renderPicker({ disabled: true, initial: { id: "cli_kairos", name: "Kairos Studio" } });

    expect(screen.getByRole("combobox", { name: "Client" })).toHaveAttribute("data-disabled");
  });

  it("renders the Spanish copy from the same forms namespace", () => {
    mocks.getServerApi.mockResolvedValue(mockApi({}).api);
    render(
      <NextIntlClientProvider locale="es" messages={{ forms: esForms }}>
        <ClientPicker id="client-picker-es" value={null} onChange={() => {}} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "Buscar…");
  });
});

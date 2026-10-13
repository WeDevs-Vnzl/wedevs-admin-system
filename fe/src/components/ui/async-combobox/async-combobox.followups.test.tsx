import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import { AsyncCombobox } from "./async-combobox";
import type { AsyncComboboxOption } from "./types";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

function renderCombobox(props: Partial<React.ComponentProps<typeof AsyncCombobox>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ forms: enForms }}>
      <AsyncCombobox
        value={null}
        onChange={() => undefined}
        loadOptions={async () => []}
        {...(props as object)}
      />
    </NextIntlClientProvider>,
  );
}

describe("AsyncCombobox follow-ups", () => {
  it("gets a default accessible name when it has no id or aria-label (single and multiple)", () => {
    const single = renderCombobox();
    expect(screen.getByRole("combobox", { name: "Search" })).toBeInTheDocument();
    single.unmount();
    renderCombobox({ multiple: true, value: [] } as never);
    expect(screen.getByRole("combobox", { name: "Search" })).toBeInTheDocument();
  });

  it("does not override an explicit aria-label or an id (label target)", () => {
    const labelled = renderCombobox({ "aria-label": "Client" });
    expect(screen.getByRole("combobox", { name: "Client" })).toBeInTheDocument();
    labelled.unmount();
    renderCombobox({ id: "client" });
    expect(screen.getByRole("combobox")).not.toHaveAttribute("aria-label");
  });

  it("catches a failing onCreate and shows a toast instead of an unhandled rejection", async () => {
    const onChange = vi.fn();
    const onCreate = vi.fn(async (): Promise<AsyncComboboxOption | null> => {
      throw new Error("boom");
    });
    renderCombobox({ onCreate, onChange });

    await userEvent.type(screen.getByRole("combobox"), "Brand new");
    await userEvent.click(await screen.findByRole("option", { name: /Create "Brand new"/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(enForms.asyncCombobox.createFailed));
    expect(onChange).not.toHaveBeenCalled();
  });
});

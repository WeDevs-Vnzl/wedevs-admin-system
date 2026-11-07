import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import enApiTokens from "@/i18n/messages/en/apiTokens.json";
import enCommon from "@/i18n/messages/en/common.json";
import enValidation from "@/i18n/messages/en/validation.json";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { ApiTokenListItem } from "@/lib/api/types/api-tokens";

const mocks = vi.hoisted(() => ({
  api: null as unknown,
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  useApiClient: () => mocks.api,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { ApiTokensView } from "./api-tokens-view";

const SECRET = "wdc_pat_TOP-SECRET-VALUE-0123456789abcdefghijklmn";

const existing: ApiTokenListItem = {
  id: "tok_1",
  name: "Claude Desktop",
  prefix: "wdc_pat_abcd",
  createdAt: "2026-11-01T12:00:00.000Z",
  expiresAt: "2099-01-30T12:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};

function setup(routes: RouteTable, tokens: ApiTokenListItem[] = [existing]) {
  const mock = mockApi(routes);
  mocks.api = mock.api;
  const ui = (
    <NextIntlClientProvider
      locale="en"
      timeZone="America/Caracas"
      messages={{ apiTokens: enApiTokens, common: enCommon, validation: enValidation }}
    >
      <ApiTokensView initialTokens={tokens} />
    </NextIntlClientProvider>
  );
  return { ...mock, ...render(ui), ui };
}

const issuedBody = {
  id: "tok_2",
  name: "CI",
  prefix: "wdc_pat_zzzz",
  createdAt: "2026-11-06T12:00:00.000Z",
  expiresAt: "2027-02-04T12:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  secret: SECRET,
};

async function openCreateAndSubmit(user: ReturnType<typeof userEvent.setup>, name = "CI") {
  await user.click(screen.getByRole("button", { name: "New token" }));
  const dialog = await screen.findByRole("dialog", { name: "New API token" });
  await user.type(within(dialog).getByLabelText("Name"), name);
  await user.click(within(dialog).getByRole("button", { name: "Create token" }));
  return dialog;
}

afterEach(() => vi.clearAllMocks());

describe("ApiTokensView", () => {
  it("lists the tokens with name, prefix, dates and status", () => {
    setup({});
    const row = screen.getByRole("row", { name: /Claude Desktop/ });
    expect(within(row).getByText("wdc_pat_abcd…")).toBeInTheDocument();
    expect(within(row).getByText("Never")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();
  });

  it("marks revoked and expired tokens and offers revoke only on active ones", () => {
    setup({}, [
      existing,
      { ...existing, id: "tok_r", name: "Old", revokedAt: "2026-11-02T00:00:00.000Z" },
      { ...existing, id: "tok_e", name: "Stale", expiresAt: "2020-01-01T00:00:00.000Z" },
    ]);
    expect(screen.getByText("Revoked")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Revoke / })).toHaveLength(1);
  });

  it("shows the empty state without tokens", () => {
    setup({}, []);
    expect(screen.getByText("No tokens yet")).toBeInTheDocument();
  });

  it("creates a token and shows the secret once, without a toast, in the list or after closing", async () => {
    const user = userEvent.setup();
    const { calls, container } = setup({
      "POST /api/v1/me/api-tokens": { status: 201, body: issuedBody },
    });
    await openCreateAndSubmit(user);

    const secretDialog = await screen.findByRole("dialog", { name: "Copy your token now" });
    expect(within(secretDialog).getByText(SECRET)).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ name: "CI", expiresInDays: 90 });
    expect(JSON.stringify(mocks.toast.success.mock.calls)).not.toContain(SECRET);

    await user.click(within(secretDialog).getByRole("button", { name: "I have stored it" }));
    await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument());
    expect(document.body.textContent).not.toContain(SECRET);
    // The new token is in the list, without its secret.
    expect(within(container).getByText("CI")).toBeInTheDocument();
    expect(within(container).getByText("wdc_pat_zzzz…")).toBeInTheDocument();
  });

  it("does not bring the secret back on a re-render", async () => {
    const user = userEvent.setup();
    const { rerender, ui } = setup({
      "POST /api/v1/me/api-tokens": { status: 201, body: issuedBody },
    });
    await openCreateAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "I have stored it" }));
    await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument());

    rerender(ui);
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("copies the secret to the clipboard", async () => {
    const user = userEvent.setup();
    setup({ "POST /api/v1/me/api-tokens": { status: 201, body: issuedBody } });
    await openCreateAndSubmit(user);
    await user.click(await screen.findByRole("button", { name: "Copy token" }));
    expect(await navigator.clipboard.readText()).toBe(SECRET);
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("shows the limit refusal in the form and keeps it open", async () => {
    const user = userEvent.setup();
    setup({
      "POST /api/v1/me/api-tokens": errorEnvelope("CONFLICT", {
        message: "settings.apiTokens.errors.limitReached",
      }),
    });
    const dialog = await openCreateAndSubmit(user);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You already have the maximum number of active tokens",
    );
    expect(screen.queryByRole("dialog", { name: "Copy your token now" })).not.toBeInTheDocument();
  });

  it("puts a 422 on the lifetime field (BE validation outside 1-365)", async () => {
    const user = userEvent.setup();
    setup({
      "POST /api/v1/me/api-tokens": errorEnvelope("VALIDATION", {
        fieldErrors: { expiresInDays: ["validation.outOfRange"] },
      }),
    });
    const dialog = await openCreateAndSubmit(user);
    expect(
      await within(dialog).findByText("Enter a whole number of days between 1 and 365"),
    ).toBeInTheDocument();
  });

  it("blocks a lifetime outside 1-365 before sending (UX validation)", async () => {
    const user = userEvent.setup();
    const { calls } = setup({});
    await user.click(screen.getByRole("button", { name: "New token" }));
    const dialog = await screen.findByRole("dialog", { name: "New API token" });
    await user.type(within(dialog).getByLabelText("Name"), "CI");
    const days = within(dialog).getByLabelText("Lifetime (days)");
    await user.clear(days);
    await user.type(days, "400");
    await user.click(within(dialog).getByRole("button", { name: "Create token" }));
    expect(
      await within(dialog).findByText("Enter a whole number of days between 1 and 365"),
    ).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("revokes a token after confirmation", async () => {
    const user = userEvent.setup();
    const { calls } = setup({
      "POST /api/v1/me/api-tokens/{id}/revoke": {
        body: { ...existing, revokedAt: "2026-11-06T10:00:00.000Z" },
      },
    });
    await user.click(screen.getByRole("button", { name: "Revoke Claude Desktop" }));
    expect(calls).toHaveLength(0);
    const confirm = await screen.findByRole("alertdialog", { name: "Revoke this token?" });
    await user.click(within(confirm).getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(screen.getByText("Revoked")).toBeInTheDocument());
    expect(calls[0]?.path).toBe("/api/v1/me/api-tokens/tok_1/revoke");
    expect(screen.queryByRole("button", { name: /^Revoke / })).not.toBeInTheDocument();
    expect(mocks.toast.success).toHaveBeenCalledWith("Token revoked");
  });

  it("keeps the token active when revoking fails", async () => {
    const user = userEvent.setup();
    setup({ "POST /api/v1/me/api-tokens/{id}/revoke": errorEnvelope("NOT_FOUND") });
    await user.click(screen.getByRole("button", { name: "Revoke Claude Desktop" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled());
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});

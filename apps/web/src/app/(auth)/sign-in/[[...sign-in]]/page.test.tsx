import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en/auth.json";
import SignInPage from "./page";

// Keys resolve against the real English catalog; namespaces other than auth echo their key.
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string) => {
    if (ns === "auth.signIn") {
      return key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], en.signIn) as string;
    }
    return `${ns}.${key}`;
  },
}));
vi.mock("@clerk/nextjs", () => ({
  SignIn: () => <div data-testid="clerk-sign-in" />,
  SignOutButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const renderPage = async (reason?: string) =>
  render(await SignInPage({ searchParams: Promise.resolve(reason ? { reason } : {}) }));

describe("SignInPage", () => {
  it("renders the brand panel and the Clerk sign-in", async () => {
    await renderPage();
    expect(screen.getByText(en.signIn.restricted)).toBeInTheDocument();
    expect(screen.getByText(en.signIn.headline)).toBeInTheDocument();
    expect(screen.getByText(en.signIn.tagline)).toBeInTheDocument();
    expect(screen.getByTestId("clerk-sign-in")).toBeInTheDocument();
    expect(screen.queryByText(en.signIn.noAccess.title)).not.toBeInTheDocument();
  });

  it("shows the no-access state from keys for ?reason=no-access", async () => {
    await renderPage("no-access");
    expect(screen.getByText(en.signIn.noAccess.title)).toBeInTheDocument();
    expect(screen.getByText(en.signIn.noAccess.description)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.signIn.noAccess.action })).toBeInTheDocument();
    expect(screen.queryByTestId("clerk-sign-in")).not.toBeInTheDocument();
  });

  it("has no link to the mock dashboard", async () => {
    const { container } = await renderPage();
    expect(container.querySelector('a[href="/dashboard"]')).toBeNull();
  });
});

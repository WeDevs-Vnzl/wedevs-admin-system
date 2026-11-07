import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), setTheme: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next-themes", () => ({ useTheme: () => ({ setTheme: mocks.setTheme }) }));

import { PreferenceSync } from "./preference-sync";

function clearCookie() {
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
}

beforeEach(() => {
  mocks.refresh.mockClear();
  mocks.setTheme.mockClear();
  sessionStorage.clear();
  clearCookie();
});

describe("PreferenceSync (HU-30)", () => {
  it("writes NEXT_LOCALE and the theme once from the stored preference", () => {
    const { rerender } = render(<PreferenceSync locale="en" theme="dark" />);
    expect(document.cookie).toContain("NEXT_LOCALE=en");
    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    rerender(<PreferenceSync locale="en" theme="dark" />);
    render(<PreferenceSync locale="en" theme="dark" />);
    expect(mocks.setTheme).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the cookie already holds the stored locale", () => {
    document.cookie = "NEXT_LOCALE=es; path=/";
    render(<PreferenceSync locale="es" theme="light" />);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.setTheme).toHaveBeenCalledWith("light");
  });

  it("replaces a stale cookie with the stored locale", () => {
    document.cookie = "NEXT_LOCALE=es; path=/";
    render(<PreferenceSync locale="en" theme="system" />);
    expect(document.cookie).toContain("NEXT_LOCALE=en");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});

import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { TechStackIcons, resolveTechnologyIcon } from "./tech-stack-icons";

describe("resolveTechnologyIcon (server only)", () => {
  it("resolves a Simple Icons slug to its path and brand colour", () => {
    const icon = resolveTechnologyIcon("nextdotjs");
    expect(icon).not.toBeNull();
    expect(icon!.title).toBe("Next.js");
    expect(icon!.path.length).toBeGreaterThan(0);
    expect(icon!.hex).toMatch(/^[0-9A-Fa-f]{6}$/);
  });

  it("returns null for an unknown slug and for no slug", () => {
    expect(resolveTechnologyIcon("no-such-brand-xyz")).toBeNull();
    expect(resolveTechnologyIcon(null)).toBeNull();
  });
});

describe("TechStackIcons", () => {
  const technologies = [
    { id: "tec_next_js", name: "Next.js", nameEn: null, slug: "next-js", category: "FRONTEND" as const, iconSlug: "nextdotjs", color: null },
    { id: "tec_rust", name: "Rust", nameEn: "Rust (lang)", slug: "rust", category: "LENGUAJE" as const, iconSlug: null, color: "#dea584" },
  ];

  it("renders each technology's icon named by its English label in English", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{}}>
        <TechStackIcons technologies={technologies} locale="en" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("img", { name: "Next.js" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Rust (lang)" })).toBeInTheDocument();
  });

  it("renders nothing for an empty stack", () => {
    const { container } = render(
      <NextIntlClientProvider locale="es" messages={{}}>
        <TechStackIcons technologies={[]} locale="es" />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

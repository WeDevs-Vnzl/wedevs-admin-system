import { render } from "@testing-library/react";
import type { Element, Root } from "hast";
import rehypeSanitize from "rehype-sanitize";
import { describe, expect, it } from "vitest";
import { MarkdownView, markdownSanitizeSchema } from "./markdown-view";

function renderMarkdown(content: string) {
  const { container } = render(<MarkdownView content={content} />);
  return container;
}

describe("MarkdownView", () => {
  it("renders GFM tables", () => {
    const container = renderMarkdown("| Item | Qty |\n| --- | --- |\n| Hosting | 2 |\n");
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.querySelectorAll("th")).toHaveLength(2);
    expect(table?.querySelector("td")?.textContent).toBe("Hosting");
  });

  it("renders GFM task lists as disabled checkboxes", () => {
    const container = renderMarkdown("- [x] Signed\n- [ ] Sent\n");
    const boxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[1]?.checked).toBe(false);
    expect(boxes[0]?.disabled).toBe(true);
  });

  it("highlights fenced code blocks", () => {
    const container = renderMarkdown("```ts\nconst total: number = 1;\n```\n");
    const code = container.querySelector("pre > code");
    expect(code?.className).toContain("hljs");
    expect(code?.className).toContain("language-ts");
    expect(code?.querySelector('span[class^="hljs-"]')).not.toBeNull();
    expect(code?.textContent).toBe("const total: number = 1;\n");
  });

  it("never renders scripts, iframes, event handlers or javascript: URLs", () => {
    const container = renderMarkdown(
      [
        "<script>alert(1)</script>",
        "",
        '<iframe src="https://evil.example"></iframe>',
        "",
        '<img src="x" onerror="alert(1)">',
        "",
        "[click](javascript:alert(1))",
        "",
        '<a href="javascript:alert(2)">raw</a>',
      ].join("\n"),
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    const all = [...container.querySelectorAll("*")];
    for (const el of all) {
      for (const attr of [...el.attributes]) {
        expect(attr.name.startsWith("on")).toBe(false);
        expect(attr.value.toLowerCase()).not.toContain("javascript:");
      }
    }
    expect(container.innerHTML.toLowerCase()).not.toContain("<script");
  });

  it("opens external links in a new tab with a safe rel", () => {
    const container = renderMarkdown("[WeDevs](https://wedevs.example) and [anchor](#terms)");
    const external = container.querySelector('a[href="https://wedevs.example"]');
    expect(external?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(external?.getAttribute("target")).toBe("_blank");
    const internal = container.querySelector('a[href="#terms"]');
    expect(internal?.getAttribute("target")).toBeNull();
  });

  it("keeps only highlight classes when the sanitizer sees hostile markup", () => {
    const el = (tagName: string, properties: Record<string, unknown>, children: Element[] = []) =>
      ({ type: "element", tagName, properties, children }) as Element;
    const tree: Root = {
      type: "root",
      children: [
        el("script", {}, []),
        el("iframe", { src: "https://evil.example" }),
        el("pre", {}, [
          el("code", { className: ["hljs", "language-ts", "evil"], onClick: "alert(1)" }, [
            el("span", { className: ["hljs-keyword", "pwn"], style: "color:red" }),
          ]),
        ]),
        el("a", { href: "javascript:alert(1)" }),
      ],
    };
    const clean = rehypeSanitize(markdownSanitizeSchema)(tree);
    const json = JSON.stringify(clean);
    expect(json).not.toContain("script");
    expect(json).not.toContain("iframe");
    expect(json).not.toContain("onClick");
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain("evil");
    expect(json).not.toContain("pwn");
    expect(json).not.toContain("color:red");
    expect(json).toContain('["hljs","language-ts"]');
    expect(json).toContain('["hljs-keyword"]');
  });

  it("marks its root with a data slot for scoped styles", () => {
    const container = renderMarkdown("Hello");
    expect(container.querySelector('[data-slot="markdown-view"]')).not.toBeNull();
  });
});

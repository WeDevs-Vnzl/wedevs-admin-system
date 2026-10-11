import { act, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enForms from "@/i18n/messages/en/forms.json";
import esForms from "@/i18n/messages/es/forms.json";
import type { UploadAdapter } from "@/lib/validators/files";
import { richTextDocSchema, type RichTextDoc } from "@/lib/validators/notes";
import { EMPTY_RICH_TEXT, parseRichText, RichTextEditor } from "./rich-text-editor";
import { RichTextView } from "./rich-text-view";
import {
  RichTextImage,
  createRichTextExtensions,
  isAllowedRichTextUri,
  normalizeRichTextJson,
} from "./extensions";
import { Editor } from "@tiptap/react";

beforeAll(() => {
  // jsdom lacks the layout APIs ProseMirror calls when it scrolls the selection into view.
  const empty = { getClientRects: () => [], getBoundingClientRect: () => new DOMRect() };
  const createRange = document.createRange.bind(document);
  document.createRange = () => Object.assign(createRange(), empty);
  Element.prototype.getClientRects = () => [] as unknown as DOMRectList;

  // `EditorView.pasteHTML` builds a ClipboardEvent over a DataTransfer; jsdom has neither.
  class FakeDataTransfer {
    private data = new Map<string, string>();
    files: File[] = [];
    setData(type: string, value: string) {
      this.data.set(type, value);
    }
    getData(type: string) {
      return this.data.get(type) ?? "";
    }
  }
  class FakeClipboardEvent extends Event {
    clipboardData: FakeDataTransfer | null;
    constructor(type: string, init: { clipboardData?: FakeDataTransfer } = {}) {
      super(type, { bubbles: true, cancelable: true });
      this.clipboardData = init.clipboardData ?? null;
    }
  }
  Object.assign(globalThis, { DataTransfer: FakeDataTransfer, ClipboardEvent: FakeClipboardEvent });
});

function wrap(ui: React.ReactNode, locale: "es" | "en" = "es") {
  return render(
    <NextIntlClientProvider locale={locale} messages={{ forms: locale === "es" ? esForms : enForms }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const HOSTILE_HTML = [
  "<p>seguro</p>",
  "<script>window.__pwned = 1</script>",
  '<iframe src="https://evil.example"></iframe>',
  '<img src="x" onerror="window.__pwned = 2">',
  '<p><a href="javascript:alert(1)" onclick="window.__pwned = 3">enlace malo</a></p>',
  '<img src="data:image/png;base64,AAAA">',
  '<p><a href="https://ok.example" target="_self" rel="opener">enlace bueno</a></p>',
].join("");

async function readyEditor() {
  // The editor is created in an effect (immediatelyRender: false).
  await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
}

function standaloneEditor(content?: unknown) {
  return new Editor({
    extensions: createRichTextExtensions(),
    ...(content ? { content: content as never } : {}),
  });
}

describe("allowlist (C4)", () => {
  it("accepts only http, https and mailto links", () => {
    expect(isAllowedRichTextUri("https://a.example/x")).toBe(true);
    expect(isAllowedRichTextUri("http://a.example")).toBe(true);
    expect(isAllowedRichTextUri("mailto:ana@example.com")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://a.example", "/rel", " java\tscript:x", "", undefined]) {
      expect(isAllowedRichTextUri(bad)).toBe(false);
    }
  });

  it("pasted hostile HTML is normalized by the schema: nothing dangerous reaches the editor document", () => {
    const editor = standaloneEditor();
    editor.view.pasteHTML(HOSTILE_HTML);
    const html = editor.getHTML();
    expect(html).toContain("seguro");
    expect(html).not.toMatch(/<script|<iframe|<img|onerror|onclick|javascript:|data:image|evil\.example/i);
    // The safe link keeps its href and gets the project attributes, not the pasted ones.
    expect(html).toContain('href="https://ok.example"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("opener\"");
    expect(parseRichText(editor.getJSON())).not.toBeNull();
    editor.destroy();
  });

  it("the schema rejects raw JSON with a javascript: link, an image src from outside and extra attrs", () => {
    const link = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
      ],
    };
    const dataImage = { type: "doc", content: [{ type: "image", attrs: { fileId: "fil_1", src: "data:image/png;base64,AAAA" } }] };
    const handler = { type: "doc", content: [{ type: "image", attrs: { fileId: "fil_1", onerror: "x()" } }] };
    const iframe = { type: "doc", content: [{ type: "iframe", attrs: { src: "https://evil.example" } }] };
    for (const raw of [link, dataImage, handler, iframe]) {
      expect(richTextDocSchema.safeParse(raw).success).toBe(false);
    }
  });

  it("editor JSON round-trips into richTextDocSchema: null attributes are stripped from images", () => {
    const editor = standaloneEditor({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hola", marks: [{ type: "bold" }] }] },
        { type: "image", attrs: { fileId: "fil_0001", alt: null } },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "T" }] },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] },
      ],
    });
    const raw = editor.getJSON();
    const image = raw.content?.find((node) => node.type === "image");
    expect(image?.attrs).toMatchObject({ fileId: "fil_0001", alt: null, src: null });
    expect(richTextDocSchema.safeParse(raw).success).toBe(false);
    const normalized = normalizeRichTextJson(raw);
    const parsed = richTextDocSchema.safeParse(normalized);
    expect(parsed.success).toBe(true);
    expect(normalized.content?.find((node) => node.type === "image")?.attrs).toEqual({ fileId: "fil_0001" });
    editor.destroy();
  });

  it("a markdown image input rule never creates an image with an arbitrary src", () => {
    const editor = standaloneEditor();
    expect(RichTextImage.config.addInputRules?.call({} as never)).toEqual([]);
    editor.commands.insertContent("![x](https://evil.example/a.png) ");
    expect(editor.getHTML()).not.toMatch(/<img/);
    expect(editor.getJSON().content?.some((node) => node.type === "image")).toBe(false);
    editor.destroy();
  });
});

describe("RichTextEditor", () => {
  it("renders the toolbar with translated labels in ES and EN", async () => {
    const { unmount } = wrap(<RichTextEditor />);
    expect(await screen.findByRole("button", { name: "Negrita" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("toolbar", { name: "Formato de texto" })).toBeInTheDocument();
    unmount();
    wrap(<RichTextEditor />, "en");
    expect(await screen.findByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Text formatting" })).toBeInTheDocument();
  });

  it("emits normalized, schema-valid JSON on change and strips pasted script, iframe, handlers and unsafe URLs", async () => {
    const onChange = vi.fn<(doc: RichTextDoc) => void>();
    wrap(<RichTextEditor onChange={onChange} />);
    await readyEditor();
    const dom = document.querySelector(".ProseMirror") as HTMLElement & { editor?: Editor };
    // `pasteHTML` is a view method: reach the view through the Tiptap editor stored on the DOM node.
    const editor = (dom as unknown as { editor: Editor }).editor;
    await act(async () => {
      editor.view.pasteHTML(HOSTILE_HTML);
    });
    expect(dom.querySelector("script, iframe, img")).toBeNull();
    expect(dom.innerHTML).not.toMatch(/onerror|onclick|javascript:|data:image/i);
    expect(onChange).toHaveBeenCalled();
    const doc = onChange.mock.calls.at(-1)![0];
    expect(richTextDocSchema.safeParse(doc).success).toBe(true);
    expect(JSON.stringify(doc)).not.toMatch(/javascript:|data:|iframe|script/i);
  });

  it("uploads a pasted image through the adapter and inserts an image node with its fileId", async () => {
    const adapter: UploadAdapter = {
      requestUpload: vi.fn(async () => ({ ok: true as const, data: { fileId: "fil_0042", url: null } })),
      put: vi.fn(async () => {}),
      confirmUpload: vi.fn(async () => ({
        ok: true as const,
        data: {
          id: "fil_0042",
          originalName: "captura.png",
          mimeType: "image/png",
          sizeBytes: 10,
          status: "READY" as const,
          uploadedById: "usr_x",
          createdAt: "2026-10-09T00:00:00.000Z",
        },
      })),
    };
    const onChange = vi.fn<(doc: RichTextDoc) => void>();
    wrap(<RichTextEditor uploadAdapter={adapter} onChange={onChange} />);
    await readyEditor();
    const dom = document.querySelector(".ProseMirror") as HTMLElement;
    const file = new File([new Uint8Array(10)], "captura.png", { type: "image/png" });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [file], getData: () => "" } });
    await act(async () => {
      dom.dispatchEvent(event);
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(adapter.requestUpload).toHaveBeenCalledWith(expect.objectContaining({ name: "captura.png", context: "general" }));
    const doc = onChange.mock.calls.at(-1)![0];
    expect(doc.content?.find((node) => node.type === "image")?.attrs).toEqual({ fileId: "fil_0042", alt: "captura.png" });
    expect(dom.querySelector("img")).toBeNull();
    expect(dom.textContent).toContain("captura.png");
  });
});

describe("RichTextView", () => {
  const doc: RichTextDoc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Hola ", marks: [] }, { type: "text", text: "sitio", marks: [{ type: "link", attrs: { href: "https://ok.example" } }] }] },
      { type: "image", attrs: { fileId: "fil_0001", alt: "plano.png" } },
    ],
  };

  it("renders links with rel and target, images as a placeholder, and no img element", async () => {
    wrap(<RichTextView content={doc} />);
    const link = await screen.findByRole("link", { name: "sitio" });
    expect(link).toHaveAttribute("href", "https://ok.example");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Imagen adjunta: plano.png")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("does not render a document that fails the allowlist schema (script, iframe, handlers, unsafe URLs)", () => {
    const hostile = {
      type: "doc",
      content: [
        { type: "iframe", attrs: { src: "https://evil.example" } },
        { type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] },
        { type: "image", attrs: { fileId: "fil_1", src: "data:image/png;base64,AAAA", onerror: "x()" } },
      ],
    } as unknown as RichTextDoc;
    wrap(<RichTextView content={hostile} />);
    expect(screen.getByRole("alert")).toHaveTextContent("El contenido no se puede mostrar.");
    expect(document.querySelector("a, iframe, img, script")).toBeNull();
  });

  it("renders in EN", async () => {
    wrap(<RichTextView content={doc} />, "en");
    expect(await screen.findByText("Attached image: plano.png")).toBeInTheDocument();
  });

  it("exports an empty paragraph as the empty document", () => {
    expect(richTextDocSchema.safeParse(EMPTY_RICH_TEXT).success).toBe(true);
  });
});

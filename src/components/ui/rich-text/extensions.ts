import { mergeAttributes, type Extensions } from "@tiptap/react";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TaskItem } from "@tiptap/extension-task-item";
import { TaskList } from "@tiptap/extension-task-list";
import StarterKit from "@tiptap/starter-kit";
import { isHttpUrl } from "@/lib/validators/tags";

/**
 * The extension allowlist of the rich-text kit (C4). It produces exactly `RICH_TEXT_NODE_TYPES` and
 * `RICH_TEXT_MARK_TYPES` of `lib/validators/notes`, nothing else: no underline, no iframe, no raw HTML.
 * The editor and the viewer share it, so pasted HTML is normalized by the same schema on both sides.
 */

/** Link protocols the editor accepts (the validator accepts the same ones). */
export const RICH_TEXT_LINK_PROTOCOLS = ["http", "https", "mailto"] as const;

/** `true` for an `http(s):` URL or a well-formed `mailto:`: the validator's link rule (notes.ts). */
export function isAllowedRichTextUri(uri: string | null | undefined): boolean {
  if (typeof uri !== "string") return false;
  return isHttpUrl(uri) || /^mailto:[^\s@]+@[^\s@]+$/i.test(uri);
}

/** `rel` and `target` of every rendered link (C4); the stored mark keeps only the `href`. */
export const RICH_TEXT_LINK_ATTRIBUTES = {
  rel: "noopener noreferrer nofollow",
  target: "_blank",
} as const;

const RichTextLink = Link.extend({
  // Only `href` is stored: `rel`, `target` and `class` come from the options on every render, so a pasted
  // `<a target="_self" rel="opener">` cannot override them.
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("href"),
      },
    };
  },
});

export interface RichTextImageOptions {
  /** Label of the placeholder that stands for an image (Hito 1 has no URL to show). */
  label: (attrs: { fileId: string; alt: string | null }) => string;
}

/**
 * Image node (C4): an uploaded file referenced by `fileId`. It declares only `fileId`, `alt` and `src`
 * (the strict contract of the validator) and never reads `src` from pasted HTML. No `<img>` ever reaches
 * the DOM: the node view is a placeholder with the file name (Hito 1 has no download URL).
 */
export const RichTextImage = Image.extend<RichTextImageOptions>({
  inline: false,

  addOptions() {
    return { ...this.parent?.(), label: ({ alt, fileId }) => alt ?? fileId };
  },

  // No `![alt](url)` input rule: it would create an image node with an arbitrary `src`.
  addInputRules() {
    return [];
  },

  addAttributes() {
    return {
      fileId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-file-id"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.fileId ? { "data-file-id": String(attrs.fileId) } : {},
      },
      alt: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-alt"),
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.alt ? { "data-alt": String(attrs.alt) } : {},
      },
      // Never parsed from HTML and never rendered: kept only so the declared attributes match the contract.
      src: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-rich-image][data-file-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-rich-image": "" }, HTMLAttributes)];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.setAttribute("data-rich-image", "");
      dom.setAttribute("data-file-id", String(node.attrs.fileId ?? ""));
      dom.className =
        "my-2 inline-flex items-center gap-2 rounded-md border bg-muted px-3 py-1.5 text-sm text-muted-foreground";
      dom.contentEditable = "false";
      const fileId = String(node.attrs.fileId ?? "");
      const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : null;
      dom.textContent = this.options.label({ fileId, alt });
      return { dom };
    };
  },
});

export interface RichTextExtensionOptions {
  /** Placeholder shown by an empty editor (already translated). */
  placeholder?: string;
  /** Translated label of an image placeholder. */
  imageLabel?: RichTextImageOptions["label"];
}

/** The allowlisted extensions, in the order Tiptap registers them. */
export function createRichTextExtensions(options: RichTextExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      underline: false,
      link: false,
      trailingNode: false,
      heading: { levels: [1, 2, 3] },
    }),
    RichTextLink.configure({
      openOnClick: false,
      autolink: true,
      protocols: [],
      defaultProtocol: "https",
      isAllowedUri: (url) => isAllowedRichTextUri(url),
      HTMLAttributes: { ...RICH_TEXT_LINK_ATTRIBUTES },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    RichTextImage.configure(options.imageLabel ? { label: options.imageLabel } : {}),
    ...(options.placeholder ? [Placeholder.configure({ placeholder: options.placeholder })] : []),
  ];
}

/**
 * Prepares `editor.getJSON()` for `richTextDocSchema`: Tiptap emits `null` for unset attributes, and the image
 * rule is a strict object (`fileId`, `alt?`, `src?`). Null and undefined attributes are dropped on every node
 * and mark; an image keeps only its three declared attributes (r1).
 */
export function normalizeRichTextJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => normalizeRichTextJson(item)) as T;
  if (value === null || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (key === "attrs" && item && typeof item === "object" && !Array.isArray(item)) {
      const kept = Object.fromEntries(
        Object.entries(item as Record<string, unknown>).filter(
          ([, attr]) => attr !== null && attr !== undefined,
        ),
      );
      const isImage = source.type === "image";
      const attrs = isImage
        ? Object.fromEntries(
            Object.entries(kept).filter(([name]) => ["fileId", "alt", "src"].includes(name)),
          )
        : kept;
      if (Object.keys(attrs).length > 0) out.attrs = attrs;
      continue;
    }
    out[key] = normalizeRichTextJson(item);
  }
  return out as T;
}

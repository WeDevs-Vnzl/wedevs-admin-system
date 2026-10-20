import type { ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { markdownProseClassName } from "./prose";
import "./markdown-view.css";

/**
 * GitHub-style allowlist (`defaultSchema`) plus only the classes syntax highlighting needs: `hljs` and
 * `language-*` on `code`, `hljs-*` tokens on `span`. Nothing else is widened, so raw `<script>`, `<iframe>`,
 * `on*` handlers and `javascript:` URLs are still dropped (HU-18 CA4, PRD §14).
 */
export const markdownSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", "hljs", /^language-./]],
    span: [["className", /^hljs-[\w-]+$/]],
  },
};

/**
 * Order: sanitize runs first over the markdown-derived tree, then highlight only tokenizes the text of the
 * already-clean `<pre><code>` blocks into `span.hljs-*`. Highlight never parses HTML, so it cannot reintroduce
 * anything the sanitizer removed; the schema above still lets its classes through if the order ever flips.
 * Raw HTML is never enabled (no `rehype-raw`): react-markdown drops it before either plugin sees it.
 */
const rehypePlugins: ComponentProps<typeof Markdown>["rehypePlugins"] = [
  [rehypeSanitize, markdownSanitizeSchema],
  [rehypeHighlight, { detect: false }],
];

const EXTERNAL_HREF = /^(https?:)?\/\//i;

const components: Components = {
  a: ({ node, href, children, ...props }) => {
    void node; // react-markdown's hast node: kept out of the DOM attributes.
    const external = typeof href === "string" && EXTERNAL_HREF.test(href);
    return (
      <a
        {...props}
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {children}
      </a>
    );
  },
};

export interface MarkdownViewProps {
  /** Markdown source (GFM). It is always sanitized before it reaches the DOM. */
  content: string;
  className?: string;
}

/**
 * Read-only renderer of a markdown document (PRD §8.9.3): GFM tables, task lists and highlighted fenced code.
 * Server-renderable (no client hooks), so pages can render it on the server; the portal and the document
 * detail share it. Wrap it in `PrintRegion` (`components/patterns/print-view`) for the print view.
 */
export function MarkdownView({ content, className }: MarkdownViewProps) {
  return (
    <div data-slot="markdown-view" className={cn(markdownProseClassName, className)}>
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </Markdown>
    </div>
  );
}

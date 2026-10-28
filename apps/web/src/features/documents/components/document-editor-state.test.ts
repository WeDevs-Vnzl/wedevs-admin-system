import { describe, expect, it } from "vitest";
import type { DocumentDetailDTO } from "@/lib/validators/documents";
import { editorAvailability, initialEditorContent } from "./document-editor-state";

type Shape = {
  status: DocumentDetailDTO["status"];
  defaultFormat: DocumentDetailDTO["type"]["defaultFormat"];
  currentFormat: DocumentDetailDTO["type"]["defaultFormat"] | null;
  content?: string | null;
  draftContent?: string | null;
};

function documentOf({
  status,
  defaultFormat,
  currentFormat,
  content = null,
  draftContent = null,
}: Shape) {
  return {
    status,
    draftContent,
    type: { defaultFormat },
    currentVersion: currentFormat ? { format: currentFormat, content } : null,
  } as unknown as DocumentDetailDTO;
}

describe("editorAvailability", () => {
  it("edits a markdown document, or one with no version yet whose type defaults to markdown", () => {
    expect(
      editorAvailability(
        documentOf({ status: "BORRADOR", defaultFormat: "ARCHIVO", currentFormat: "MARKDOWN" }),
      ),
    ).toBe("editable");
    expect(
      editorAvailability(
        documentOf({ status: "BORRADOR", defaultFormat: "MARKDOWN", currentFormat: null }),
      ),
    ).toBe("editable");
  });

  it("refuses file and link documents, and a version-less one whose type is not markdown", () => {
    for (const currentFormat of ["ARCHIVO", "ENLACE"] as const) {
      expect(
        editorAvailability(
          documentOf({ status: "BORRADOR", defaultFormat: "MARKDOWN", currentFormat }),
        ),
      ).toBe("notMarkdown");
    }
    expect(
      editorAvailability(
        documentOf({ status: "BORRADOR", defaultFormat: "ENLACE", currentFormat: null }),
      ),
    ).toBe("notMarkdown");
  });

  it("locks a signed markdown document", () => {
    expect(
      editorAvailability(
        documentOf({ status: "FIRMADO", defaultFormat: "MARKDOWN", currentFormat: "MARKDOWN" }),
      ),
    ).toBe("signed");
  });
});

describe("initialEditorContent", () => {
  it("prefers the draft, then the current version, then an empty text", () => {
    const base = {
      status: "BORRADOR",
      defaultFormat: "MARKDOWN",
      currentFormat: "MARKDOWN",
    } as const;
    expect(initialEditorContent(documentOf({ ...base, content: "# v", draftContent: "# d" }))).toBe(
      "# d",
    );
    expect(initialEditorContent(documentOf({ ...base, content: "# v" }))).toBe("# v");
    expect(initialEditorContent(documentOf({ ...base, currentFormat: null }))).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { richTextDocSchema } from "@/lib/validators/notes";
import { resolveEntityRef, richTextToPlainText as mockPlain } from "@/mocks/entity-refs";
import { makeTestContext } from "@/mocks/test-helpers";
import { firstWords, noteDisplayTitle, richTextExcerpt, richTextToPlainText } from "./rich-text";

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Alcance" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "uno dos tres " },
        { type: "text", text: "cuatro", marks: [{ type: "bold" }] },
        { type: "text", text: " cinco seis siete ocho" },
      ],
    },
  ],
};

describe("richTextToPlainText", () => {
  it("joins text nodes of a block and blocks with one space", () => {
    expect(richTextToPlainText(doc)).toBe("Alcance uno dos tres  cuatro  cinco seis siete ocho");
  });

  it("matches the mock copy", () => {
    expect(richTextToPlainText(doc)).toBe(mockPlain(doc));
  });

  it("is empty for an empty document", () => {
    expect(richTextToPlainText({ content: [] })).toBe("");
  });
});

describe("richTextExcerpt", () => {
  it("returns the whole text when it fits", () => {
    expect(richTextExcerpt({ content: [{ type: "text", text: "hola  mundo" }] }, 50)).toBe(
      "hola mundo",
    );
  });

  it("cuts at a word boundary and adds an ellipsis", () => {
    expect(richTextExcerpt(doc, 20)).toBe("Alcance uno dos…");
  });

  it("cuts mid-word when there is no usable boundary", () => {
    expect(richTextExcerpt({ content: [{ type: "text", text: "abcdefghijklmnop" }] }, 5)).toBe(
      "abcde…",
    );
  });
});

describe("noteDisplayTitle", () => {
  it("prefers the title", () => {
    expect(noteDisplayTitle("  Mi nota ", doc)).toBe("Mi nota");
  });

  it("falls back to the first six words", () => {
    expect(noteDisplayTitle(null, doc)).toBe("Alcance uno dos tres cuatro cinco");
    expect(noteDisplayTitle("   ", doc)).toBe("Alcance uno dos tres cuatro cinco");
    expect(firstWords("a b c", 2)).toBe("a b");
  });

  it("agrees with the EntityRef label of an untitled note", () => {
    const { db } = makeTestContext();
    const note = db.notes[0]!;
    note.title = null;
    expect(resolveEntityRef(db, "NOTE", note.id)?.label).toBe(noteDisplayTitle(null, note.content));
  });
});

describe("editor JSON → richTextDocSchema", () => {
  it("accepts a fixture-shaped document", () => {
    expect(richTextDocSchema.safeParse(doc).success).toBe(true);
  });
});

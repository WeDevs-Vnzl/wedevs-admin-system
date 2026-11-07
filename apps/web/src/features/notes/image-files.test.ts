import { describe, expect, it } from "vitest";
import type { RichTextDoc } from "@/lib/validators/notes";
import { collectImageFileIds, mergeAttachmentIds } from "./image-files";

const doc: RichTextDoc = {
  type: "doc",
  content: [
    { type: "image", attrs: { fileId: "fil_1" } },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "image", attrs: { fileId: "fil_2", alt: "x" } }],
        },
      ],
    },
    { type: "image", attrs: { fileId: "fil_1" } },
    { type: "paragraph", content: [{ type: "text", text: "sin imagen" }] },
  ],
};

describe("collectImageFileIds", () => {
  it("lists the fileId of every image node, nested ones included, once", () => {
    expect(collectImageFileIds(doc)).toEqual(["fil_1", "fil_2"]);
  });

  it("returns nothing for a document without images", () => {
    expect(collectImageFileIds({ type: "doc", content: [{ type: "paragraph" }] })).toEqual([]);
  });
});

describe("mergeAttachmentIds", () => {
  it("joins the uploader files and the pasted images without repeats and skips attached ones", () => {
    expect(mergeAttachmentIds(["fil_u", "fil_1"], doc, ["fil_2"])).toEqual(["fil_u", "fil_1"]);
    expect(mergeAttachmentIds([], doc)).toEqual(["fil_1", "fil_2"]);
  });
});

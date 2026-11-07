import type { RichTextDoc, RichTextNode } from "@/lib/validators/notes";

/** The `fileId` of every `image` node of a document, in order, without repeats. */
export function collectImageFileIds(doc: RichTextDoc): string[] {
  const found = new Set<string>();
  const visit = (node: RichTextNode) => {
    if (node.type === "image" && typeof node.attrs?.fileId === "string") {
      found.add(node.attrs.fileId);
    }
    node.content?.forEach(visit);
  };
  doc.content?.forEach(visit);
  return [...found];
}

/**
 * The files to attach to a note: the uploader's files plus every image of the content, minus the ones the note
 * already holds. Every image `fileId` must be an attachment of the same note (the BE refuses the save otherwise).
 */
export function mergeAttachmentIds(
  uploaded: readonly string[],
  doc: RichTextDoc,
  alreadyAttached: readonly string[] = [],
): string[] {
  const held = new Set(alreadyAttached);
  return [...new Set([...uploaded, ...collectImageFileIds(doc)])].filter((id) => !held.has(id));
}

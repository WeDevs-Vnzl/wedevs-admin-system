import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enNotes from "@/i18n/messages/en/notes.json";
import type { FileDTO } from "@/lib/validators/files";
import { NoteAttachments } from "./note-attachments";

const file: FileDTO = {
  id: "fil_brief",
  originalName: "brief.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2048,
  status: "READY",
  uploadedById: "usr_1",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("NoteAttachments", () => {
  it("downloads each chip through the FE download route (fileDownloadPath)", () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ notes: enNotes }}>
        <NoteAttachments files={[file]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: /brief\.pdf/ })).toHaveAttribute(
      "href",
      "/files/fil_brief/download",
    );
  });

  it("renders nothing without files", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ notes: enNotes }}>
        <NoteAttachments files={[]} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

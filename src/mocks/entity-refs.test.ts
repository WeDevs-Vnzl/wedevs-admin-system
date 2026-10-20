// MOCK — tests for the entity references.
import { describe, expect, it } from "vitest";
import { ENTITY_TYPE_VALUES } from "@/lib/validators/enums";
import { entityRefSchema } from "@/lib/validators/common";
import { firstWords, resolveEntityRef, richTextToPlainText } from "./entity-refs";
import { makeTestContext } from "./test-helpers";

describe("resolveEntityRef", () => {
  const { db } = makeTestContext();

  it("resolves a client by trade name with its code", () => {
    expect(resolveEntityRef(db, "CLIENT", "cli_kairos")).toEqual({
      id: "cli_kairos",
      code: "CLI-0001",
      label: "Kairos Studio",
      type: "CLIENT",
    });
  });

  it("resolves projects, documents, contacts, files, tags and users", () => {
    expect(resolveEntityRef(db, "PROJECT", "pry_kairos_web")).toMatchObject({
      label: "Sitio web Kairos Studio",
      code: "PRY-0001",
    });
    expect(resolveEntityRef(db, "DOCUMENT", "doc_contrato_kairos")).toMatchObject({
      type: "DOCUMENT",
      code: "DOC-0001",
    });
    const contact = db.contacts[0]!;
    expect(resolveEntityRef(db, "CONTACT", contact.id)).toEqual({
      id: contact.id,
      label: contact.fullName,
      type: "CONTACT",
    });
    expect(resolveEntityRef(db, "FILE", db.files[0]!.id)?.label).toBe(db.files[0]!.originalName);
    expect(resolveEntityRef(db, "TAG", "tag_urgente")?.label).toBe("Urgente");
    expect(resolveEntityRef(db, "USER", "usr_andres_molina")?.label).toBe("Andrés Molina");
  });

  it("labels a note by its title, or by its first words when it has none", () => {
    const titled = db.notes.find((n) => n.title)!;
    expect(resolveEntityRef(db, "NOTE", titled.id)?.label).toBe(titled.title);
    const untitled = db.notes.find((n) => !n.title)!;
    const label = resolveEntityRef(db, "NOTE", untitled.id)!.label;
    expect(label.length).toBeGreaterThan(0);
    expect(richTextToPlainText(untitled.content).startsWith(label)).toBe(true);
    expect(label.split(" ").length).toBeLessThanOrEqual(6);
  });

  it("still resolves archived rows (history keeps pointing at them)", () => {
    const archived = db.clients.find((c) => c.archivedAt)!;
    expect(resolveEntityRef(db, "CLIENT", archived.id)?.label).toBe(archived.tradeName);
  });

  it("answers null for unknown ids and for types without a collection", () => {
    expect(resolveEntityRef(db, "CLIENT", "cli_nope")).toBeNull();
    expect(resolveEntityRef(db, "SETTING", "anything")).toBeNull();
    expect(resolveEntityRef(db, "INVOICE", "inv_0001")).toBeNull();
  });

  it("answers for every EntityType without throwing, and its refs satisfy the contract", () => {
    for (const type of ENTITY_TYPE_VALUES) {
      const found = resolveEntityRef(db, type, "nonexistent_id");
      expect(found).toBeNull();
    }
    const samples = [
      resolveEntityRef(db, "CLIENT", db.clients[0]!.id),
      resolveEntityRef(db, "NOTE", db.notes[0]!.id),
    ];
    for (const sample of samples) expect(entityRefSchema.safeParse(sample).success).toBe(true);
  });

  it("answers from the finance collections once they are filled", () => {
    const { db: store } = makeTestContext();
    store.recurringCharges.push({ id: "rch_1", label: "Mantenimiento mensual" } as never);
    store.installments.push({ id: "ins_1", label: "Anticipo 40 %" } as never);
    expect(resolveEntityRef(store, "RECURRING_CHARGE", "rch_1")?.label).toBe(
      "Mantenimiento mensual",
    );
    expect(resolveEntityRef(store, "INSTALLMENT", "ins_1")?.label).toBe("Anticipo 40 %");
  });
});

describe("text helpers", () => {
  it("projects a Tiptap tree to plain text", () => {
    expect(
      richTextToPlainText({
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hola" }] },
          { type: "paragraph", content: [{ type: "text", text: "mundo" }] },
        ],
      }),
    ).toBe("Hola mundo");
  });

  it("takes the first words", () => {
    expect(firstWords("uno dos tres cuatro", 2)).toBe("uno dos");
    expect(firstWords("  solo  ")).toBe("solo");
  });
});

// MOCK — contacts fixtures of Hito 1 (data-rules.md §2, PRD §8.2 "Contacto"). Fictional people (C5):
// invented names, `.example.com` addresses, `555` phone numbers. Store rows are the `ContactDetailDTO`
// contract minus the embedded `tags`, plus `tagIds` (PD-3); the schema has no `deletedById` on contacts.
//
// Coverage the specs rely on: clients with 0, 1, 2 and 3 contacts; at most one primary per client (a
// client with three contacts and no primary exists); every contact has an email, a phone, or both; the
// contacts of the archived client are archived with it (C19) and `Solaris Energía` has one archived
// contact. `cli_zafiro_labs` has none.
import { mockId } from "../ids";
import type { ContactDetailDTO } from "@/lib/validators/contacts";
import { createClientFixtures } from "./clients";

/** Contact row: the contract minus the embedded tags, plus the tag ids (PD-3). */
export type ContactRow = Omit<ContactDetailDTO, "tags"> & { tagIds: string[] };

const FIRST_NAMES = [
  "Mariana",
  "Gustavo",
  "Daniela",
  "Rafael",
  "Valentina",
  "Andrés",
  "Carolina",
  "Sebastián",
  "Isabel",
  "Mateo",
  "Paula",
  "Julián",
  "Natalia",
  "Emilio",
  "Verónica",
  "Tomás",
] as const;

const LAST_NAMES = [
  "Salazar",
  "Montilla",
  "Cedeño",
  "Barrios",
  "Lugo",
  "Arteaga",
  "Villegas",
  "Escalona",
  "Peñaloza",
  "Medina",
  "Rangel",
  "Bustamante",
  "Ochoa",
  "Carrasquel",
  "Duarte",
  "Lozano",
] as const;

const POSITIONS = [
  "Gerente general",
  "Directora de operaciones",
  "Responsable de TI",
  "Administrador",
  "Coordinadora de marketing",
  "Director financiero",
  "Jefe de compras",
  "Fundadora",
] as const;

/** Contacts per client, by position in the dataset: 1, 3, 1, 0, 2, 1, 1, 3, … (0, 1, 2 and 3 all occur). */
const COUNT_CYCLE = [1, 3, 1, 0, 2, 1, 1, 3] as const;

const NO_CONTACTS = new Set(["zafiro_labs"]);

function ascii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Fresh contact rows, derived from the client rows built for the same `now`. */
export function createContactFixtures(now: Date): ContactRow[] {
  const clients = createClientFixtures(now);
  const rows: ContactRow[] = [];
  let person = 0;

  clients.forEach((client, clientIndex) => {
    const key = client.id.slice("cli_".length);
    const count =
      key === "kairos"
        ? 3
        : NO_CONTACTS.has(key)
          ? 0
          : COUNT_CYCLE[clientIndex % COUNT_CYCLE.length]!;
    // A client with three contacts and an odd position has no primary one.
    const hasPrimary = !(count === 3 && clientIndex % 2 === 1);
    const domain = key.replaceAll("_", "-");

    for (let slot = 0; slot < count; slot += 1) {
      const first = FIRST_NAMES[person % FIRST_NAMES.length]!;
      const last = LAST_NAMES[(person * 5 + 3) % LAST_NAMES.length]!;
      const phoneOnly = person % 5 === 4;
      const archivedWithClient = client.archivedAt !== null;
      const archivedAlone = key === "solaris_energia" && slot === 1;
      const createdAt = new Date(
        Date.parse(client.createdAt) + (slot + 1) * 3_600_000,
      ).toISOString();
      const archivedAt = archivedWithClient
        ? client.archivedAt
        : archivedAlone
          ? new Date(Date.parse(now.toISOString()) - 9 * 86_400_000).toISOString()
          : null;
      rows.push({
        id: mockId("con", `${key}_${slot + 1}`),
        clientId: client.id,
        fullName: `${first} ${last}`,
        position: person % 6 === 5 ? null : POSITIONS[person % POSITIONS.length]!,
        email: phoneOnly ? null : `${ascii(first)}.${ascii(last)}@${domain}.example.com`,
        phone:
          phoneOnly || person % 2 === 0
            ? `${client.phone.slice(0, -4)}${String(5000 + person).slice(-4)}`
            : null,
        isPrimary: hasPrimary && slot === 0,
        tagIds: person % 4 === 0 ? [mockId("tag", "prioritario")] : [],
        createdAt,
        updatedAt: createdAt,
        archivedAt,
      });
      person += 1;
    }
  });

  return rows;
}

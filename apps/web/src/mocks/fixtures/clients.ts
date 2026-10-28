// MOCK — clients fixtures of Hito 1 (data-rules.md §2, PRD §8.2). Fictional studio dataset (C5): invented
// names, `.example.com` addresses and `555` phone numbers; the tax ids are made up (VE ones have the RIF
// shape). Store rows are the `ClientDetailDTO` contract minus what services derive (`contacts`,
// `financials`, embedded `tags`) plus foreign keys (`tagIds`, `deletedById`), PD-3.
//
// Ids are `cli_<key>` (readable, stable: other batches reference them). Cases the specs rely on:
//   - `cli_kairos`       ACTIVO, VE, tax id `J-30123456-7`: THE active client for the duplicate E2E
//                        (HU-03 CA3: creating another VE client with that tax id answers CONFLICT).
//                        It owns several active projects (archive confirmation path, HU-03 CA4).
//   - `cli_zafiro_labs`  ACTIVO with no projects and no contacts (archives without confirmation).
//   - `cli_veredas_digital` archived (its contacts went with it, C19).
//   - ≥ 3 PROSPECTO, INACTIVO ones, both kinds, ten countries, VE tax ids with RIF shape.
import { addDays, toDateOnly } from "@/lib/dates";
import type { ClientDetailDTO } from "@/lib/validators/clients";
import type { ClientKind, ClientStatus } from "@/lib/validators/enums";
import { mockId } from "../ids";

/** Client row: the contract minus what services assemble, plus foreign keys (PD-3). */
export type ClientRow = Omit<ClientDetailDTO, "tags" | "contacts" | "financials"> & {
  tagIds: string[];
  deletedById: string | null;
};

/** The user that archived the archived client. */
const ARCHIVER_ID = "usr_camila_torres";

/** `daysAgo` days before `now`, at `hour` UTC, as an ISO timestamp. */
function at(now: Date, daysAgo: number, hour = 14): string {
  const day = addDays(toDateOnly(now, "UTC"), -daysAgo);
  return `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
}

interface CountryProfile {
  suffix: string;
  taxPrefix: string;
  phone: string;
  cities: readonly string[];
}

const COUNTRIES: Record<string, CountryProfile> = {
  VE: {
    suffix: "C.A.",
    taxPrefix: "J",
    phone: "58412",
    cities: ["Caracas", "Valencia", "Maracaibo", "Barquisimeto", "Maracay"],
  },
  CO: {
    suffix: "S.A.S.",
    taxPrefix: "NIT",
    phone: "57300",
    cities: ["Bogotá", "Medellín", "Cartagena"],
  },
  US: { suffix: "LLC", taxPrefix: "EIN", phone: "1415", cities: ["Austin", "Denver", "Portland"] },
  ES: {
    suffix: "S.L.",
    taxPrefix: "CIF",
    phone: "34600",
    cities: ["Valencia", "Sevilla", "Bilbao"],
  },
  MX: {
    suffix: "S.A. de C.V.",
    taxPrefix: "RFC",
    phone: "5255",
    cities: ["Ciudad de México", "Monterrey"],
  },
  AR: { suffix: "S.R.L.", taxPrefix: "CUIT", phone: "5411", cities: ["Buenos Aires", "Córdoba"] },
  CL: { suffix: "SpA", taxPrefix: "RUT", phone: "569", cities: ["Santiago", "Valparaíso"] },
  PA: { suffix: "Corp.", taxPrefix: "RUC", phone: "507", cities: ["Ciudad de Panamá"] },
  EC: { suffix: "S.A.", taxPrefix: "RUC", phone: "5939", cities: ["Quito", "Guayaquil"] },
  PE: { suffix: "S.A.C.", taxPrefix: "RUC", phone: "5199", cities: ["Lima", "Cusco"] },
};

type Seed = readonly [
  key: string,
  tradeName: string,
  country: keyof typeof COUNTRIES,
  kind?: ClientKind,
];

const E: ClientKind = "EMPRESA";
const P: ClientKind = "PERSONA";

const SEEDS: readonly Seed[] = [
  ["kairos", "Kairos Studio", "VE", E],
  ["solaris_energia", "Solaris Energía", "VE", E],
  ["cafeteria_aurora", "Cafetería Aurora", "VE", E],
  ["inversiones_tamanaco", "Inversiones Tamanaco", "VE", E],
  ["clinica_santa_lucia", "Clínica Santa Lucía", "VE", E],
  ["logistica_orinoco", "Logística Orinoco", "VE", E],
  ["ferreteria_el_tornillo", "Ferretería El Tornillo", "VE", E],
  ["panaderia_la_espiga", "Panadería La Espiga", "VE", E],
  ["constructora_roraima", "Constructora Roraima", "VE", E],
  ["maracay_viaja", "Agencia Maracay Viaja", "VE", E],
  ["distribuidora_andes", "Distribuidora Los Andes", "VE", E],
  ["graficas_caribe", "Gráficas Caribe", "VE", E],
  ["perez_asociados", "Estudio Jurídico Pérez & Asociados", "VE", E],
  ["academia_avila", "Academia Ávila", "VE", E],
  ["seguros_guaicaipuro", "Seguros Guaicaipuro", "VE", E],
  ["textiles_barquisimeto", "Textiles Barquisimeto", "VE", E],
  ["hotel_mochima", "Hotel Playa Mochima", "VE", E],
  ["tecnoredes_sur", "Tecnoredes del Sur", "VE", E],
  ["cafe_altagracia", "Café Altagracia", "VE", E],
  ["quesos_tovar", "Quesos Tovar", "VE", E],
  ["radio_costa_azul", "Radio Costa Azul", "VE", E],
  ["optica_vision_clara", "Óptica Visión Clara", "VE", E],
  ["laboratorios_canaima", "Laboratorios Canaima", "VE", E],
  ["gimnasio_titan", "Gimnasio Titán Fit", "VE", E],
  ["escuela_arco_iris", "Escuela Montessori Arco Iris", "VE", E],
  ["joyeria_el_dorado", "Joyería El Dorado", "VE", E],
  ["inmobiliaria_chacao", "Inmobiliaria Chacao", "VE", E],
  ["transporte_llanos", "Transporte Los Llanos", "VE", E],
  ["ron_cumana", "Ron Artesanal Cumaná", "VE", E],
  ["luis_herrera", "Luis Herrera", "VE", P],
  ["maria_quintero", "María Fernanda Quintero", "VE", P],
  ["carlos_aponte", "Carlos Aponte", "VE", P],
  ["gabriela_linares", "Gabriela Linares", "VE", P],
  ["andina_software", "Andina Software", "CO", E],
  ["cafe_sierra_nevada", "Café Sierra Nevada", "CO", E],
  ["moda_cartagena", "Moda Cartagena", "CO", E],
  ["logistica_paisa", "Logística Paisa", "CO", E],
  ["bogota_fintech", "Bogotá Fintech", "CO", E],
  ["ana_ospina", "Ana Lucía Ospina", "CO", P],
  ["harbor_point", "Harbor Point Labs", "US", E],
  ["redwood_ventures", "Redwood Ventures", "US", E],
  ["blue_mesa_foods", "Blue Mesa Foods", "US", E],
  ["cascade_robotics", "Cascade Robotics", "US", E],
  ["jordan_whitfield", "Jordan Whitfield", "US", P],
  ["olivar_digital", "Olivar Digital", "ES", E],
  ["taller_mediterraneo", "Taller Mediterráneo", "ES", E],
  ["atlantica_seguros", "Atlántica Seguros", "ES", E],
  ["sofia_ibanez", "Sofía Ibáñez", "ES", P],
  ["tlaloc_logistica", "Tláloc Logística", "MX", E],
  ["cantera_estudio", "Cantera Estudio", "MX", E],
  ["marea_alta_cafe", "Marea Alta Café", "MX", E],
  ["fernando_ruiz", "Fernando Ruiz", "MX", P],
  ["pampa_cloud", "Pampa Cloud", "AR", E],
  ["estudio_rioplatense", "Estudio Rioplatense", "AR", E],
  ["lucia_ferrer", "Lucía Ferrer", "AR", P],
  ["andes_pay", "Andes Pay", "CL", E],
  ["vina_maitenes", "Viña Los Maitenes", "CL", E],
  ["canal_seguro", "Canal Seguro", "PA", E],
  ["istmo_trading", "Istmo Trading", "PA", E],
  ["quito_solar", "Quito Solar", "EC", E],
  ["mitad_del_mundo_tours", "Mitad del Mundo Tours", "EC", E],
  ["inti_agro", "Inti Agro", "PE", E],
  ["machu_retail", "Machu Retail", "PE", E],
  ["zafiro_labs", "Zafiro Labs", "VE", E],
  ["veredas_digital", "Veredas Digital", "VE", E],
];

const STATUS_CYCLE: readonly ClientStatus[] = [
  "ACTIVO",
  "ACTIVO",
  "PROSPECTO",
  "INACTIVO",
  "ACTIVO",
  "PROSPECTO",
  "ACTIVO",
  "ACTIVO",
];

const TAG_CYCLE: readonly (readonly string[])[] = [
  ["cliente_clave"],
  [],
  ["internacional"],
  ["recurrente"],
  [],
  ["prioritario", "recurrente"],
  [],
  ["piloto"],
  ["mantenimiento"],
  [],
];

function taxIdFor(country: string, kind: ClientKind, index: number): string {
  const profile = COUNTRIES[country]!;
  if (country === "VE") {
    const letter = kind === "PERSONA" ? "V" : profile.taxPrefix;
    const body = String(30_000_000 + index * 1117).padStart(8, "0");
    return `${letter}-${body}-${index % 10}`;
  }
  return `${profile.taxPrefix} ${900_000_000 + index * 7919}-${index % 10}`;
}

/** Fresh client rows; dates are relative to `now` (store build time). */
export function createClientFixtures(now: Date): ClientRow[] {
  return SEEDS.map(([key, tradeName, country, kind = "EMPRESA"], index): ClientRow => {
    const profile = COUNTRIES[country]!;
    const archived = key === "veredas_digital";
    const status: ClientStatus =
      key === "kairos" || key === "zafiro_labs"
        ? "ACTIVO"
        : archived
          ? "INACTIVO"
          : STATUS_CYCLE[index % STATUS_CYCLE.length]!;
    const age = Math.max(2, 270 - Math.round(index * 4.05));
    const createdAt = at(now, age);
    const domain = key.replaceAll("_", "-");
    const city = profile.cities[index % profile.cities.length]!;
    return {
      id: mockId("cli", key),
      code: `CLI-${String(index + 1).padStart(4, "0")}`,
      kind,
      tradeName,
      legalName: kind === "PERSONA" ? tradeName : `${tradeName} ${profile.suffix}`,
      taxId: key === "kairos" ? "J-30123456-7" : taxIdFor(country, kind, index + 1),
      country: country as ClientRow["country"],
      address: `Av. Principal ${100 + index * 3}, Edif. Centro ${1 + (index % 9)}, ${city}`,
      phone: `+${profile.phone}555${String(index + 1).padStart(4, "0")}`,
      email: index % 7 === 6 ? null : `contacto@${domain}.example.com`,
      website: index % 3 === 2 ? null : `https://www.${domain}.example.com`,
      status,
      activatedAt: status === "PROSPECTO" ? null : at(now, Math.max(1, age - 6)),
      tagIds: (key === "kairos"
        ? ["cliente_clave", "prioritario"]
        : TAG_CYCLE[index % TAG_CYCLE.length]!
      ).map((tag) => mockId("tag", tag)),
      createdAt,
      updatedAt: at(now, Math.max(1, Math.round(age / 2))),
      archivedAt: archived ? at(now, 20, 16) : null,
      deletedById: archived ? ARCHIVER_ID : null,
    };
  });
}

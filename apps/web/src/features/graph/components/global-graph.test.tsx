import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi, type MockApi } from "@/lib/api/testing";
import { GLOBAL_GRAPH_DEFAULT_TYPES, graphNodeId } from "@/lib/validators/graph";
import {
  GLOBAL_ARCHIVED_NODE,
  GLOBAL_GRAPH,
  globalGraphRoutes,
} from "../testing/graph-http-fixtures";
import { GlobalGraph } from "./global-graph";
import { installReactFlowMocks, renderWithIntl } from "./test-utils";

// HU-25 CA1–CA2 over the HTTP test double (the real Server Actions and client run). CA3 (≥ 50 fps with 500 nodes)
// is checked by hand (A3).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

let api: MockApi;

const KAIROS = graphNodeId("CLIENT", "cli_kairos");

beforeAll(installReactFlowMocks);
beforeEach(() => {
  api = mockApi(globalGraphRoutes());
  mocks.getServerApi.mockResolvedValue(api.api);
});

/** The global graph requests the page sent, in order. */
function globalCalls() {
  return api.calls.filter((call) => call.path === "/api/v1/graph");
}

function nodeList(): HTMLElement {
  const list = screen.getByText("Lista de nodos").closest("section")?.querySelector("ul");
  if (!list) throw new Error("node list not rendered");
  return list;
}

// Role queries over a canvas of ~100 nodes are slow in jsdom: the popover and the toolbar are queried directly.
async function openFilters() {
  await userEvent.setup().click(screen.getByText("Filtros").closest("button") as HTMLElement);
  await waitFor(() =>
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull(),
  );
  return within(document.querySelector('[data-slot="popover-content"]') as HTMLElement);
}

async function renderGlobal() {
  const view = renderWithIntl(
    <GlobalGraph
      initial={GLOBAL_GRAPH}
      canSeeArchived
      tags={[{ id: "tag_prioritario", name: "Prioritario" }]}
      technologies={[{ id: "tec_react", name: "React" }]}
    />,
  );
  await screen.findByTestId(`graph-node-${KAIROS}`, {}, { timeout: 8000 });
  return { initial: GLOBAL_GRAPH, ...view };
}

describe("GlobalGraph", { timeout: 30000 }, () => {
  it("CA1: shows clients, projects and documents by default with the force layout", async () => {
    const { initial } = await renderGlobal();

    expect(new Set(initial.nodes.map((node) => node.type))).toEqual(
      new Set(GLOBAL_GRAPH_DEFAULT_TYPES),
    );
    const layouts = within(
      screen.getByText("Radial").closest('[role="radiogroup"]') as HTMLElement,
    );
    expect(layouts.getByRole("radio", { name: "Fuerzas" })).toHaveAttribute("aria-checked", "true");
    const listed = nodeList().querySelectorAll("button[aria-pressed]");
    expect(listed).toHaveLength(initial.nodes.length);

    const filters = await openFilters();
    for (const label of ["Clientes", "Proyectos", "Documentos"]) {
      expect(
        filters.getByRole("checkbox", { name: new RegExp(`^${label} \\(\\d+\\)$`) }),
      ).toBeChecked();
    }
    expect(filters.getByRole("checkbox", { name: /^Facturas \(0\)$/ })).not.toBeChecked();
    expect(filters.getByRole("switch", { name: "Solo activos" })).not.toBeChecked();
    expect(api.calls).toHaveLength(0);
  });

  it("CA2: searching a name centers and highlights that node", async () => {
    const { container } = await renderGlobal();
    const user = userEvent.setup();
    const viewport = container.querySelector<HTMLElement>(".react-flow__viewport");
    const before = viewport?.style.transform;

    await user.type(screen.getByLabelText("Buscar en el grafo"), "kairos studio");
    await user.click(screen.getByLabelText("Buscar", { selector: "button" }));

    expect(await screen.findByText("Centrado en Kairos Studio.")).toBeInTheDocument();
    expect(screen.getByTestId(`graph-node-${KAIROS}`)).toHaveAttribute("data-highlighted", "true");
    await waitFor(() => expect(viewport?.style.transform).not.toBe(before));
    const panel = within(screen.getByLabelText("Nodo seleccionado", { selector: "section" }));
    expect(panel.getByRole("heading", { name: "Kairos Studio" })).toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Ver desde aquí" })).toHaveAttribute(
      "href",
      "/clients/cli_kairos/graph",
    );
  });

  it('the "Mostrar archivados" switch reloads the global graph with archived nodes', async () => {
    await renderGlobal();
    const user = userEvent.setup();
    expect(screen.queryByTestId(`graph-node-${GLOBAL_ARCHIVED_NODE}`)).not.toBeInTheDocument();

    const filters = await openFilters();
    await user.click(filters.getByRole("switch", { name: "Mostrar archivados" }));

    expect(
      await screen.findByTestId(`graph-node-${GLOBAL_ARCHIVED_NODE}`, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    expect(globalCalls().at(-1)?.search.get("includeArchived")).toBe("true");
  });

  it('reloads with the server filters when a type or "Solo activos" changes, and shows the stats', async () => {
    const { initial } = await renderGlobal();
    const user = userEvent.setup();
    const stats = within(screen.getByLabelText("Estadísticas", { selector: "section" }));
    expect(stats.getByText(String(initial.nodes.length))).toBeInTheDocument();
    expect(stats.getByText("Más conectados")).toBeInTheDocument();

    const filters = await openFilters();
    await user.click(filters.getByRole("switch", { name: "Solo activos" }));
    await waitFor(() => expect(globalCalls().at(-1)?.search.get("onlyActive")).toBe("true"));
    await user.click(filters.getByRole("checkbox", { name: /^Facturas \(\d+\)$/ }));
    await waitFor(() =>
      expect(globalCalls().at(-1)?.search.getAll("include")).toEqual(
        expect.arrayContaining(["INVOICE", ...GLOBAL_GRAPH_DEFAULT_TYPES]),
      ),
    );
  });
});

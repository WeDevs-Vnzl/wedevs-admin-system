import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actionOk } from "@/lib/validators/common";
import {
  GRAPH_EXPANSION_LIMIT,
  graphNodeId,
  type ExpandNodeInput,
  type GetEntityGraphInput,
  type GraphResponse,
} from "@/lib/validators/graph";
import type { MockServiceContext } from "@/mocks/ctx";
import { expandNode, getEntityGraph } from "@/mocks/services/graph";
import { makeTestContext } from "@/mocks/test-helpers";
import { ENTITY_GRAPH_TYPES, HIDDEN_BY_DEFAULT } from "../graph-model";
import { EntityGraph } from "./entity-graph";
import { HOVER_DELAY_MS } from "./graph-canvas";
import { installReactFlowMocks, renderWithIntl } from "./test-utils";

// HU-24 CA1–CA5 over the mock graph service, plus the node list (keyboard alternative) and Ctrl/⌘ + click.

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

let ctx: MockServiceContext;
const expandSpy = vi.fn();
const reloadSpy = vi.fn();
vi.mock("@/features/graph/actions", () => ({
  expandNodeAction: async (input: ExpandNodeInput) => {
    expandSpy(input);
    return actionOk(await expandNode(ctx, input));
  },
  getEntityGraphAction: async (input: GetEntityGraphInput) => {
    reloadSpy(input);
    return actionOk(await getEntityGraph(ctx, input));
  },
  getGlobalGraphAction: vi.fn(),
}));

const KAIROS = graphNodeId("CLIENT", "cli_kairos");
const KAIROS_WEB = graphNodeId("PROJECT", "pry_kairos_web");
const KAIROS_APP = graphNodeId("PROJECT", "pry_kairos_app");

beforeAll(installReactFlowMocks);
beforeEach(() => {
  ctx = makeTestContext("OWNER").ctx;
  push.mockReset();
  expandSpy.mockReset();
  reloadSpy.mockReset();
});

async function loadRoot(): Promise<GraphResponse> {
  return getEntityGraph(ctx, {
    type: "CLIENT",
    id: "cli_kairos",
    depth: 1,
    include: ENTITY_GRAPH_TYPES,
  });
}

// Role queries over the whole canvas are slow in jsdom; the list is found through its heading instead.
function nodeList(): HTMLElement {
  const list = screen.getByText("Lista de nodos").closest("section")?.querySelector("ul");
  if (!list) throw new Error("node list not rendered");
  return list;
}

const canvasNode = (id: string) => document.querySelector(`[data-testid="graph-node-${id}"]`);

async function renderKairos() {
  const initial = await loadRoot();
  const view = renderWithIntl(<EntityGraph initial={initial} rootId={KAIROS} canSeeArchived />);
  await screen.findByTestId(`graph-node-${KAIROS}`, {}, { timeout: 8000 });
  return { initial, ...view };
}

// The canvas renders tens of nodes in jsdom: generous timeouts keep the suite stable under parallel load.
describe("EntityGraph", { timeout: 30000 }, () => {
  it("CA1: loads the client as root with its direct contacts, projects, invoices, payments, documents and notes", async () => {
    const { initial } = await renderKairos();

    const shown = initial.nodes.filter((node) => !HIDDEN_BY_DEFAULT.includes(node.type));
    const types = new Set(shown.map((node) => node.type));
    for (const type of ["CONTACT", "PROJECT", "INVOICE", "PAYMENT", "DOCUMENT", "NOTE"] as const) {
      expect(types, type).toContain(type);
    }
    const listed = new Set(
      [...nodeList().querySelectorAll("button[aria-pressed]")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    );
    for (const node of shown) {
      expect(listed, node.label).toContain(`Seleccionar ${node.label}`);
      expect(canvasNode(node.id), node.id).toBeInTheDocument();
    }
    // The root is the starting point: it has no "+"/"−" of its own.
    expect(
      screen.queryByRole("button", { name: "Expandir Kairos Studio" }),
    ).not.toBeInTheDocument();
  });

  it("CA2: expanding a project adds its documents, invoices, expenses and the other clients of the project", async () => {
    await renderKairos();
    const user = userEvent.setup();

    await user.click(within(nodeList()).getByLabelText("Expandir Sitio web Kairos Studio"));
    expect(expandSpy).toHaveBeenCalledWith(expect.objectContaining({ nodeId: KAIROS_WEB }));
    const web = await expandNode(ctx, { nodeId: KAIROS_WEB, include: ENTITY_GRAPH_TYPES });
    const webTypes = new Set(web.nodes.map((node) => node.type));
    for (const type of ["DOCUMENT", "INVOICE", "EXPENSE"] as const)
      expect(webTypes, type).toContain(type);
    const shownWeb = web.nodes.filter((item) => !HIDDEN_BY_DEFAULT.includes(item.type));
    await waitFor(
      () => {
        for (const node of shownWeb) expect(canvasNode(node.id), node.id).toBeInTheDocument();
      },
      { timeout: 8000 },
    );

    // Double click on the canvas node expands too: the shared project brings in its other client.
    fireEvent.doubleClick(screen.getByTestId(`graph-node-${KAIROS_APP}`));
    expect(
      await screen.findByTestId(
        `graph-node-${graphNodeId("CLIENT", "cli_hotel_mochima")}`,
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument();

    // "−" collapses: the nodes brought by the expansion leave, the project stays.
    await user.click(within(nodeList()).getByLabelText("Contraer App de reservas Kairos"));
    await waitFor(() =>
      expect(
        screen.queryByTestId(`graph-node-${graphNodeId("CLIENT", "cli_hotel_mochima")}`),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId(`graph-node-${KAIROS_APP}`)).toBeInTheDocument();
  });

  it('CA3: hovering a node shows the preview card after 300 ms, and its "Abrir detalle" links to the record', async () => {
    await renderKairos();
    const node = screen.getByTestId(`graph-node-${KAIROS_WEB}`);

    vi.useFakeTimers();
    try {
      fireEvent.mouseEnter(node);
      act(() => vi.advanceTimersByTime(HOVER_DELAY_MS - 50));
      expect(
        screen.queryByRole("dialog", { name: "Sitio web Kairos Studio" }),
      ).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(50));
    } finally {
      vi.useRealTimers();
    }
    const card = screen.getByRole("dialog", { name: "Sitio web Kairos Studio" });
    expect(within(card).getByText("Proyecto · PRY-0001")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Abrir detalle" })).toHaveAttribute(
      "href",
      "/projects/pry_kairos_web",
    );

    fireEvent.mouseLeave(node);
    expect(
      screen.queryByRole("dialog", { name: "Sitio web Kairos Studio" }),
    ).not.toBeInTheDocument();
  });

  it("opens the record detail with Ctrl/⌘ + click on a node", async () => {
    await renderKairos();
    fireEvent.click(screen.getByTestId(`graph-node-${KAIROS_WEB}`), { ctrlKey: true });
    expect(push).toHaveBeenCalledWith("/projects/pry_kairos_web");
    fireEvent.click(screen.getByTestId(`graph-node-${KAIROS_APP}`), { metaKey: true });
    expect(push).toHaveBeenCalledWith("/projects/pry_kairos_app");
  });

  it("CA4: the type filter hides and shows nodes without reloading", async () => {
    await renderKairos();
    const user = userEvent.setup();
    const projectButton = () =>
      within(nodeList()).queryByLabelText("Seleccionar Sitio web Kairos Studio");
    expect(projectButton()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filtros" }));
    const projects = await screen.findByRole("checkbox", { name: /^Proyectos \(\d+\)$/ });
    expect(projects).toBeChecked();
    await user.click(projects);

    await waitFor(() => expect(projectButton()).not.toBeInTheDocument());
    expect(screen.queryByTestId(`graph-node-${KAIROS_WEB}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`graph-node-${KAIROS}`)).toBeInTheDocument();

    await user.click(projects);
    await waitFor(() => expect(projectButton()).toBeInTheDocument());
    expect(screen.getByTestId(`graph-node-${KAIROS_WEB}`)).toBeInTheDocument();
    expect(reloadSpy).not.toHaveBeenCalled();
    expect(expandSpy).not.toHaveBeenCalled();
  });

  it('CA5: with more than 50 neighbours a "+N más" node appears and loads the next page', async () => {
    const template = ctx.db.contacts[0];
    if (!template) throw new Error("no contact fixture");
    for (let i = 0; i < GRAPH_EXPANSION_LIMIT + 10; i += 1) {
      ctx.db.contacts.push({
        ...structuredClone(template),
        id: `con_bulk_${String(i).padStart(3, "0")}`,
        clientId: "cli_kairos",
        fullName: `Contacto ${String(i).padStart(3, "0")}`,
        archivedAt: null,
      });
    }
    const { initial } = await renderKairos();
    const [truncated] = initial.truncated;
    expect(truncated?.nodeId).toBe(KAIROS);
    const remaining = truncated?.remaining ?? 0;
    expect(remaining).toBeGreaterThan(0);

    expect(
      within(nodeList()).getByText(`Cargar ${remaining} vecinos más de Kairos Studio`),
    ).toBeInTheDocument();
    const more = await screen.findByLabelText(`Cargar ${remaining} vecinos más de Kairos Studio`, {
      selector: "button[aria-label]",
    });
    expect(more).toHaveTextContent(`+${remaining} más`);
    await userEvent.setup().click(more);

    expect(expandSpy).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: KAIROS, cursor: truncated?.cursor }),
    );
    const page = await expandNode(ctx, {
      nodeId: KAIROS,
      cursor: truncated?.cursor,
      include: ENTITY_GRAPH_TYPES,
    });
    const added = page.nodes.find(
      (node) => node.id !== KAIROS && !HIDDEN_BY_DEFAULT.includes(node.type),
    );
    expect(added).toBeDefined();
    expect(
      await screen.findByTestId(`graph-node-${added?.id}`, {}, { timeout: 8000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(`+${remaining} más`)).not.toBeInTheDocument());
  });

  it("offers the node list as a keyboard alternative: Enter selects a node and opens its side panel", async () => {
    await renderKairos();
    const user = userEvent.setup();
    const item = within(nodeList()).getByLabelText("Seleccionar Sitio web Kairos Studio");

    item.focus();
    await user.keyboard("{Enter}");

    expect(item).toHaveAttribute("aria-pressed", "true");
    const panel = screen.getByRole("region", { name: "Nodo seleccionado" });
    expect(
      within(panel).getByRole("heading", { name: "Sitio web Kairos Studio" }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Abrir detalle" })).toHaveAttribute(
      "href",
      "/projects/pry_kairos_web",
    );
    expect(within(panel).getByRole("link", { name: "Ver su grafo" })).toHaveAttribute(
      "href",
      "/projects/pry_kairos_web/graph",
    );
    await user.click(within(panel).getByRole("button", { name: "Expandir" }));
    expect(expandSpy).toHaveBeenCalledWith(expect.objectContaining({ nodeId: KAIROS_WEB }));
  });
});

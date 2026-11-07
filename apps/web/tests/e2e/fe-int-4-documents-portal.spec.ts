import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";
import { assertBackendHealthy } from "./support/backend";

// FE-INT-R E.2 documents and portal E2E (old 4.5). Back office (`@authenticated`): HU-18 CA1–CA4, HU-19 CA1 and CA4,
// HU-20 CA1–CA2, HU-21 CA1–CA2, HU-22 CA1–CA2 (create a link; a key-protected document), HU-28 for a document.
// Portal (`@unauthenticated`, rule 30): the unknown-token probe, and the cases that need a real link token as `fixme`.
//
// Rule 29: every spec creates its own data through the UI with unique names. A portal case that needs a real link
// token cannot create one in the `unauthenticated` project (no Clerk session), so it is `fixme` with that reason; the
// same behaviour runs in `h1-b4-documents-portal.spec.ts`, which creates its own link in the `authenticated` project.
// The unknown-token probe uses a random token generated per run, never a fixed one.

/** An exact label (button, role, heading) in either locale. */
const oneOf = (...labels: string[]) => new RegExp(`^(${labels.map(escapeRegExp).join("|")})$`);

/** A label found anywhere in a text node, in either locale. */
const anyOf = (...labels: string[]) => new RegExp(labels.map(escapeRegExp).join("|"));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function idFromUrl(url: string, segment: string): string {
  const id = new RegExp(`/${segment}/([^/?#]+)`).exec(url)?.[1];
  if (!id) throw new Error(`No /${segment}/ id in ${url}`);
  return id;
}

const uniq = (label: string) => `E2E docs ${label} ${Date.now()}`;

/** A 43-character token of the `/s/<token>` shape (32 random bytes, base64url), generated per run. */
const randomToken = () => randomBytes(32).toString("base64url");

/** Creates a draft document of the type matched by `typeName` and returns its id. */
async function createDocument(page: Page, title: string, typeName: RegExp): Promise<string> {
  await page.goto("/documents/new");
  await page.getByLabel("Título", { exact: true }).fill(title);
  await page.getByRole("combobox", { name: "Tipo de documento", exact: true }).click();
  await page.getByRole("option", { name: typeName }).click();
  await page.getByRole("button", { name: "Crear documento", exact: true }).click();
  await expect(page.getByText("Documento creado")).toBeVisible();
  await expect(page).toHaveURL(/\/documents\/[^/?#]+$/);
  return idFromUrl(page.url(), "documents");
}

/** Saves the markdown source and publishes it as version `version` (the first publish is v1). */
async function publishMarkdown(page: Page, id: string, source: string, version: number) {
  await page.goto(`/documents/${id}/editor`);
  await page.getByRole("textbox", { name: oneOf("Fuente markdown", "Markdown source") }).fill(source);
  await page
    .getByRole("button", { name: oneOf(`Publicar versión v${version}`, `Publish version v${version}`) })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#document-editor-changelog").fill(`Versión ${version} E2E`);
  await dialog.getByRole("button", { name: oneOf("Publicar", "Publish") }).click();
  await expect(
    page.getByText(anyOf(`Versión v${version} publicada`, `Version v${version} published`)),
  ).toBeVisible();
}

/** A client and a project of this run, created through the UI. Returns their names and ids. */
async function createClientAndProject(page: Page) {
  const clientName = uniq("cliente");
  await page.goto("/clients/new");
  await page.getByLabel("Nombre comercial", { exact: true }).fill(clientName);
  await page
    .getByLabel("Identificador fiscal", { exact: true })
    .fill(`J-${Math.floor(10_000_000 + Math.random() * 89_999_999)}-1`);
  await page.getByLabel("Dirección", { exact: true }).fill("Calle E2E 1");
  await page.locator("#client-phone").fill("+57 300 123 4567");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/clients\/[^/?#]+$/);
  const clientId = idFromUrl(page.url(), "clients");

  const projectName = uniq("proyecto");
  await page.goto("/projects/new");
  await page.getByLabel("Nombre", { exact: true }).fill(projectName);
  await page.getByLabel("Resumen", { exact: true }).fill("Proyecto E2E de documentos");
  await page.getByRole("combobox", { name: "Clientes", exact: true }).fill(clientName);
  await page.getByRole("option", { name: clientName, exact: true }).click();
  await page.getByRole("textbox", { name: `Rol: ${clientName}`, exact: true }).fill("Contratante");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/pry_/);
  const projectId = idFromUrl(page.url(), "projects");
  return { clientName, clientId, projectName, projectId };
}

/** Links a document to a registry record from its *Vínculos* tab (the record picker adds it on selection). */
async function linkRecord(page: Page, docId: string, type: RegExp, name: string) {
  await page.goto(`/documents/${docId}?tab=links`);
  await page.getByRole("combobox", { name: "Tipo de registro", exact: true }).click();
  await page.getByRole("option", { name: type }).click();
  await page.getByLabel("Buscar un registro", { exact: true }).fill(name);
  await page.getByRole("option", { name: new RegExp(`^${escapeRegExp(name)}`) }).click();
  await expect(page.getByText(anyOf("Registro vinculado", "Record linked"))).toBeVisible();
}

test.describe("FE-INT-R E.2 documents and portal", () => {
  test.beforeAll(async () => {
    await assertBackendHealthy();
  });

  // ───────────────────────────── HU-18 · markdown editor and versions ─────────────────────────────

  test("@authenticated HU-18 CA1/CA4: explicit save keeps the draft without a version; script, iframe and handlers never run", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const id = await createDocument(page, uniq("prd"), /^PRD$/);
    await publishMarkdown(page, id, "# Versión inicial", 1);

    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));

    await page.goto(`/documents/${id}/editor`);
    await page.getByRole("textbox", { name: oneOf("Fuente markdown", "Markdown source") }).fill(
      [
        "# Borrador E2E",
        "",
        "Texto de prueba.",
        "",
        "<script>window.__e2ePwned = 1</script>",
        "",
        '<iframe src="https://evil.example.com/frame"></iframe>',
        "",
        '<img src="x" onerror="window.__e2ePwned = 2">',
        "",
      ].join("\n"),
    );
    await page.getByRole("button", { name: oneOf("Guardar borrador", "Save draft") }).click();
    await expect(page.getByText(oneOf("Guardado", "Saved"))).toBeVisible();

    // CA1: the save creates no version; the current one stays v1.
    await expect(page.getByText(anyOf("Vigente: v1", "Current: v1"))).toBeVisible();

    // CA4: the rendered preview carries no script, iframe or event handler, and nothing ran.
    const preview = page.getByLabel(oneOf("Vista previa", "Preview"));
    await expect(preview.getByRole("heading", { name: "Borrador E2E" })).toBeVisible();
    await expect(preview.locator("script, iframe, img[onerror]")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__e2ePwned)).toBe(undefined);
    expect([...hosts].filter((host) => host.includes("evil.example.com"))).toEqual([]);

    // The draft survives a reload; the history still ends at v1.
    await page.goto(`/documents/${id}/editor`);
    await expect(page.getByRole("textbox", { name: oneOf("Fuente markdown", "Markdown source") })).toHaveValue(
      /Borrador E2E/,
    );
    await page.goto(`/documents/${id}?tab=versions`);
    await expect(page.getByText("v2", { exact: true })).toHaveCount(0);
  });

  test("@authenticated HU-18 CA2/CA3: publishing v2 makes it current; compare with the current; restoring v1 creates v3", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const id = await createDocument(page, uniq("prd-versiones"), /^PRD$/);
    await publishMarkdown(page, id, "# Versión 1", 1);
    await publishMarkdown(page, id, "# Versión 2", 2);
    await expect(page.getByText(anyOf("Vigente: v2", "Current: v2"))).toBeVisible();

    // CA2: the history lists v2 as current with its changelog.
    await page.goto(`/documents/${id}?tab=versions`);
    const v2 = page.getByRole("listitem").filter({ hasText: "Versión 2 E2E" });
    await expect(v2.getByText(oneOf("Vigente", "Current"))).toBeVisible();

    // CA3: compare v1 with the current version.
    await page.getByRole("link", { name: /^(Comparar v1 con la versión vigente|Compare v1 with)/ }).click();
    await expect(page).toHaveURL(/\/versions\/[^/]+\/compare/);
    await expect(page.getByRole("heading", { name: /v1 comparada con v2|v1 compared with v2/ })).toBeVisible();

    // CA3: restoring v1 creates v3 as a copy of v1; the history keeps v1.
    await page.goto(`/documents/${id}?tab=versions`);
    await page.getByRole("button", { name: oneOf("Restaurar v1", "Restore v1") }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: oneOf("Restaurar", "Restore") }).click();
    await expect(page.getByText(anyOf("Versión restaurada", "Version restored"))).toBeVisible();
    await page.goto(`/documents/${id}/editor`);
    await expect(page.getByText(anyOf("Vigente: v3", "Current: v3"))).toBeVisible();
  });

  // ───────────────────────────── HU-19 · signed contract ─────────────────────────────

  test("@authenticated HU-19 CA1/CA4: FIRMADO needs the signing date; a signed document takes no new versions", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const id = await createDocument(page, uniq("contrato"), /^Contrato de servicios$/);

    // CA1: marking it FIRMADO without the signing date is refused; with the date it is accepted.
    await page.goto(`/documents/${id}`);
    await page.getByRole("button", { name: oneOf("Cambiar estado", "Change status") }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: oneOf("Nuevo estado", "New status") }).click();
    await page.getByRole("option", { name: oneOf("Firmado", "Signed") }).click();
    await dialog.getByRole("button", { name: oneOf("Cambiar estado", "Change status") }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(oneOf("Fecha de firma", "Signing date"), { exact: true }).fill(
      new Date().toISOString().slice(0, 10),
    );
    await dialog.getByRole("button", { name: oneOf("Cambiar estado", "Change status") }).click();
    await expect(page.getByText(oneOf("Estado actualizado", "Status updated"))).toBeVisible();

    // CA4: a FIRMADO document answers no new versions; the upload control stays, disabled.
    await page.goto(`/documents/${id}?tab=versions`);
    await expect(
      page.getByText(
        anyOf("Los documentos firmados no admiten versiones nuevas", "Signed documents do not accept new versions"),
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: oneOf("Subir nueva versión", "Upload new version") })).toBeDisabled();
  });

  // ───────────────────────────── HU-20 · one document, several records ─────────────────────────────

  test("@authenticated HU-20 CA1/CA2: the document shows on the client and the project; unlinking the project keeps the client", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const { clientName, clientId, projectName, projectId } = await createClientAndProject(page);
    const title = uniq("nda");
    const id = await createDocument(page, title, /^PRD$/);
    await linkRecord(page, id, /^(Cliente|Client)$/, clientName);
    await linkRecord(page, id, /^(Proyecto|Project)$/, projectName);

    // CA1: the document appears in the Documentos tab of the client and of the project.
    await page.goto(`/clients/${clientId}`);
    await page.getByRole("tab", { name: oneOf("Documentos", "Documents") }).click();
    await expect(page.getByText(title).first()).toBeVisible();
    await page.goto(`/projects/${projectId}`);
    await page.getByRole("tab", { name: oneOf("Documentos", "Documents") }).click();
    await expect(page.getByText(title).first()).toBeVisible();

    // CA2: unlinking the project leaves the client link in place.
    await page.goto(`/documents/${id}?tab=links`);
    await page
      .getByRole("button", { name: new RegExp(`^Desvincular: ${escapeRegExp(projectName)}$`) })
      .click();
    await page.getByRole("alertdialog").getByRole("button", { name: oneOf("Desvincular", "Unlink") }).click();
    await expect(page.getByText(anyOf("Registro desvinculado", "Record unlinked"))).toBeVisible();
    await page.goto(`/clients/${clientId}`);
    await page.getByRole("tab", { name: oneOf("Documentos", "Documents") }).click();
    await expect(page.getByText(title).first()).toBeVisible();
    await page.goto(`/projects/${projectId}`);
    await page.getByRole("tab", { name: oneOf("Documentos", "Documents") }).click();
    await expect(page.getByText(title)).toHaveCount(0);
  });

  // ───────────────────────────── HU-21 · configurable types ─────────────────────────────

  test("@authenticated HU-21 CA1/CA2: a new type is offered at once; a type in use cannot be deleted, only deactivated", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const typeName = uniq("tipo");
    await page.goto("/settings/document-types");
    await page.getByRole("button", { name: "Agregar un tipo a Legal", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Nombre", { exact: true }).fill(typeName);
    await dialog.getByRole("button", { name: oneOf("Crear", "Create") }).click();
    await expect(page.getByRole("listitem").filter({ hasText: typeName })).toBeVisible();

    // CA1: offered at once in the document form.
    await page.goto("/documents/new");
    await page.getByRole("combobox", { name: "Tipo de documento", exact: true }).click();
    await expect(page.getByRole("option", { name: typeName })).toBeVisible();
    await page.keyboard.press("Escape");

    // CA2: a document of that type puts it in use; deleting the type then offers deactivation only.
    await createDocument(page, uniq("en-uso"), new RegExp(`^${escapeRegExp(typeName)}$`));
    await page.goto("/settings/document-types");
    const type = page.getByRole("listitem").filter({ hasText: typeName });
    await type.getByRole("button", { name: `Eliminar ${typeName}`, exact: true }).click();
    const notice = page.getByRole("alertdialog");
    await expect(notice.getByText(anyOf("Tipo de documento en uso", "Document type in use"))).toBeVisible();
    await notice.getByRole("button", { name: oneOf("Desactivar", "Deactivate") }).click();
    await expect(type.getByRole("switch")).not.toBeChecked();
    await expect(type).toBeVisible();
  });

  // ───────────────────────────── HU-22 · back office: create a link ─────────────────────────────

  test("@authenticated HU-22 CA1/CA2: sharing creates a /s/<token> link of 43 characters; a key-protected document shows its one-time key once", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const id = await createDocument(page, uniq("compartido"), /^PRD$/);
    await publishMarkdown(page, id, "# Documento compartido", 1);

    await page.goto(`/documents/${id}?tab=shares`);
    await page.getByRole("button", { name: "Compartir", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Compartir en el portal")).toBeVisible();
    // CA2: the document is protected by an access key, generated once when the link is saved.
    await dialog.getByRole("switch", { name: /^Exigir una clave de acceso para / }).click();
    await dialog.getByRole("button", { name: "Crear enlace", exact: true }).click();

    // The one-time keys dialog shows the key once.
    await expect(page.getByText("Copie ahora las claves de acceso")).toBeVisible();
    await page.getByRole("button", { name: "Ya copié las claves", exact: true }).click();
    // CA1: the open link points at /s/<token>, a token of 43 characters.
    await expect(page.getByRole("link", { name: "Abrir enlace", exact: true })).toHaveAttribute(
      "href",
      /\/s\/[A-Za-z0-9_-]{43}$/,
    );
  });

  // ───────────────────────────── HU-28 · document archive ─────────────────────────────

  test.fixme(
    "@authenticated HU-28 for a document: archive → trash → restore — FE-INT-R E.2: the document archive has no UI control (archiveDocumentAction has no consumer in src); the batch-close manual check covers it once the control lands",
    async () => {
      // Placeholder: enable when the document detail or table exposes the archive control.
    },
  );

  // ───────────────────────────── Portal (unauthenticated) ─────────────────────────────

  test("@unauthenticated HU-22 CA3/CA7: an unknown or altered token answers the generic 404 with the portal headers", async ({
    page,
  }) => {
    // A random 43-character token that no link holds is the same as a changed character of a real one: both are
    // unknown to the BE and get the same bare 404 (C22).
    const response = await page.goto(`/s/${randomToken()}`);
    expect(response?.status()).toBe(404);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("heading", { name: oneOf("Enlace no disponible", "Link not available") })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/revocad|expirad|revoked|expired/i);
  });

  test.fixme(
    "@unauthenticated HU-22 CA3: a changed character of a real link's token → 404 — FE-INT-R E.2: needs a real link token, which an unauthenticated run cannot create; covered by h1-b4-documents-portal.spec.ts",
    async () => {
      // Placeholder: the real-token case is covered by the authenticated legacy spec.
    },
  );

  test.fixme(
    "@unauthenticated HU-22 CA4: a revoked or expired link → the same generic 404 — FE-INT-R E.2: needs a real link token; covered by h1-b4-documents-portal.spec.ts",
    async () => {
      // Placeholder: the real-token case is covered by the authenticated legacy spec.
    },
  );

  test.fixme(
    "@unauthenticated HU-22 CA2/CA5: the link lists its documents with view and download — FE-INT-R E.2: needs a real link token; covered by h1-b4-documents-portal.spec.ts",
    async () => {
      // Placeholder: the real-token case is covered by the authenticated legacy spec.
    },
  );

  test.fixme(
    "@unauthenticated HU-22 unlock: a wrong key, the lockout after five failures as the try-again state, and the right key → view and download (DT-224) — FE-INT-R E.2: needs a real link token; covered by h1-b4-documents-portal.spec.ts",
    async () => {
      // Placeholder: the real-token case is covered by the authenticated legacy spec.
    },
  );

  test.fixme(
    "@unauthenticated HU-22 CA6: allowDownload=false hides the download — FE-INT-R E.2: needs a real link token; covered by h1-b4-documents-portal.spec.ts (a link with downloads blocked, created in the authenticated run)",
    async () => {
      // Placeholder: the real-token case is covered by the authenticated legacy spec.
    },
  );
});

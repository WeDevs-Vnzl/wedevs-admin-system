import { expect, test, type Page } from "@playwright/test";

// T11 E2E, H1-B4 documents and portal (odd/tasks/h1-b4-documents-portal-ui.md S12): HU-18 (explicit save without
// version, publish N+1, compare, restore; script and iframe never executed), HU-19 UI, HU-20, HU-21, HU-22 CA2-CA4
// and CA6 over mocks, the key-protected document (view and download blocked until the right key, wrong-key error,
// lockout after 5 failures), the portal mobile layout and the PDF toolbar. This file starts nothing: it runs against
// PLAYWRIGHT_BASE_URL (safeguards.md rule 1). The mock store is one in-memory object per server process, so run it
// with `--workers=1`; every test resets the mock data first. Default role: Owner.
// Seed facts (src/mocks/fixtures): `doc_prd_kairos_web` is APROBADO markdown with v1-v3; `doc_contrato_kairos` is
// FIRMADO (no new versions) and the Kairos link pins it to v2; `doc_credenciales_kairos` is key-protected with
// `KAIRO-STAGE-2026` (format ENLACE, so its file route redirects with 307 once unlocked).
// Lockout: keyed on link + document + salted IP hash, so every portal test uses its own TEST-NET-2 visitor address
// through `x-forwarded-for` and a lockout can never reach the user's own bucket.

const KAIROS_TOKEN = "qB_oM6fupiHqU3EEP1WJdPrUEEVQLSStshw-uBByF7s";
const REVOKED_TOKEN = "jKfayR-yjhR8KWmwa3SY2EYchtiKTV93lqeLnwAfEeQ";
const EXPIRED_TOKEN = "VE3SkdLgPirl7OirECK-fnjVddKW_sjAIjqx5uanl2I";
const KAIROS_KEY = "KAIRO-STAGE-2026";
const CONTRACT_DOC = "doc_contrato_kairos";
const PRD_DOC = "doc_prd_kairos_web";
const KEYED_DOC = "doc_credenciales_kairos";
const CONTRACT_TITLE = "Contrato de servicios — Kairos Studio";
const PRD_TITLE = "PRD — Sitio web Kairos";
const KEYED_TITLE = "Credenciales de staging — Kairos";

async function resetMockData(page: Page) {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^(Menú de usuario|User menu)$/ }).click();
  await page
    .getByRole("menuitem", { name: /^(Restablecer datos de prueba|Reset mock data)$/ })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^(Restablecer|Reset)$/ })
    .click();
  await expect(page.getByText(/Datos de prueba restablecidos|Mock data reset/)).toBeVisible();
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

let visitorSeq = Math.floor(Math.random() * 200);

/** A unique TEST-NET-2 visitor for this test: the portal lockout is keyed on the salted hash of this address. */
async function asVisitor(page: Page): Promise<string> {
  visitorSeq += 1;
  const ip = `198.51.100.${(visitorSeq % 250) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return ip;
}

function card(page: Page, title: string) {
  return page.getByRole("article", { name: title, exact: true });
}

/** Opens the unlock dialog of the keyed document and posts `key`. */
async function unlockWith(page: Page, key: string) {
  await card(page, KEYED_TITLE)
    .getByRole("button", { name: /^(Desbloquear|Unlock)$/ })
    .click();
  await submitKey(page, key);
}

/** Posts `key` from the open unlock dialog and waits for the Server Action answer. */
async function submitKey(page: Page, key: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^(Clave de acceso|Access key)$/).fill(key);
  await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST"),
    dialog.getByRole("button", { name: /^(Desbloquear|Unlock)$/ }).click(),
  ]);
}

test.beforeEach(async ({ page }) => {
  await resetMockData(page);
});

// ───────────────────────────── HU-18 · markdown editor and versions ─────────────────────────────

test("HU-18 CA1/CA4: explicit save keeps the draft without a version; script, iframe and handlers never run", async ({
  page,
}) => {
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));

  await open(page, `/documents/${PRD_DOC}/editor`);
  await expect(page.getByText(/Vigente: v3|Current: v3/)).toBeVisible();

  const source = page.getByRole("textbox", { name: /^(Fuente markdown|Markdown source)$/ });
  await source.fill(
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
  await page.getByRole("button", { name: /^(Guardar borrador|Save draft)$/ }).click();
  await expect(page.getByText(/^(Guardado|Saved)$/)).toBeVisible();

  // CA1: the save creates no version; the current one stays v3.
  await expect(page.getByText(/Vigente: v3|Current: v3/)).toBeVisible();

  const preview = page.getByLabel(/^(Vista previa|Preview)$/, { exact: true });
  await expect(preview.getByRole("heading", { name: "Borrador E2E" })).toBeVisible();
  // CA4: the rendered preview carries no script, iframe or event handler, and nothing ran.
  await expect(preview.locator("script, iframe, img[onerror]")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__e2ePwned)).toBe(
    undefined,
  );
  expect([...hosts].filter((host) => host.includes("evil.example.com"))).toEqual([]);

  // The draft survives a reload, and the history still ends at v3.
  await open(page, `/documents/${PRD_DOC}/editor`);
  await expect(
    page.getByRole("textbox", { name: /^(Fuente markdown|Markdown source)$/ }),
  ).toHaveValue(/Borrador E2E/);
  await open(page, `/documents/${PRD_DOC}?tab=versions`);
  await expect(page.getByText("v4", { exact: true })).toHaveCount(0);
});

test("HU-18 CA2/CA3: publish N+1 becomes the current version; compare with the current one; restore creates a new version", async ({
  page,
}) => {
  await open(page, `/documents/${PRD_DOC}/editor`);
  await page.getByRole("button", { name: /^(Publicar versión v4|Publish version v4)$/ }).click();
  const publish = page.getByRole("dialog");
  await publish.locator("#document-editor-changelog").fill("Cambio E2E v4");
  await publish.getByRole("button", { name: /^(Publicar|Publish)$/ }).click();
  await expect(page.getByText(/Versión v4 publicada|Version v4 published/)).toBeVisible();
  await expect(page.getByText(/Vigente: v4|Current: v4/)).toBeVisible();

  // CA2: the history lists v4 as the current version with its changelog.
  await open(page, `/documents/${PRD_DOC}?tab=versions`);
  const v4 = page.getByRole("listitem").filter({ hasText: "Cambio E2E v4" });
  await expect(v4.getByText(/^(Vigente|Current)$/)).toBeVisible();

  // CA3: compare the old v1 with the current version.
  await page
    .getByRole("link", { name: /^(Comparar v1 con la versión vigente|Compare v1 with)/ })
    .click();
  await expect(page).toHaveURL(/\/versions\/[^/]+\/compare/);
  await expect(
    page.getByRole("heading", { name: /v1 comparada con v4|v1 compared with v4/ }),
  ).toBeVisible();

  // CA3: restoring v1 creates v5 as a copy of v1; the history keeps v1.
  await open(page, `/documents/${PRD_DOC}?tab=versions`);
  await page
    .getByRole("button", { name: /^(Restaurar v1|Restore v1)$/ })
    .first()
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^(Restaurar|Restore)$/ })
    .click();
  await expect(page.getByText(/Versión restaurada|Version restored/)).toBeVisible();
  await open(page, `/documents/${PRD_DOC}/editor`);
  await expect(page.getByText(/Vigente: v5|Current: v5/)).toBeVisible();
  await open(page, `/documents/${PRD_DOC}?tab=versions`);
  await expect(page.getByText("v1", { exact: true })).toBeVisible();
});

// ───────────────────────────── HU-19 · signed contract ─────────────────────────────

test("HU-19 CA4: a signed document takes no new versions in the versions tab", async ({ page }) => {
  await open(page, `/documents/${CONTRACT_DOC}?tab=versions`);
  await expect(
    page.getByText(
      /Los documentos firmados no admiten versiones nuevas|Signed documents do not accept new versions/,
    ),
  ).toBeVisible();
  // The upload button stays on the page, disabled.
  const upload = page.getByRole("button", { name: /^(Subir nueva versión|Upload new version)$/ });
  await expect(upload).toBeDisabled();
});

// ───────────────────────────── HU-20 · one document, several records ─────────────────────────────

test("HU-20 CA1/CA2: the contract shows on the client and the projects; unlinking one keeps the others", async ({
  page,
}) => {
  await open(page, "/clients/cli_kairos");
  await page.getByRole("tab", { name: /^(Documentos|Documents)$/ }).click();
  await expect(page.getByText(CONTRACT_TITLE).first()).toBeVisible();

  await open(page, `/documents/${CONTRACT_DOC}?tab=links`);
  await page
    .getByRole("button", { name: /^(Desvincular: .*|Unlink: .*)$/ })
    .last()
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^(Desvincular|Unlink)$/ })
    .click();

  // CA2: the other links are untouched.
  await open(page, "/clients/cli_kairos");
  await page.getByRole("tab", { name: /^(Documentos|Documents)$/ }).click();
  await expect(page.getByText(CONTRACT_TITLE).first()).toBeVisible();
  await open(page, "/projects/pry_kairos_web");
  await page.getByRole("tab", { name: /^(Documentos|Documents)$/ }).click();
  await expect(page.getByText(CONTRACT_TITLE).first()).toBeVisible();
});

// ───────────────────────────── HU-21 · configurable types ─────────────────────────────

test("HU-21 CA1: a new type is offered at once in the document form", async ({ page }) => {
  await open(page, "/settings/document-types");
  await page.getByRole("button", { name: "Agregar un tipo a Legal", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nombre", { exact: true }).fill("Propuesta E2E");
  await dialog.getByRole("button", { name: /^(Crear|Create)$/ }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Propuesta E2E" })).toBeVisible();

  await open(page, "/documents/new");
  await page
    .locator("[data-slot='select-trigger'], button[role='combobox']")
    .filter({ hasText: /Elige un tipo|Choose a type/ })
    .first()
    .click();
  await expect(page.getByRole("option", { name: /Propuesta E2E/ })).toBeVisible();
});

test("HU-21 CA2: a type in use cannot be deleted, only deactivated", async ({ page }) => {
  await open(page, "/settings/document-types");
  const type = page.getByRole("listitem", { name: "Contrato de servicios", exact: true });
  await expect(type).toBeVisible();
  // The delete button is there, but a type in use answers with a notice that offers deactivation instead.
  await type.getByRole("button", { name: "Eliminar Contrato de servicios", exact: true }).click();
  const notice = page.getByRole("alertdialog");
  await expect(notice.getByText(/Tipo de documento en uso|Document type in use/)).toBeVisible();
  await notice.getByRole("button", { name: /^(Desactivar|Deactivate)$/ }).click();
  await expect(type.getByRole("switch")).not.toBeChecked();
  await expect(type).toBeVisible();
});

// ───────────────────────────── HU-22 · portal ─────────────────────────────

test("HU-22 CA2 + headers: the portal lists only the link's documents, with view and download; the page is not indexed and holds no key", async ({
  page,
}) => {
  await asVisitor(page);
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));

  const response = await page.goto(`/s/${KAIROS_TOKEN}`);
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["cache-control"]).toContain("no-store");
  expect(await response?.text()).not.toContain(KAIROS_KEY);

  const list = page.getByRole("list", { name: /^(Documentos|Documents)$/ });
  await expect(list.getByRole("article")).toHaveCount(3);
  await expect(card(page, CONTRACT_TITLE)).toBeVisible();
  await expect(card(page, PRD_TITLE)).toBeVisible();
  await expect(card(page, KEYED_TITLE)).toBeVisible();
  await expect(page.getByText("Estado de cuenta — septiembre")).toHaveCount(0);
  await expect(
    card(page, CONTRACT_TITLE).getByRole("link", { name: /^(Descargar|Download)$/ }),
  ).toBeVisible();
  expect([...hosts].filter((host) => !/^localhost(:\d+)?$/.test(host))).toEqual([]);
});

test("HU-22 CA3/CA4: a changed character, a revoked and an expired token answer the same generic 404", async ({
  page,
}) => {
  await asVisitor(page);
  const changed = `${KAIROS_TOKEN.slice(0, -1)}${KAIROS_TOKEN.endsWith("A") ? "B" : "A"}`;
  for (const token of [changed, REVOKED_TOKEN, EXPIRED_TOKEN]) {
    const response = await page.goto(`/s/${token}`);
    expect(response?.status(), token).toBe(404);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    await expect(
      page.getByRole("heading", { name: /^(Enlace no disponible|Link not available)$/ }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/revocad|expirad|revoked|expired/i);
  }
});

test("HU-22 CA6: a link pinned to v2 keeps v2 after v4 is published; an always-latest document shows v4", async ({
  page,
}) => {
  await open(page, `/documents/${PRD_DOC}/editor`);
  await page.getByRole("button", { name: /^(Publicar versión v4|Publish version v4)$/ }).click();
  const publish = page.getByRole("dialog");
  await publish.getByRole("button", { name: /^(Publicar|Publish)$/ }).click();
  await expect(page.getByText(/Versión v4 publicada|Version v4 published/)).toBeVisible();

  await asVisitor(page);
  await page.goto(`/s/${KAIROS_TOKEN}`);
  await expect(card(page, CONTRACT_TITLE).getByText(/v2/)).toBeVisible();
  await expect(card(page, CONTRACT_TITLE).getByText(/v4/)).toHaveCount(0);
  await expect(card(page, PRD_TITLE).getByText(/v4/)).toBeVisible();
});

test("HU-22 key-protected document: no view or download before the right key, a wrong key is refused, the right key unlocks", async ({
  page,
}) => {
  const ip = await asVisitor(page);
  await page.goto(`/s/${KAIROS_TOKEN}`);
  const keyed = card(page, KEYED_TITLE);
  await expect(keyed.getByRole("button", { name: /^(Desbloquear|Unlock)$/ })).toBeVisible();
  await expect(keyed.getByRole("button", { name: /^(Ver|View)$/ })).toHaveCount(0);
  await expect(keyed.getByRole("link", { name: /^(Descargar|Download)$/ })).toHaveCount(0);

  const fileUrl = `/api/s/${KAIROS_TOKEN}/files/${KEYED_DOC}`;
  const headers = { "x-forwarded-for": ip };
  expect((await page.request.get(fileUrl, { headers, maxRedirects: 0 })).status()).toBe(403);
  expect(
    (await page.request.get(`${fileUrl}?download=1`, { headers, maxRedirects: 0 })).status(),
  ).toBe(403);

  await unlockWith(page, "KAIRO-WRONG-0000");
  await expect(
    page.getByText(/La clave de acceso no es correcta|The access key is not correct/),
  ).toBeVisible();
  expect((await page.request.get(fileUrl, { headers, maxRedirects: 0 })).status()).toBe(403);

  await page
    .getByRole("dialog")
    .getByLabel(/^(Clave de acceso|Access key)$/)
    .fill(KAIROS_KEY);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^(Desbloquear|Unlock)$/ })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(keyed.getByRole("button", { name: /^(Ver|View)$/ })).toBeVisible();
  // ENLACE documents answer with the external redirect once unlocked.
  expect((await page.request.get(fileUrl, { headers, maxRedirects: 0 })).status()).toBe(307);
});

test("HU-22 lockout: five wrong keys lock the document, and the right key is refused while locked", async ({
  page,
}) => {
  await asVisitor(page);
  await page.goto(`/s/${KAIROS_TOKEN}`);

  const wrongKeyMessage = page.getByText(
    /La clave de acceso no es correcta|The access key is not correct/,
  );
  const lockedMessage = page.getByText(/Demasiados intentos|Too many attempts/).first();
  const dialog = page.getByRole("dialog");

  // Attempts 1-4 answer the wrong-key error; each one is a server round trip (the key is posted, the dialog stays).
  await unlockWith(page, "KAIRO-WRONG-1000");
  await expect(wrongKeyMessage).toBeVisible();
  for (let attempt = 2; attempt <= 4; attempt += 1) {
    await submitKey(page, `KAIRO-WRONG-${attempt}000`);
    await expect(wrongKeyMessage).toBeVisible();
  }
  // Attempt 5 reaches the limit: the lockout state, the input disabled.
  await submitKey(page, "KAIRO-WRONG-5000");
  await expect(lockedMessage).toBeVisible();
  await expect(dialog.getByLabel(/^(Clave de acceso|Access key)$/)).toBeDisabled();

  // The lockout outlives the dialog: after a reload the right key is still refused.
  await page.reload();
  await unlockWith(page, KAIROS_KEY);
  await expect(lockedMessage).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^(Desbloquear|Unlock)$/ })).toBeDisabled();
});

test("HU-22 mobile layout: at 390 x 844 the portal has no horizontal scroll and the document list is visible", async ({
  page,
}) => {
  await asVisitor(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/s/${KAIROS_TOKEN}`);
  await expect(page.getByRole("list", { name: /^(Documentos|Documents)$/ })).toBeVisible();
  await expect(card(page, CONTRACT_TITLE)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("PDF toolbar: zoom, reset and fullscreen toggle on the portal viewer", async ({ page }) => {
  await asVisitor(page);
  await page.goto(`/s/${KAIROS_TOKEN}`);
  await card(page, CONTRACT_TITLE)
    .getByRole("button", { name: /^(Ver|View)$/ })
    .click();

  const toolbar = page.getByRole("toolbar", { name: /^(Controles del visor|Viewer controls)$/ });
  await expect(toolbar).toBeVisible();
  // The zoom value button is named "125 % , Restablecer zoom al 100 %": match the reset part of the name.
  const zoomReset = toolbar.getByRole("button", {
    name: /Restablecer zoom al 100 %|Reset zoom to 100 %/,
  });
  await toolbar.getByRole("button", { name: /^(Ampliar zoom|Zoom in)$/ }).click();
  await expect(zoomReset).toHaveText(/^125 %/);
  await zoomReset.click();
  await expect(zoomReset).toHaveText(/^100 %/);

  const fullscreen = toolbar.getByRole("button", { name: /^(Pantalla completa|Full screen)$/ });
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false");
  await fullscreen.click();
  await expect(fullscreen).toHaveAttribute("aria-pressed", "true");
  await fullscreen.click();
  await expect(fullscreen).toHaveAttribute("aria-pressed", "false");
});

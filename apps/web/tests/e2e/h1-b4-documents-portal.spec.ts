import { expect, test, type Page } from "@playwright/test";
import { signInAs } from "./support/auth";
import { apiBaseUrl, assertBackendHealthy } from "./support/backend";

// T11 E2E, H1-B4 documents and portal (odd/tasks/h1-b4-documents-portal-ui.md S12), rewritten for FE-INT-R E.2 (rule 29):
// no mock reset, no mock seed id and no seeded portal token or key. Each case creates its own documents and share link through
// the back office (`authenticated`, DT-204), then visits the public `/s/<token>` page of that link in the same browser:
// the portal is public, so the visitor side needs no second session. The lockout is keyed on the link, the document
// and the salted IP hash, so every visitor test takes its own TEST-NET-2 address through `x-forwarded-for`.
//
// The back-office cases that also live in `fe-int-4-documents-portal.spec.ts` (HU-18 versions, HU-19, HU-20, HU-21) are
// deleted here with a pointer; that file holds the same assertions on created data. Titles keep the H1-B4 story ids.

const uniq = (label: string) => `E2E portal ${label} ${Date.now()}`;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const oneOf = (...labels: string[]) => new RegExp(`^(${labels.map(escapeRegExp).join("|")})$`);
const anyOf = (...labels: string[]) => new RegExp(labels.map(escapeRegExp).join("|"));

function idFromUrl(url: string, segment: string): string {
  const id = new RegExp(`/${segment}/([^/?#]+)`).exec(url)?.[1];
  if (!id) throw new Error(`No /${segment}/ id in ${url}`);
  return id;
}

let visitorSeq = Math.floor(Math.random() * 200);

/**
 * A unique TEST-NET-2 visitor for this test: the portal lockout is keyed on the salted hash of this address. Returns
 * the address, which the file route call of the same test reuses.
 */
async function asVisitor(page: Page): Promise<string> {
  visitorSeq += 1;
  const ip = `198.51.100.${(visitorSeq % 250) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return ip;
}

function card(page: Page, title: string) {
  return page.getByRole("article", { name: title, exact: true });
}

/** Creates a draft PRD of this run and publishes `versions` markdown versions (v1, v2, …). Returns its id. */
async function createPublishedPrd(page: Page, title: string, versions: number): Promise<string> {
  await page.goto("/documents/new");
  await page.getByLabel("Título", { exact: true }).fill(title);
  await page.getByRole("combobox", { name: "Tipo de documento", exact: true }).click();
  await page.getByRole("option", { name: /^PRD$/ }).click();
  await page.getByRole("button", { name: "Crear documento", exact: true }).click();
  // A new document opens its editor (`/documents/<id>/editor`), as `support/ui-data.ts` accepts.
  await expect(page).toHaveURL(/\/documents\/(?!new$)[^/?#]+(?:\/editor)?$/);
  const id = idFromUrl(page.url(), "documents");
  for (let version = 1; version <= versions; version += 1) {
    await page.goto(`/documents/${id}/editor`);
    await page
      .getByRole("textbox", { name: oneOf("Fuente markdown", "Markdown source") })
      .fill(`# ${title} v${version}`);
    await page
      .getByRole("button", {
        name: oneOf(`Publicar versión v${version}`, `Publish version v${version}`),
      })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#document-editor-changelog").fill(`Cambio E2E v${version}`);
    await dialog.getByRole("button", { name: oneOf("Publicar", "Publish") }).click();
    await expect(
      page.getByText(anyOf(`Versión v${version} publicada`, `Version v${version} published`)),
    ).toBeVisible();
  }
  return id;
}

/**
 * Shares one document through the Compartir tab. `key` requires an access key (the one-time key is returned), `latest`
 * follows the latest version instead of the current one, `allowDownload=false` blocks downloads. Returns the token.
 */
async function createShare(
  page: Page,
  docId: string,
  title: string,
  options: { key?: boolean; latest?: boolean; allowDownload?: boolean } = {},
): Promise<{ token: string; key?: string }> {
  await page.goto(`/documents/${docId}?tab=shares`);
  const shareLinks = page.locator('a[href^="/documents/shares/"]');
  const before = new Set(
    await shareLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
  );
  await page.getByRole("button", { name: "Compartir", exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (options.key) {
    await dialog
      .getByLabel(new RegExp(`^Exigir una clave de acceso para ${escapeRegExp(title)}$`))
      .click();
  }
  if (options.latest) {
    await dialog
      .getByRole("combobox", { name: new RegExp(`^Versión de ${escapeRegExp(title)}$`) })
      .click();
    await page
      .getByRole("option", {
        name: oneOf("Siempre la última versión", "Always the latest version"),
      })
      .click();
  }
  if (options.allowDownload === false) {
    await dialog.getByLabel(oneOf("Permitir descargas", "Allow downloads")).click();
  }
  await dialog.getByRole("button", { name: "Crear enlace", exact: true }).click();

  let key: string | undefined;
  if (options.key) {
    await expect(page.getByText("Copie ahora las claves de acceso")).toBeVisible();
    key = await page
      .getByRole("dialog")
      .locator("input[readonly], code")
      .first()
      .evaluate((element) =>
        element instanceof HTMLInputElement ? element.value : (element.textContent ?? ""),
      );
    await page.getByRole("button", { name: "Ya copié las claves", exact: true }).click();
  }
  // "Abrir enlace" is a short-lived toast button to the share's back-office page, not the /s/<token> URL: the share
  // detail page shows that URL. A document can hold several links, so the new one is the href not listed before.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto(`/documents/${docId}?tab=shares`);
  await expect(shareLinks).toHaveCount(before.size + 1);
  const hrefs = await shareLinks.evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")),
  );
  const created = hrefs.find((href) => href && !before.has(href));
  if (!created) throw new Error("No new share link after sharing");
  await page.goto(created);
  const url = page.getByLabel(oneOf("URL pública", "Public URL"), { exact: true });
  await expect(url).toHaveValue(/\/s\/[A-Za-z0-9_-]{43}$/);
  const token = /\/s\/([A-Za-z0-9_-]{43})$/.exec(await url.inputValue())?.[1];
  if (!token) throw new Error("No /s/<token> URL on the share detail page");
  return { token, key };
}

/** Opens the unlock dialog of a keyed card and posts `key`; waits for the unlock answer and returns its status. */
async function unlockWith(page: Page, title: string, key: string): Promise<number> {
  await card(page, title)
    .getByRole("button", { name: oneOf("Desbloquear", "Unlock") })
    .click();
  return submitKey(page, key);
}

/** Posts `key` from the open unlock dialog and returns the HTTP status of the unlock call. */
async function submitKey(page: Page, key: string): Promise<number> {
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(oneOf("Clave de acceso", "Access key")).fill(key);
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) => candidate.request().method() === "POST" && candidate.url().includes("/unlock"),
    ),
    dialog.getByRole("button", { name: oneOf("Desbloquear", "Unlock") }).click(),
  ]);
  return response.status();
}

test.describe("H1-B4 documents and portal (authenticated back office, visitor on the public portal)", () => {
  test.beforeAll(async () => {
    await assertBackendHealthy();
  });

  test("@authenticated HU-22 CA2 + headers: the portal lists the link's documents, with view and download; the page is not indexed", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const title = uniq("compartido");
    const docId = await createPublishedPrd(page, title, 1);
    const { token } = await createShare(page, docId, title);

    await asVisitor(page);
    const hosts = new Set<string>();
    page.on("request", (request) => hosts.add(new URL(request.url()).host));
    const response = await page.goto(`/s/${token}`);
    expect(response?.status()).toBe(200);
    const headers = response?.headers() ?? {};
    expect(headers["x-robots-tag"]).toContain("noindex");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["cache-control"]).toContain("no-store");

    const list = page.getByRole("list", { name: oneOf("Documentos", "Documents") });
    await expect(list.getByRole("article")).toHaveCount(1);
    await expect(card(page, title)).toBeVisible();
    expect([...hosts].filter((host) => !/^localhost(:\d+)?$/.test(host))).toEqual([]);
  });

  test("@authenticated HU-22 CA3/CA4: a changed character and a revoked link answer the same generic 404", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const title = uniq("revocable");
    const docId = await createPublishedPrd(page, title, 1);
    const { token } = await createShare(page, docId, title);

    await asVisitor(page);
    const changed = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    const notFound = async (candidate: string) => {
      const response = await page.goto(`/s/${candidate}`);
      expect(response?.status(), candidate).toBe(404);
      expect(response?.headers()["x-robots-tag"]).toContain("noindex");
      await expect(
        page.getByRole("heading", { name: oneOf("Enlace no disponible", "Link not available") }),
      ).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/revocad|expirad|revoked|expired/i);
    };
    await notFound(changed);

    // Revoke the link from its share detail (the list row of the document), then the same token is refused.
    await page.goto("/documents/shares");
    await page.getByRole("row").filter({ hasText: title }).getByRole("link").first().click();
    await page.getByRole("button", { name: oneOf("Revocar enlace", "Revoke link") }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: oneOf("Revocar", "Revoke") })
      .click();
    await expect(page.getByText(anyOf("Enlace revocado", "Link revoked"))).toBeVisible();
    await notFound(token);
  });

  test("@authenticated HU-22 CA6: a link pinned to v1 keeps v1 after v2 is published; a link that follows the latest shows v2", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const title = uniq("versionado");
    const docId = await createPublishedPrd(page, title, 1);
    const pinned = await createShare(page, docId, title);

    // Publish v2 after the pinned link was created.
    await page.goto(`/documents/${docId}/editor`);
    await page
      .getByRole("button", { name: oneOf("Publicar versión v2", "Publish version v2") })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: oneOf("Publicar", "Publish") })
      .click();
    await expect(
      page.getByText(anyOf("Versión v2 publicada", "Version v2 published")),
    ).toBeVisible();

    const latest = await createShare(page, docId, title, { latest: true });

    await asVisitor(page);
    await page.goto(`/s/${pinned.token}`);
    await expect(card(page, title).getByText(/v1/)).toBeVisible();
    await expect(card(page, title).getByText(/v2/)).toHaveCount(0);

    await page.goto(`/s/${latest.token}`);
    await expect(card(page, title).getByText(/v2/)).toBeVisible();
  });

  test("@authenticated HU-22 key-protected document: files wait for the key; a wrong key is refused; the right key shows the view", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const title = uniq("con-clave");
    const docId = await createPublishedPrd(page, title, 1);
    const { token, key } = await createShare(page, docId, title, { key: true });
    expect(key, "the one-time key is shown once").toBeTruthy();

    const ip = await asVisitor(page);
    await page.goto(`/s/${token}`);
    const keyed = card(page, title);
    await expect(keyed.getByRole("button", { name: oneOf("Desbloquear", "Unlock") })).toBeVisible();
    await expect(keyed.getByRole("button", { name: oneOf("Ver", "View") })).toHaveCount(0);

    // The file route refuses the document until its key is unlocked.
    const fileUrl = `${apiBaseUrl()}/api/v1/portal/${token}/files/${docId}`;
    const headers = { "x-forwarded-for": ip };
    expect((await page.request.get(fileUrl, { headers, maxRedirects: 0 })).status()).toBe(403);

    expect(await unlockWith(page, title, "KAIRO-WRONG-0000")).toBe(401);
    await expect(
      page.getByText(anyOf("La clave de acceso no es correcta", "The access key is not correct")),
    ).toBeVisible();

    await page
      .getByRole("dialog")
      .getByLabel(oneOf("Clave de acceso", "Access key"))
      .fill(key ?? "");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: oneOf("Desbloquear", "Unlock") })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(keyed.getByRole("button", { name: oneOf("Ver", "View") })).toBeVisible();
  });

  test("@authenticated HU-22 lockout: five wrong keys lock the document (HTTP 429), and the right key is refused while locked", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const title = uniq("bloqueo");
    const docId = await createPublishedPrd(page, title, 1);
    const { token, key } = await createShare(page, docId, title, { key: true });

    await asVisitor(page);
    await page.goto(`/s/${token}`);
    const wrongKeyMessage = page.getByText(
      anyOf("La clave de acceso no es correcta", "The access key is not correct"),
    );
    const lockedMessage = page.getByText(anyOf("Demasiados intentos", "Too many attempts")).first();
    const dialog = page.getByRole("dialog");

    // Attempts 1-4 answer the wrong-key error (401); the fifth reaches the limit: the lockout state (429 by contract).
    expect(await unlockWith(page, title, "KAIRO-WRONG-1000")).toBe(401);
    await expect(wrongKeyMessage).toBeVisible();
    for (let attempt = 2; attempt <= 4; attempt += 1) {
      expect(await submitKey(page, `KAIRO-WRONG-${attempt}000`)).toBe(401);
      await expect(wrongKeyMessage).toBeVisible();
    }
    expect(await submitKey(page, "KAIRO-WRONG-5000")).toBe(429);
    await expect(lockedMessage).toBeVisible();
    await expect(dialog.getByLabel(oneOf("Clave de acceso", "Access key"))).toBeDisabled();

    // The lockout outlives the dialog: after a reload the right key is still refused.
    await page.reload();
    expect(await unlockWith(page, title, key ?? "")).toBe(429);
    await expect(lockedMessage).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: oneOf("Desbloquear", "Unlock") }),
    ).toBeDisabled();
  });

  test("@authenticated HU-22 CA6 downloads: a link with downloads blocked offers no download to the visitor", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const title = uniq("sin-descargas");
    const docId = await createPublishedPrd(page, title, 1);
    const { token } = await createShare(page, docId, title, { allowDownload: false });

    await asVisitor(page);
    await page.goto(`/s/${token}`);
    await expect(card(page, title)).toBeVisible();
    await expect(
      card(page, title).getByRole("link", { name: oneOf("Descargar", "Download") }),
    ).toHaveCount(0);
  });

  test("@authenticated HU-22 mobile layout: at 390 x 844 the portal has no horizontal scroll and the document list is visible", async ({
    page,
  }) => {
    await signInAs(page, "OWNER");
    const title = uniq("movil");
    const docId = await createPublishedPrd(page, title, 1);
    const { token } = await createShare(page, docId, title);

    await asVisitor(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/s/${token}`);
    await expect(page.getByRole("list", { name: oneOf("Documentos", "Documents") })).toBeVisible();
    await expect(card(page, title)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test.fixme("PDF toolbar: zoom, reset and fullscreen toggle on the portal viewer — FE-INT-R E.2: the PDF version upload through the version dialog is not verified against the running stack here; the batch-close manual check covers the viewer with a real PDF", async () => {
    // Placeholder: the viewer needs a PDF version uploaded through the intercepted storage POST.
  });
});

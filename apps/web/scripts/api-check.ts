// Fails when src/lib/api/schema.d.ts differs from what `openapi-typescript` generates from the committed
// src/lib/api/openapi.json (the BE contract copy). CI has no be/, so this never reads ../be.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const contract = join(root, "src/lib/api/openapi.json");
const committed = join(root, "src/lib/api/schema.d.ts");

const tmp = mkdtempSync(join(tmpdir(), "api-check-"));
try {
  const generated = join(tmp, "schema.d.ts");
  const run = spawnSync("bun", ["x", "openapi-typescript", contract, "-o", generated], {
    cwd: root,
    encoding: "utf8",
  });
  if (run.status !== 0) {
    process.stderr.write(run.stdout + run.stderr);
    console.error("api:check: openapi-typescript failed.");
    process.exit(1);
  }
  if (readFileSync(generated, "utf8") !== readFileSync(committed, "utf8")) {
    console.error(
      "api:check: src/lib/api/schema.d.ts is stale or edited by hand. Run `bun run api:gen` and commit it.",
    );
    process.exit(1);
  }
  console.log("api:check: schema.d.ts is up to date.");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

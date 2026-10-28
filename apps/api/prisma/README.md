# prisma/ — rules for every owner of this folder

- Schema = PRD §10.2 + the approved deltas of `docs/rules/data-rules.md` §3a–§3b. Anything else is a PRD change.
- Never edit a migration that is already on `main`; a fix is a new migration.
- **Always** create migrations with `prisma migrate dev --create-only --name <name>` against your own local
  podman Postgres, review the SQL, then apply it. Never `migrate deploy` / `db push` outside CI or the user.
- The complementary SQL (`*_complementary_sql`) holds what Prisma cannot express: CHECKs, partial and `INCLUDE`
  indexes, the generated `SearchEntry.search` column, its GIN indexes, the `es_unaccent` configuration and the
  `account_ledger_v` view. It lives only in that migration folder (`prisma/sql/` is reserved for TypedSQL).
- Every `migrate` command needs `DIRECT_URL` (and the seed needs `DATABASE_URL`). `prisma generate` alone runs
  without it (`prisma/config-helpers.ts` detects the `generate` subcommand), so a fresh clone can generate.

## Drift procedure

Prisma does not see the generated column nor the `INCLUDE` index, so every auto-generated migration will try to
drop them. Procedure for every later owner:

1. Create a shadow database next to your own container (`CREATE DATABASE shadow;`).
2. Run
   `SHADOW_DATABASE_URL=postgresql://postgres:dev@localhost:<port>/shadow prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`
   (`prisma.config.ts` reads the optional `SHADOW_DATABASE_URL`).
3. The only residual statements expected (verified when the history was created) are:

   ```sql
   DROP INDEX "invline_project_cover";
   DROP INDEX "search_entry_fts";
   DROP INDEX "search_entry_trgm";
   ALTER TABLE "SearchEntry" DROP COLUMN "search";
   ```

   Partial indexes, CHECKs and the view are ignored by Prisma and do not appear.

4. When creating a new migration (`--create-only`), **strip those statements** from the generated SQL, review the
   rest, then apply. If the only clean fix would be a schema annotation (`Unsupported` / `dbgenerated`), do not add
   it: stop and report (PRD change).
5. An interactive `prisma migrate dev` that asks for a migration name right after applying the history is showing
   exactly this expected drift; answer by using `--create-only` as above, never by accepting the drops.

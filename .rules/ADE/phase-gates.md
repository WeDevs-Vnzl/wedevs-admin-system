# Phase control and human approval (mandatory)

Referenced from `orca-workflow.md` § "Batch cycle". These are standing
process rules for this project, not a response to a prior incident. They
take priority over any other section of `orca-workflow.md` if they
conflict.

1. **No worker coexistence across phases.** The Planner must finish
   (`worker_done` + `worker-release`) before any Developer is dispatched;
   all Developers must finish (`worker_done` + `worker-release`) before the
   **Code Reviewer** is dispatched; the Code Reviewer must finish
   (`worker_done` + `worker-release`) before the Tester is dispatched. Two
   phases never have active workers at the same time. The Code Reviewer
   only reviews the wave's already-integrated branch (all packages merged),
   not loose per-package worktrees — integration incoherence is only
   visible once everything is merged.
2. **Release workers on completion.** Any worker reporting `worker_done` is
   released immediately (`worker-release`), unless the user explicitly asks
   to keep it or wait for further instructions on it. A worker terminal
   that is kept or reused instead gets `/compact` first (the Orchestrator
   sends it with `orca terminal send`), so context never piles up across
   tasks. Once a package is integrated into the base branch and its worker
   released, the Orchestrator removes its worktree and branch
   (`orca worktree rm --worktree path:<path>`); a worktree never outlives
   its usefulness.
3. **The plan requires explicit approval before execution.** The Planner
   delivers its plan to the Orchestrator (root), and the Orchestrator
   presents it to the user. **The Orchestrator never creates Developer or
   Tester workers without the user explicitly approving the plan first.**
   Batch 0 (rules) also needs the user's explicit approval of the
   `.rules/*` files before any phase batch opens.
4. **The Tester requires a separate explicit confirmation.** Even with the
   Planner's coherence review green and the Code Reviewer reporting
   `READY FOR TESTING`, the Tester is not dispatched until the user
   confirms explicitly. A `BLOCKED` from the Code Reviewer is not resolved
   by the Orchestrator alone: it goes back to the Developer of the affected
   package or escalates to the Planner depending on the nature of the
   finding.
5. **All work flows back to the batch's base branch.** Each batch works on
   its own base branch created from `main` (`batch/<scope>-<topic>`, e.g.
   `batch/f0-foundations` or `batch/fix-<topic>`). Every package is
   integrated into that branch before the review and testing phases;
   **tests run from the base branch already carrying the integrated
   changes**, not scattered across each package's isolated worktrees. The
   base branch reaches `main` only through a PR; pushing it and opening the
   PR is done by the user or with the user's explicit approval. **No agent
   merges to `main`.**
6. **Retry a phase only with the user's explicit confirmation.** The
   Orchestrator does not repeat the Planner, a Developer, or the Tester on
   its own; it proposes the retry and waits for confirmation.
7. **No agent infers or substitutes on its own.** If the agent or model
   assigned by the Planner is not available in the environment, the
   Orchestrator stops and asks the user how to proceed — never silently
   substitutes another agent/model/skill.
8. **The plan always declares the agent and model per package, explicitly
   and verifiably.** For every package it proposes, the Planner must
   deliver a dedicated line with the minimum format
   `Package <id> → Agent: <agent> · <exact model> — Reason: <one line>`
   (mentioning it within the analysis prose is not enough). This applies to
   the plan's first delivery and to any later revision. The Orchestrator
   **rejects and sends back to the Planner** any plan that doesn't include
   that line per package before presenting it to the user for approval — it
   never fills in the missing model on its own (see rule 7).
9. **Schema changes only in `prisma/`, only against local databases.**
   A schema change is its own package with `prisma/` as its only owner in
   that wave. Workers run `prisma migrate dev` only against their own local
   podman Postgres. A migration already on `main` is never edited; a fix is
   a new migration. **No agent migrates, seeds or queries a non-local
   database**, and no agent calls the real Neon, Clerk, bucket or Netlify
   APIs.
10. **One owner per shared file per wave.** Only one package per wave may
    change dependencies (`package.json` + lockfile), only one may change
    `prisma/schema.prisma`, and only one may change each shared file
    listed in `orca-workflow.md` § "Repo topology" (i18n messages, the
    `(app)` layout, `proxy.ts`, shared validators). The Planner
    declares that owner in `TASK.md`.
11. **Secrets belong to the human.** Real credentials (`CLERK_*`,
    `CLERK_WEBHOOK_SECRET`, `STORAGE_*`, `SHARE_IP_SALT`, `SENTRY_DSN`,
    Neon URLs) are placed by the user in `.env.local` or in CI/Netlify
    settings. No agent reads, prints, copies or commits them. Workers use
    only local values (the podman `DATABASE_URL`, mocked auth, a local S3
    container) and mark mock data as MOCK.
12. **No Claude attribution.** No commit message, PR description or file
    carries a Claude signature (`Co-Authored-By: Claude …`, "Generated with
    Claude Code"). Every task spec says so. Before integrating a package,
    the Orchestrator checks its commits
    (`git log --format=%B <base>..<branch> | grep -i claude`); if one is
    found, the message is rewritten to remove it before the merge.

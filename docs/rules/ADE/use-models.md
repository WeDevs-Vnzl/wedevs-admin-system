# Model usage per agent (Orca)

Actual syntax to set **model** and **effort/reasoning** when launching each agent from the terminal. Complements `docs/orca-workflow.md` § "Roles and models" (which model belongs to which role): this is the *how* to pass it to the CLI.

In this project every role is a Claude Code agent defined in `.claude/agents/wedevs-*.md`. Its frontmatter `model` is the default, and the Planner's per-package line (`phase-gates.md` rule 8) is what the Orchestrator actually passes with `--model`/`--effort`.

## Model tiers

| Tier | Who | Used for |
|---|---|---|
| `haiku` (default) | `wedevs-developer`, `wedevs-tester` | shadcn components and screens over the existing kit, CRUD of configurable catalogs, i18n messages, read-only reports, graph UI over an existing contract, tests, adaptations of a known pattern |
| `sonnet` (critical packages, set by the Planner per package) | `wedevs-developer`; also the Project Manager | `prisma/` (schema, migrations, SQL); auth, `can()`, Clerk webhook; `proxy.ts` and CSP; money (`lib/money`, `lib/rates`, invoices, payments and allocations, accounts, billing, expenses); public portal and share tokens; storage and presigned URLs; scheduled jobs; CI; any change to a shared service signature or validator |
| `opus` | **Only** `wedevs-planner` and `wedevs-code-reviewer` | Planning and the wave-close review gate |

- Never `opus` for a developer or the Tester. A borderline package gets `sonnet`, with the reason in the package line; it never goes above `sonnet` for a developer.
- The model is always written per package (`Package <id> → Agent: <agent> · <model> — Reason: …`), never implied.
- The Orchestrator does not change the model on its own. If the declared model is unavailable, it stops and asks (`phase-gates.md` rule 7).

## Two paths in Orca

- **Native** (`claude`, `codex`, Cursor ids): Orca supports `--model`/`--effort` directly on its own command:
  ```
  orca orchestration worker-start --task <id> --worktree <selector> \
    --agent claude --model <id> --effort <level>
  ```
  `--effort` requires `--model`; neither combines with `--terminal`.

- **Non-native** (`opencode`, `antigravity`): not an Orca `--agent`. Launched as a shell command, with model/effort set by that CLI's own flags inside `--command`:
  ```
  orca terminal create --worktree <selector> --command "<cli> ...flags..." --focus
  ```

Using anything other than Claude Code requires the Planner to name it explicitly in the package line.

## claude (Claude Code)

- Model: `--model <id>` (aliases `haiku`, `sonnet`, `opus` work).
- Effort: `--effort <low|medium|high|xhigh|max>`.

```
claude --model sonnet --effort high "task..."
```

## codex

- Model: `-m/--model <id>`.
- Effort: not a CLI flag. Use `-c model_reasoning_effort="<level>"`, or `~/.codex/config.toml` (`model_reasoning_effort`). Values: `none, minimal, low, medium, high, xhigh` (varies by model).

## opencode

- Model: `-m/--model <provider/model>` on `opencode run`.
- Effort: no CLI flag; configure `reasoningEffort` per model/variant in `opencode.json`.

## antigravity (`agy`)

- Model: `--model <id>`; effort: `--effort <low|medium|high>`. Several model ids already carry the effort in their name, so test before assuming which wins.

## Quick summary

| Agent | Model flag | Effort flag | Effort via config file |
|---|---|---|---|
| claude | `--model` | `--effort` | — |
| codex | `-m/--model` | — (`-c model_reasoning_effort=...`) | `~/.codex/config.toml` |
| opencode | `-m/--model` | — | `opencode.json` |
| antigravity (`agy`) | `--model` | `--effort` | — |

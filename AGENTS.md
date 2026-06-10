# AGENTS.md

This file provides context to AI coding agents working in this
repository. It follows the [agents.md](https://agents.md/) convention so
any tool — Cursor, Codex, Aider, Continue, Claude Code — can use it.

## Project

**OniCode** — a TypeScript CLI agentic AI coding tool with React Ink TUI,
multi-provider LLM abstraction, MCP client integration, hierarchical
agent coordination, skill-based prompts, and JSONL session transcripts.

Modeled on Claude Code's architecture; designed to consume MCP servers
and be embeddable as a library.

## Status

**v0.1 — Headless agent loop.** See `.claude/plans/snappy-dreaming-papert.md`
for the full multi-version roadmap.

Implemented in v0.1:
- Anthropic provider adapter
- 6 built-in tools: Read, Write, Edit, Bash, Glob, Grep
- Permission gate with 4 modes + allow/deny rules
- JSONL session writer/reader/manager
- Headless `run` subcommand

## Dev Setup

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...
pnpm build
node dist/cli.js --help
```

Requires Node 20+ and pnpm. The repo is ESM (`"type": "module"`); use
`.js` extensions in import specifiers (TypeScript NodeNext convention).

## Commands

| Task | Command |
|------|---------|
| Type check | `pnpm typecheck` |
| Build dist | `pnpm build` |
| Watch build | `pnpm dev` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| Test | `pnpm test` |
| Coverage | `pnpm test:coverage` |
| Run CLI | `node dist/cli.js run -p "..."` |

After every meaningful change run `pnpm typecheck && pnpm build`.

## Architecture

```
LLM ↔ Provider ↔ Agent Loop ↔ Tool Executor ↔ Permission Gate ↔ Tool
                          ↓                                       ↓
                      Coordinator                            Session JSONL
                          ↓
                     Sub-Agents (each with isolated context)
```

Module boundaries:

- **`src/cli/`** — process entry, arg parsing, subcommand dispatch.
- **`src/core/agent/`** — single-context agent loop; one instance per
  context window.
- **`src/core/coordinator/`** — supervisor pattern (v0.3+).
- **`src/core/tools/`** — tool registry, executor, error types. The
  executor is the **only** place tools are invoked.
- **`src/core/permissions/`** — pure decision function. No side effects.
- **`src/core/session/`** — JSONL writer/reader/manager.
- **`src/core/skills/`** — SKILL.md discovery (v0.3+).
- **`src/core/mcp/`** — MCP client (v0.4+).
- **`src/providers/`** — LLM abstraction + per-provider adapters.
- **`src/tools/builtin/`** — concrete tool implementations.
- **`src/config/`** — zod schema + defaults + loader.
- **`src/utils/`** — shared helpers (logger, idgen, paths, retry, etc).
- **`src/tui/`** — React Ink components (v0.2+).

## Conventions

### Language

All identifiers, comments, JSDoc, prose, and commit messages in
**English** regardless of contributor language. Hard rule.

### TypeScript

- **`strict` everywhere** plus `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess`.
- **No `any`.** Use `unknown` + zod validation at boundaries.
- **`import type` for type-only imports** (enforced by ESLint).
- **TSDoc on every exported symbol.** Module-level docstring at the top
  of every file.

### Errors

Use `ToolError` subclasses for tool failures:
- `ToolValidationError` — input failed schema check.
- `ToolPermissionError` — gate denied execution.
- `ToolExecutionError` — tool ran and failed.
- `ToolAbortedError` — cancelled via signal.
- `ToolNotFoundError` — tool not in registry.

The executor catches all of these and converts to structured
`ToolErrorPayload`. Tool code throws; never returns error sentinels.

### Output Channels

- **stdout** — assistant text streamed to the user (headless mode).
- **stderr** — structured JSONL logs from `createLogger(...)`.
- Tools never write to stdout/stderr directly; always go through
  `ToolExecCtx.log`.

### Path Handling

Always use `src/utils/pathUtils.ts` helpers (`expandHome`,
`resolveAgainst`, `userRootDir`, etc). Windows quirks live there.

### Permission Rules

Format: `ToolName(input-pattern)`. Glob by default; regex with `re:`
prefix. Tool name `*` matches any tool.

```jsonc
{
  "permissions": {
    "mode": "default",
    "allow": ["Read(**)", "Glob(**)", "Grep(**)", "Bash(re:^npm\\stest)"],
    "deny": ["Write(/etc/**)", "Bash(re:rm\\s-rf)"]
  }
}
```

## Adding a New Tool

1. Create `src/tools/builtin/<name>.ts`.
2. Define a zod schema for input. Surface failures as
   `ToolValidationError`.
3. Export a `Tool<I, O>` const with:
   - `name` — stable, unique.
   - `description` — one paragraph; surfaced verbatim to the LLM.
   - `inputSchema` — JSON Schema (Draft-07).
   - `destructive` — true iff mutates disk / external state.
   - `source: "builtin"`.
   - `summarize(input)` — single-line preview.
   - `execute(input, ctx)` — main work; respect `ctx.signal`.
4. Register in `buildBuiltinRegistry()` (`src/cli/commands/run.ts`).
5. Add tests in `tests/unit/tools/<name>.test.ts`.

## Adding a New Provider

1. Create `src/providers/<id>/{provider,mapper}.ts`.
2. `mapper.ts` exports pure conversion functions.
3. `provider.ts` exports a class implementing `LLMProvider`.
4. Add the case to `createProvider` in `src/providers/registry.ts`.
5. Extend `ProviderIdSchema` in `src/config/schema.ts` and `ProviderId`
   in `src/config/types.ts`.

## Anti-Patterns

- **Do not bypass the executor.** Tools never call other tools directly.
- **Do not embed API keys in config files.** Always reference by env-var
  name (`apiKeyEnv: "ANTHROPIC_API_KEY"`).
- **Do not deep-import.** Library consumers import from `onicode`; the
  re-export surface is `src/index.ts`.
- **Do not add features beyond the current milestone.** v0.1 ships only
  what the plan lists.
- **Do not introduce `any` to silence the compiler.** Reach for `unknown`
  + a type guard, or zod, or a refined type.

## Testing Strategy

- **Unit** (`tests/unit/`) — pure functions and small classes. Mock
  providers and filesystem at the boundary.
- **Integration** (`tests/integration/`) — agent loop driven by a
  mock provider against a real tool registry on a tmp directory.
- Coverage target ≥ 80% for `src/core/**` and `src/config/**`.

## Plan Files

The implementation plan is stored at
`.claude/plans/snappy-dreaming-papert.md`. It contains:
- Locked architectural decisions.
- Module boundaries and key TypeScript interfaces.
- Data flow for one user turn.
- MVP slice (v0.1) and future milestones.
- Verification steps per milestone.

Refer to the plan when expanding features or onboarding into a new area.

## License

MIT.

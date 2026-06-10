# CLAUDE.md — OniCode Project Context

This file is loaded automatically by Claude Code at session start. It
gives an LLM working in this repository the project-specific context it
needs to be effective from the first message.

## What is OniCode?

OniCode is a TypeScript CLI agentic AI coding tool, modeled on Claude
Code's own architecture. Single-binary; React Ink TUI; multi-provider
LLM abstraction; MCP client; hierarchical agent coordination; skills as
SKILL.md files; mode-based permission gate; JSONL session transcripts.

## Status

**v0.4 — MCP client.** Implemented on top of v0.3:

- `McpManager` — orchestrates MCP server lifecycle: spawns child processes
  via `@modelcontextprotocol/sdk` stdio transport, connects, discovers
  tools, and tears down with SIGTERM→SIGKILL on shutdown.
- `adaptMcpTool()` — converts MCP SDK tool definitions into OniCode
  `Tool<unknown, unknown>` instances. Namespaced as
  `mcp:<serverName>:<toolName>`. All MCP tools default to
  `destructive: true` to go through the permission gate.
- Tool registry merge — MCP tools registered into the same `ToolRegistry`
  as builtins before coordinator construction. Sub-agents get MCP access
  automatically via `compileSkill()` filtering.
- Config — `mcpServers` in `OnicodeConfigSchema` maps server nicknames to
  `{ command, args, env? }` launch specs. Empty by default.
- Wired into both `chat` and `run` commands. `McpManager.shutdown()`
  called in `finally` blocks for clean teardown.
- Smoke test — `echo-mcp-server.cjs` fixture verifies full pipeline:
  spawn → connect → listTools → adaptMcpTool → execute → shutdown.

**v0.3 — Coordinator + skills.** Implemented on top of v0.2:

- `Coordinator` — supervisor layer owning top-level agent and sub-agent
  spawning. Enforces concurrency limits via `TaskQueue` (bounded
  semaphore). Emits lifecycle events for TUI and session writer.
- `SkillRegistry` — name-keyed catalog of skills from three scopes:
  builtin (`<install>/skills/`), user (`~/.onicode/skills/`), project
  (`<cwd>/.onicode/skills/`). Later scopes override earlier.
- `loadSkills()` — discovers `*.skill.md` files via `fastGlob`, parses
  YAML frontmatter (zod-validated), normalizes `allowedTools` (array or
  comma-string). Tolerates YAML `null` (from `~`) via `.optional().nullable()`.
- `compileSkill()` — translates `Skill` + parent context into
  `{ config: AgentConfig, registry: ToolRegistry }`. Pure; no I/O.
- `AgentSpawn` tool — bridge tool that calls `coordinator.spawn(spec)`.
  Constructed per-agent with `parentId` baked in. Registered dynamically
  after coordinator construction.
- `skills` subcommand — lists discovered skills or inspects one by name.
  Diagnostic tool; does not spawn agents.
- 4 bundled skills: `explorer` (read-only), `planner` (read-only),
  `implementer` (full toolset), `reviewer` (read-only + Bash for checks).
- Wired into `chat` and `run` commands. Both load skills, construct
  coordinator, register `AgentSpawn` tool before agent loop starts.

**v0.2 — TUI + slash commands.** Implemented on top of v0.1:

- React Ink 5 chat TUI: `MessageList`, `ChatInput`, `StatusBar`,
  `PermissionPrompt`, `ToolStatus`. Built with `useInput` (no
  `ink-text-input` dependency).
- `TuiController` — external store driving the view via
  `useSyncExternalStore`. Owns chat state, history, activity, pending
  permission prompts, and accumulated token usage.
- Slash commands: `/help`, `/exit` (`/quit` `/q`), `/mode`, `/tools`,
  `/session`, `/clear`. Live in `src/tui/slashCommands.ts`.
- Interactive permission prompts: `y` allow once, `a` allow always
  (installs runtime allow rule), `n` / `Esc` deny.
- Ctrl+C cancels in-flight turns; idle Ctrl+C exits cleanly.
- `chat` subcommand wired in `src/cli/commands/chat.ts`. Default
  `onicode` invocation drops into the TUI.

**v0.1 — Headless agent loop.** Already shipped:

- Anthropic provider (`@anthropic-ai/sdk` 0.65+).
- 6 built-in tools: Read, Write, Edit, Bash, Glob, Grep.
- Permission gate: `default | acceptEdits | plan | bypassPermissions` +
  per-tool allow/deny rules.
- JSONL session writer/reader/manager.
- Headless `run` subcommand: `onicode run -p "..."`.

Roadmap (see `.claude/plans/snappy-dreaming-papert.md`):

- v0.5 OpenAI + Ollama providers.
- v0.6 Web tools, task tools, session resume.

## Stack

- TypeScript strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`.
- Node 20+, ESM modules (`"type": "module"`).
- React Ink 5 (TUI).
- Zod (schema validation).
- tsup (bundler), vitest (test), eslint + prettier (lint/format).
- pnpm package manager.

## Repository Layout

```
src/
├── cli/                  Entrypoint, arg parsing, subcommand dispatch (`run`, `chat`).
├── tui/                  React Ink TUI: `App.tsx`, `controller.ts`,
│   ├── components/       `ChatInput`, `MessageList`, `Message`, `StatusBar`,
│   │                     `PermissionPrompt`, `ToolStatus`.
│   ├── hooks/            `useTuiStore` (binds `useSyncExternalStore` to controller).
│   ├── slashCommands.ts  Registry of `/help` `/exit` `/mode` `/tools` `/session` `/clear`.
│   └── types.ts          `ChatMessageView`, `AgentActivity`, `PendingPermission`.
├── core/
│   ├── agent/            Single-context agent loop (send → stream → tool dispatch → recurse).
│   ├── coordinator/      Supervisor: `Coordinator`, `TaskQueue`, `resultAggregator`, `types`.
│   ├── tools/            Tool registry + executor + error types.
│   ├── skills/           `SkillRegistry`, `loadSkills`, `compileSkill`, `schema`, `types`.
│   ├── permissions/      Mode-based gate + glob/regex rule matcher.
│   ├── session/          JSONL transcript writer/reader/manager.
│   └── mcp/              `McpManager` (server lifecycle), `adaptMcpTool` (adapter).
├── providers/            LLM provider abstraction + adapters.
│   └── anthropic/        Anthropic SDK adapter (mapper + provider).
├── tools/builtin/        Read, Write, Edit, Bash, Glob, Grep, AgentSpawn.
├── config/               Zod schema + defaults + loader.
├── utils/                Logger, idgen, paths, retry, frontmatter, token estimate.
└── index.ts              Library entry — re-exports stable surface.
```

## TUI Architecture (v0.2)

- **Controller-store pattern.** `TuiController` owns chat state outside
  React. Components subscribe via `useSyncExternalStore` so streaming
  token deltas do not race the renderer.
- **No third-party text input.** `ChatInput` uses Ink's `useInput` with a
  manual buffer + cursor + history. Avoids the abandoned
  `ink-text-input` package.
- **Permission flow.** The executor's `PromptHandler` is implemented by
  the controller: it pushes a `PendingPermission` into state, awaits the
  user's keystroke, and resolves the promise. `allow_always` installs a
  runtime allow rule into the shared `PermissionContext` (escaped glob
  on the exact summary so the rule matches only that input).
- **Activity bar.** `idle | thinking | running_tool | awaiting_permission`
  drives the bottom status line. The same enum colors `StatusBar`'s mode
  badge.
- **Cancel vs exit.** Ctrl+C cancels the in-flight turn while busy and
  exits when idle. Ink's built-in Ctrl+C handler is disabled
  (`exitOnCtrlC: false`) so the controller can intercept.

## Build & Verify

```bash
pnpm install         # First-time deps
pnpm typecheck       # tsc --noEmit
pnpm build           # tsup → dist/cli.js + dist/index.js
pnpm test            # vitest run
pnpm lint            # eslint src/
node dist/cli.js --help
```

After every meaningful change, run `pnpm typecheck && pnpm build` to
ensure the project still compiles. Strict mode catches most issues at
compile time.

## Coordinator Architecture (v0.3)

- **Supervisor pattern.** The coordinator owns the top-level agent and
  spawns sub-agents on demand. Sub-agents run with their own context
  window, system prompt (compiled from a skill), and optionally restricted
  tool registry.
- **Concurrency control.** `TaskQueue` is a bounded semaphore capping
  parallel sub-agents at `config.coordinator.maxConcurrentSubAgents`
  (default 3). New spawns wait FIFO until a slot opens.
- **Skill resolution chain.** When `AgentSpawn` is called with a skill
  name, the coordinator looks up the `Skill` in the registry, compiles it
  into `{ config, registry }`, applies spec-level overrides (model, tool
  allow-list), then constructs and runs a fresh `Agent`.
- **Model override chain.** spec > skill > default. Each level can
  override the previous; `undefined` falls through to the next.
- **Lifecycle events.** Coordinator emits `spawn`, `complete`, `error`
  events. The session writer records these as `agent_event` entries in
  JSONL. The TUI can subscribe to render sub-agent activity.
- **Tool registration.** `AgentSpawn` is constructed per-agent via
  `createAgentSpawnTool(coordinator, parentId)` and registered into the
  registry after coordinator construction. This closure pattern ensures
  `parentId` is always correct for sub-agent tracking.

## Skill System (v0.3)

Skills are Markdown files with YAML frontmatter. Discovery is automatic
from three scopes; later scopes override earlier.

**File pattern:** `*.skill.md` under:
- `<install>/skills/` (builtin, shipped with binary).
- `~/.onicode/skills/` (user scope).
- `<cwd>/.onicode/skills/` (project scope).

**Frontmatter fields:**
- `name` (required): alphanumeric + dash/underscore. Used by `AgentSpawn`.
- `description` (required): one paragraph, surfaced to spawning agent.
- `model`, `provider`, `temperature`, `maxOutputTokens`: optional overrides.
- `allowedTools`: optional array or comma-string. Filters parent registry.
  `undefined` means inherit parent's full toolset.

**Body:** Markdown system prompt. Trimmed and passed verbatim to sub-agent.

**YAML null handling:** Frontmatter accepts `~` (YAML null) or absent fields;
both map to `undefined` via `.optional().nullable()` + transform. This keeps
skill files clean without requiring explicit `null` handling.

**Compilation:** `compileSkill()` is pure — translates `Skill` + parent
context into `{ config: AgentConfig, registry: ToolRegistry }`. No I/O,
no provider construction. Coordinator owns provider selection and agent
instantiation.

## When Adding a New Skill

1. Create `skills/<name>.skill.md` (or user/project scope equivalent).
2. Write YAML frontmatter with `name`, `description`, optional overrides.
3. Write Markdown body as the sub-agent's system prompt.
4. Verify discovery: `node dist/cli.js skills` lists it.
5. Test spawning: use `AgentSpawn` with `skillName: "<name>"` and a task.

Conventions:
- Keep skill files focused. One skill = one responsibility.
- Use `allowedTools` to restrict sub-agents to read-only when possible.
- Include verification commands in the body when the skill makes changes
  (e.g., implementer runs `pnpm typecheck && pnpm test`).
- Name skills as nouns (`explorer`, `planner`) not verbs (`explore`, `plan`).

## MCP Client Architecture (v0.4)

MCP (Model Context Protocol) lets OniCode spawn external tool servers as
child processes and discover their tools automatically.

**Lifecycle:**
1. `McpManager` constructed with `config.mcpServers` and logger.
2. `initializeAll()` spawns each server via `StdioClientTransport`, connects
   via `@modelcontextprotocol/sdk` `Client`, calls `listTools()`.
3. Each tool adapted via `adaptMcpTool()` into `Tool<unknown, unknown>`,
   namespaced as `mcp:<serverName>:<toolName>`.
4. MCP tools merged into shared `ToolRegistry` before coordinator construction.
5. Sub-agents get MCP access automatically via `compileSkill()` filtering.
6. `shutdown()` called in `finally` blocks — `client.close()` + SIGTERM →
   timeout → SIGKILL. Best-effort: errors logged, never thrown.

**Config:** `mcpServers` in `OnicodeConfigSchema`:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"],
      "env": { "ALLOWED_DIR": "/tmp" }
    }
  }
}
```

**Permission integration:** All MCP tools default to `destructive: true` —
go through the permission gate like any other write tool.

**Sub-agent access:** Since MCP tools are in the shared `registry` passed
to `Coordinator` as `toolRegistry`, skills can list them in `allowedTools`:
```yaml
allowedTools:
  - Read
  - mcp:filesystem:readFile
  - mcp:filesystem:writeFile
```

## Code Conventions

- **English everywhere.** Identifiers, comments, JSDoc, prose, commit
  messages — all English regardless of contributor language. Hard rule.
- **TSDoc on every exported symbol.** Module-level docstring at the top
  of every file explaining the responsibility.
- **Pure cores, side effects at edges.** Permission gate, message
  formatter, mappers — pure. I/O lives in executor, providers, session
  writer.
- **Single source of truth per concern.** Tool registry is the only
  catalog of tools. Permission gate is the only allow/deny decision
  point. Session writer is the only writer to JSONL files.
- **No `any`.** Use `unknown` + zod validation at boundaries. The
  `@typescript-eslint/no-explicit-any` rule is `warn` — keep it warn-free.
- **Imports use `import type` for type-only.** Enforced by ESLint.
- **Path resolution always via `src/utils/pathUtils.ts`.** Never use
  `os.homedir()` or `path.resolve(process.cwd(), ...)` directly outside
  that module — Windows quirks live there.
- **Errors are typed.** Custom `ToolError` subclasses for tool failures.
  Catch + convert at the executor boundary, never inside tool code.

## Permission System

Three layers, in order of precedence:

1. **Deny rules** (configured) always win.
2. **Mode policy** (`MODE_POLICIES[mode]`) for tool calls neither denied
   nor explicitly allowed.
3. **Allow rules** (configured) override mode prompts.

Rule format: `ToolName(input-pattern)` where `input-pattern` is a glob
by default or regex with `re:` prefix. Tool name `*` matches any tool.

Examples:
- `Read(**)` — allow Read for any path.
- `Bash(re:^git\s.*)` — allow any git command.
- `Write(/etc/**)` — typically used in deny lists.

## Session Format

Every session writes one JSONL line per event to
`~/.onicode/sessions/<sessionId>.jsonl`. First line is always
`session_start`; last line (clean exit) is `session_end`. Crash-recovered
sessions simply lack the end entry — the reader tolerates this.

Entry kinds: `session_start | user_message | assistant_text | tool_call
| tool_result | agent_event | session_end`. All timestamps ISO 8601.

## Configuration

Three sources, deep-merged (later overrides earlier):

1. `DEFAULT_CONFIG` (in `src/config/defaults.ts`).
2. `~/.onicode/config.json` (user scope).
3. `<cwd>/onicode.config.json` (project scope).

Validated via `OnicodeConfigSchema` (zod). API keys referenced by
**env-var name** (`apiKeyEnv: "ANTHROPIC_API_KEY"`), never embedded.

## Anti-Patterns to Avoid

- **Do not bypass the executor.** Tool code never calls another tool
  directly. The agent loop is the only caller.
- **Do not invent new error categories.** Use `ToolError` subclasses
  (`ToolValidationError`, `ToolPermissionError`, `ToolExecutionError`,
  `ToolAbortedError`, `ToolNotFoundError`).
- **Do not write to stdout from logger or tools.** Stdout is reserved
  for assistant output streamed to the user. Logs go to stderr.
- **Do not embed API keys in config files.** Always reference via env-var
  name.
- **Do not import from deep paths in user code.** Re-export through
  `src/index.ts` for the library surface.
- **Do not add features beyond the milestone.** v0.1 ships only what
  the plan lists; defer new functionality to a future milestone.

## When Adding a New Tool

1. Create `src/tools/builtin/<name>.ts` exporting a `Tool<I, O>` constant.
2. Define input via zod; surface `ToolValidationError` on failure.
3. Set `destructive: true` if the tool can mutate disk/external state.
4. Implement `summarize(input)` returning a single line — used by the
   permission gate, the TUI status bar, and JSONL `tool_call.summary`.
5. Register in `buildBuiltinRegistry()` in `src/core/tools/builtinTools.ts`.
   Both `chat.ts` and `run.ts` import this shared helper.

## When Adding a New Provider

1. Create `src/providers/<id>/{provider,mapper}.ts`.
2. `provider.ts` implements `LLMProvider`.
3. `mapper.ts` translates canonical types to provider-specific shapes.
4. Add the case to `createProvider` in `src/providers/registry.ts`.
5. Update `ProviderIdSchema` in `src/config/schema.ts`.
6. Update `ProviderId` type in `src/config/types.ts`.

## When Adding a Slash Command (v0.2+)

Add a `SlashCommand` entry to `SLASH_COMMANDS` in
`src/tui/slashCommands.ts`. The handler receives parsed args plus a
`SlashCommandContext` (live `permissionContext`, `registry`,
`sessionFilePath`, `agentId`, `modelId`, `providerId`). Return
`{ messages?, exit? }`. Help text is generated from the registry, so
keep `summary` and `args` populated.

Conventions:
- Mutations to `ctx.permissionContext.mode` take effect immediately —
  the executor reads the field on every call.
- `messages` lines render as `system` view entries (dim).
- `exit: true` flips the controller's `exited` flag; the Ink `<App>`
  watches it and calls `useApp().exit()`.

## Reference Plan

Full implementation plan: `.claude/plans/snappy-dreaming-papert.md`.

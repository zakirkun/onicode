# OniCode

> Agentic AI coding CLI with React Ink TUI, MCP client, hierarchical agent coordination, and skill-based prompts.

OniCode is a TypeScript-first agentic coding tool. It pairs a streaming
LLM agent loop with a typed tool registry, a permission gate, JSONL
session persistence, and a React Ink terminal UI. Skills authored as
plain Markdown files configure specialized sub-agents that the
coordinator spawns on demand.

## Status

**v0.6 — Interactive experience & orchestration.** Complete implementation with:

- **Thinking display** — Anthropic extended thinking and OpenAI reasoning tokens rendered in TUI
- **Runtime config management** — switch providers/models mid-session via `/provider` and `/model` commands
- **Expanded slash commands** — 16 commands for config, MCP, memory, and session management
- **@-mention file picker** — inject file contents into prompts with `@filename` autocomplete
- **DAG task orchestrator** — define task graphs with dependencies via `TaskSpawn` tool
- **Background agents** — fire-and-forget sub-agents with TUI notifications
- **Project memory** — persistent markdown notes loaded into system prompt

Previous milestones:

- **v0.5** — OpenAI and Ollama providers via shared OpenAI-compatible adapter
- **v0.4** — MCP client integration with server lifecycle management
- **v0.3** — Coordinator + sub-agent spawning, SKILL.md discovery
- **v0.2** — React Ink TUI, slash commands, interactive permission prompts
- **v0.1** — Headless agent loop with Anthropic provider

## Features

- **Multi-provider** — Anthropic, OpenAI, and Ollama via pluggable `LLMProvider` interface with runtime switching
- **Extended thinking** — Anthropic thinking blocks and OpenAI reasoning tokens displayed in TUI
- **MCP client** — connect to MCP-compliant tool servers via `connectRuntimeServer()` / `disconnectRuntimeServer()`
- **Hierarchical agents** — supervisor/worker coordination with isolated context windows and restricted tool sets
- **Skill-based prompts** — Markdown files with YAML frontmatter define specialized agents (`explorer`, `planner`, `implementer`, `reviewer`)
- **DAG orchestration** — `TaskSpawn` tool for defining task graphs with dependencies and topological execution
- **Background agents** — fire-and-forget sub-agents with TUI notifications and result querying via `TaskQuery`
- **@-mention picker** — autocomplete overlay for injecting file contents into prompts
- **Runtime config** — switch providers/models mid-session, reload config from disk
- **Project memory** — persistent markdown notes at `.onicode/memory.md` loaded into system prompt
- **Permission gate** — four modes (`default`, `acceptEdits`, `plan`, `bypassPermissions`) plus per-tool allow/deny rules
- **JSONL transcripts** — every event appended to `~/.onicode/sessions/<id>.jsonl` for replay and resumption
- **Strict TypeScript** — `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, ESM modules, Node 20+

## Install

```bash
pnpm install
pnpm build
```

The build emits `dist/cli.js` (executable) and `dist/index.js` (library
entrypoint). Link it locally for development:

```bash
pnpm link --global
```

## Quick start

```bash
# Set your API key.
export ANTHROPIC_API_KEY=sk-ant-...

# Launch the interactive TUI (default).
onicode

# Run a single prompt headlessly.
onicode run -p "List the TypeScript files in src/ and summarize each module."

# Override mode for trusted automation.
onicode run -p "Refactor utils/logger.ts" --mode acceptEdits

# Use a different provider or model.
onicode run -p "Explain this codebase" --provider openai --model gpt-4o

# Inspect the session transcript.
cat ~/.onicode/sessions/<id>.jsonl | jq .

# List discovered skills.
onicode skills
```

### Interactive TUI

The `onicode` command (no subcommand) launches a React Ink terminal UI with:

- Streaming response display with thinking/reasoning block rendering
- `@filename` autocomplete for injecting file contents into prompts
- Interactive permission prompts (`y` allow, `n` deny, `a` allow always)
- 16 slash commands for configuration, MCP, memory, and session management
- Background agent notifications with completion previews
- Ctrl+C cancels in-flight turns; idle Ctrl+C exits

## Slash commands

Type `/help` in the TUI to see all commands:

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/exit` | Exit the session (aliases: `/quit`, `/q`) |
| `/mode <mode>` | Switch permission mode |
| `/tools` | List registered tools |
| `/session` | Show current session info |
| `/clear` | Clear conversation history |
| `/model [id]` | View or change the active model |
| `/provider [id]` | View or change the active LLM provider |
| `/config-show` | Show current runtime configuration |
| `/config-reload` | Reload configuration from disk |
| `/mcp-list` | List connected MCP servers |
| `/mcp-add <name> <cmd>` | Connect an MCP server at runtime |
| `/mcp-remove <name>` | Disconnect an MCP server |
| `/memory-view` | Show project memory contents |
| `/memory-add <entry>` | Add an entry to project memory |
| `/memory-clear` | Clear all project memory |

## Configuration

OniCode resolves the effective config by deep-merging three sources, in
order of increasing precedence:

1. **Defaults** — shipped with the binary (see `src/config/defaults.ts`).
2. **User** — `~/.onicode/config.json`.
3. **Project** — `<cwd>/onicode.config.json`.

Sample project config:

```jsonc
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-opus-4-6",
  "providers": {
    "anthropic": { "apiKeyEnv": "ANTHROPIC_API_KEY" }
  },
  "permissions": {
    "mode": "default",
    "allow": ["Read(**)", "Glob(**)", "Grep(**)", "Bash(npm test)"],
    "deny": ["Write(/etc/**)", "Bash(rm -rf *)"]
  },
  "session": { "dir": "~/.onicode/sessions" },
  "coordinator": { "maxConcurrentSubAgents": 3 }
}
```

API keys are referenced by **environment-variable name**, never embedded
literally — keeps secrets out of disk-resident files.

## Project structure

```
src/
├── cli/                 Process entry, arg parsing, subcommand dispatch.
├── tui/                 React Ink TUI: App, controller, components, hooks.
│   ├── components/      ChatInput, MessageList, Message, StatusBar,
│   │                    PermissionPrompt, ToolStatus, MentionPicker.
│   └── hooks/           useTuiStore (useSyncExternalStore binding).
├── core/
│   ├── agent/           Single-context agent loop, message formatter, context.
│   ├── coordinator/     Supervisor pattern, sub-agent spawning, DAG executor,
│   │                    background agent manager, task queue.
│   ├── tools/           Tool registry, executor, permission integration.
│   ├── skills/          SKILL.md discovery, schema, compiler.
│   ├── permissions/     Mode-based gate plus allow/deny rule matcher.
│   ├── session/         JSONL transcript writer/reader/manager.
│   ├── mcp/             MCP client: server lifecycle, tool adapter.
│   ├── config/          Runtime config manager for live switching.
│   └── memory/          Project-level memory (.onicode/memory.md).
├── providers/           LLM provider abstraction + adapters.
│   ├── anthropic/       Anthropic SDK adapter with extended thinking.
│   └── openai/          OpenAI/Ollama adapter with reasoning token capture.
├── tools/builtin/       Read, Write, Edit, Bash, Glob, Grep,
│                        AgentSpawn, TaskSpawn, TaskQuery, Background.
├── config/              Zod schema, defaults, loader.
└── utils/               Logger, idgen, paths, retry, frontmatter, tokenCounter.
```

## Development

```bash
pnpm dev          # tsup --watch
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint src/**/*.{ts,tsx}
pnpm test         # vitest run
```

## Design principles

- **Strict typing.** Tool definitions are typed end-to-end via zod-derived
  input types. The agent loop never sees `any`.
- **Pure cores, side effects at edges.** Permission gate is a pure
  function; tool I/O lives in the executor; LLM I/O lives in the provider.
- **Single source of truth per concern.** Tool registry is the only
  catalog of tools; permission gate is the only place execution is
  allowed/denied; session writer is the only writer to JSONL files.
- **English everywhere.** All identifiers, comments, JSDoc, and prose
  are in English regardless of contributor language.

## License

MIT — see `LICENSE`.

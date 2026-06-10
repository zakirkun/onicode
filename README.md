# OniCode

> Agentic AI coding CLI with React Ink TUI, MCP client, hierarchical agent coordination, and skill-based prompts.

OniCode is a TypeScript-first agentic coding tool. It pairs a streaming
LLM agent loop with a typed tool registry, a permission gate, JSONL
session persistence, and a React Ink terminal UI. Skills authored as
plain Markdown files configure specialized sub-agents that the
coordinator spawns on demand.

## Status

**v0.1 — Headless agent loop.** Single-prompt non-interactive mode with
the Anthropic provider, six built-in tools (Read, Write, Edit, Bash,
Glob, Grep), permission gate with allow/deny rules, and resumable JSONL
session transcripts.

Future milestones (see `.claude/plans/snappy-dreaming-papert.md`):

- v0.2 — React Ink TUI, slash commands, interactive permission prompts.
- v0.3 — Coordinator + sub-agent spawning, SKILL.md discovery.
- v0.4 — MCP client integration.
- v0.5 — OpenAI and Ollama providers.
- v0.6 — Web tools, task tools, session resume.

## Features

- **Multi-provider** — pluggable `LLMProvider` interface; v0.1 ships the
  Anthropic adapter, OpenAI and Ollama planned for v0.5.
- **MCP-ready** — built around Model Context Protocol primitives so any
  MCP-compliant server can plug in as a tool source (v0.4).
- **Hierarchical agents** — supervisor/worker coordination; sub-agents
  receive isolated context windows and restricted tool sets (v0.3).
- **Skill-based prompts** — Markdown files with YAML frontmatter define
  specialized agents (`explorer`, `planner`, `implementer`, `reviewer`).
- **Permission gate** — four modes (`default`, `acceptEdits`, `plan`,
  `bypassPermissions`) plus per-tool allow/deny rules.
- **JSONL transcripts** — every event is appended to
  `~/.onicode/sessions/<id>.jsonl` for replay and resumption.
- **Strict TypeScript** — `strict`, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, ESM modules, Node 20+.

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

# Run a single prompt headlessly.
onicode run -p "List the TypeScript files in src/ and summarize each module."

# Override mode for trusted automation.
onicode run -p "Refactor utils/logger.ts" --mode acceptEdits

# Inspect the session transcript.
cat ~/.onicode/sessions/<id>.jsonl | jq .
```

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
├── tui/                 React Ink components (v0.2+).
├── core/
│   ├── agent/           Single-context agent loop.
│   ├── coordinator/     Supervisor pattern, sub-agent spawning (v0.3+).
│   ├── tools/           Tool registry, executor, permission integration.
│   ├── skills/          SKILL.md discovery (v0.3+).
│   ├── permissions/     Mode-based gate plus allow/deny rule matcher.
│   ├── session/         JSONL transcript writer/reader/manager.
│   └── mcp/             MCP client (v0.4+).
├── providers/           LLM provider abstraction + adapters.
├── tools/builtin/       Read, Write, Edit, Bash, Glob, Grep.
├── config/              Zod schema, defaults, loader.
└── utils/               Logger, idgen, paths, retry, frontmatter.
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

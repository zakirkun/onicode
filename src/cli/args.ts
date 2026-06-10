/**
 * CLI argument parser.
 *
 * Built on top of `node:util.parseArgs`. The CLI surface is intentionally
 * small for v0.1: a single optional subcommand plus a handful of common
 * flags. Subcommands recognized:
 *
 *   - (default) / `chat`  — interactive TUI mode (v0.2+).
 *   - `run`               — headless mode; expects `-p <prompt>` (v0.1).
 *   - `resume <id>`       — resume an existing session by id (v0.6).
 *   - `skills`            — list / inspect skills (v0.3).
 *
 * v0.1 only wires up `run`; the other commands print a friendly message
 * indicating the version that adds them.
 */
import { parseArgs as nodeParseArgs } from "node:util";

import type { PermissionMode, ProviderId } from "../config/types.js";

/** Recognized subcommand. */
export type CliCommand = "run" | "chat" | "resume" | "skills" | "help";

/** Parsed CLI arguments. */
export interface ParsedArgs {
  command: CliCommand;
  /** Prompt text supplied via `-p / --prompt` (run mode). */
  prompt?: string;
  /** Session id passed positionally to `resume`. */
  sessionId?: string;
  /** Override permission mode for this run. */
  mode?: PermissionMode;
  /** Override provider id for this run. */
  provider?: ProviderId;
  /** Override model id for this run. */
  model?: string;
  /** Enable debug logging. */
  debug: boolean;
  /** Show help and exit. */
  help: boolean;
}

/** Recognized permission mode strings — used to validate `--mode`. */
const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

/** Recognized provider id strings — used to validate `--provider`. */
const PROVIDERS: readonly ProviderId[] = ["anthropic", "openai", "ollama"];

/**
 * Parse CLI arguments.
 *
 * @param argv - argument array (typically `process.argv.slice(2)`).
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const { values, positionals } = nodeParseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: false,
    options: {
      prompt: { type: "string", short: "p" },
      mode: { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      debug: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const command = resolveCommand(positionals[0]);
  const sessionId = command === "resume" ? positionals[1] : undefined;

  return {
    command,
    ...(typeof values.prompt === "string" ? { prompt: values.prompt } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(typeof values.mode === "string" ? { mode: validateMode(values.mode) } : {}),
    ...(typeof values.provider === "string"
      ? { provider: validateProvider(values.provider) }
      : {}),
    ...(typeof values.model === "string" ? { model: values.model } : {}),
    debug: Boolean(values.debug),
    help: Boolean(values.help),
  };
}

/** Map the first positional to a known subcommand; default to `chat`. */
function resolveCommand(first: string | undefined): CliCommand {
  switch (first) {
    case "run":
    case "chat":
    case "resume":
    case "skills":
    case "help":
      return first;
    case undefined:
      return "chat";
    default:
      // Unknown positional — assume the user invoked `onicode <prompt>`
      // accidentally; fall through to chat and let the runner explain.
      return "chat";
  }
}

/** Reject `--mode` values that are not a known `PermissionMode`. */
function validateMode(value: string): PermissionMode {
  if ((PERMISSION_MODES as readonly string[]).includes(value)) {
    return value as PermissionMode;
  }
  throw new Error(
    `Unknown mode "${value}". Expected one of: ${PERMISSION_MODES.join(", ")}.`,
  );
}

/** Reject `--provider` values that are not a known `ProviderId`. */
function validateProvider(value: string): ProviderId {
  if ((PROVIDERS as readonly string[]).includes(value)) {
    return value as ProviderId;
  }
  throw new Error(
    `Unknown provider "${value}". Expected one of: ${PROVIDERS.join(", ")}.`,
  );
}

/** Help text printed for `--help` / `help`. */
export const HELP_TEXT = `\
OniCode — Agentic AI Coding CLI

Usage:
  onicode [chat]                    Start interactive TUI (v0.2+).
  onicode run -p "<prompt>"         Run a single prompt headlessly.
  onicode resume <session-id>       Resume a saved session (v0.6+).
  onicode skills                    List available skills (v0.3+).

Options:
  -p, --prompt <text>     Prompt for headless mode.
      --mode <mode>       Permission mode: default | acceptEdits | plan | bypassPermissions.
      --provider <id>     Provider id: anthropic | openai | ollama.
      --model <id>        Model id (provider-specific).
      --debug             Enable debug logging to stderr.
  -h, --help              Show this help and exit.

Environment:
  ANTHROPIC_API_KEY       Required when provider=anthropic.
  OPENAI_API_KEY          Required when provider=openai (v0.5+).
`;

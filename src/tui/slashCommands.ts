/**
 * Slash command registry.
 *
 * Slash commands are TUI-local utilities that never reach the LLM. The
 * controller intercepts any user input whose first non-whitespace character
 * is `/`, looks up the matching `SlashCommand`, and runs its `execute`
 * handler. Anything else is forwarded to the agent as a normal user turn.
 *
 * Adding a command:
 *   1. Append a `SlashCommand` entry to `SLASH_COMMANDS`.
 *   2. Implement `execute`. The handler may push messages into the view,
 *      mutate the permission context, or call `ctx.exit` to terminate.
 *
 * Help text is built from this same list, so `/help` stays in sync without
 * a separate doc.
 */
import type { ToolRegistry } from "../core/tools/registry.js";
import type { PermissionContext, PermissionMode } from "../core/permissions/types.js";

/** Result of running a slash command. */
export interface SlashCommandResult {
  /** Lines to display in the scroll-back as `system` messages. */
  messages?: string[];
  /** True when the controller should close the TUI after this command. */
  exit?: boolean;
}

/**
 * Mutable context handed to slash command handlers. Mutating
 * `permissionContext.mode` is supported and takes effect immediately because
 * the executor reads it on every call.
 */
export interface SlashCommandContext {
  permissionContext: PermissionContext;
  registry: ToolRegistry;
  sessionFilePath: string;
  agentId: string;
  modelId: string;
  providerId: string;
}

/** A single slash command. */
export interface SlashCommand {
  /** Command name without the leading `/`. */
  name: string;
  /** Optional aliases (also without the leading `/`). */
  aliases?: readonly string[];
  /** One-line summary surfaced by `/help`. */
  summary: string;
  /** Argument hint surfaced by `/help`, e.g. `<mode>`. */
  args?: string;
  /** Synchronous or async handler. */
  execute(args: string, ctx: SlashCommandContext): SlashCommandResult | Promise<SlashCommandResult>;
}

/** Recognized permission modes; mirror of `config/types.ts` keep-list. */
const PERMISSION_MODES: readonly PermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
];

/** Registered slash commands, in display order. */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    name: "help",
    aliases: ["?"],
    summary: "List available slash commands.",
    execute: () => ({ messages: [renderHelp()] }),
  },
  {
    name: "exit",
    aliases: ["quit", "q"],
    summary: "Exit OniCode.",
    execute: () => ({ exit: true }),
  },
  {
    name: "mode",
    args: "<mode>",
    summary: `Change permission mode (one of ${PERMISSION_MODES.join(", ")}).`,
    execute: (args, ctx) => {
      const trimmed = args.trim();
      if (trimmed.length === 0) {
        return {
          messages: [
            `Current mode: ${ctx.permissionContext.mode}.`,
            `Modes: ${PERMISSION_MODES.join(", ")}.`,
          ],
        };
      }
      if (!isPermissionMode(trimmed)) {
        return {
          messages: [
            `Unknown mode "${trimmed}". Expected one of: ${PERMISSION_MODES.join(", ")}.`,
          ],
        };
      }
      ctx.permissionContext.mode = trimmed;
      return { messages: [`Permission mode → ${trimmed}.`] };
    },
  },
  {
    name: "tools",
    summary: "List registered tools.",
    execute: (_args, ctx) => {
      const lines = ctx.registry
        .manifests()
        .map((m) => `  ${m.name} — ${m.description.split("\n")[0] ?? ""}`);
      return { messages: ["Registered tools:", ...lines] };
    },
  },
  {
    name: "session",
    summary: "Show current session id, model, and transcript path.",
    execute: (_args, ctx) => ({
      messages: [
        `Session file: ${ctx.sessionFilePath}`,
        `Agent: ${ctx.agentId}`,
        `Provider: ${ctx.providerId}, model: ${ctx.modelId}`,
      ],
    }),
  },
  {
    name: "clear",
    summary: "Clear the on-screen scroll-back (agent history is preserved).",
    execute: () => ({ messages: [] }),
  },
];

/**
 * Look up a command by name or alias. Returns `undefined` if no match.
 */
export function findCommand(name: string): SlashCommand | undefined {
  const normalized = name.toLowerCase();
  return SLASH_COMMANDS.find(
    (c) => c.name === normalized || (c.aliases?.includes(normalized) ?? false),
  );
}

/**
 * Parse a raw input line as a slash command. Returns `null` when the line is
 * not a slash command (i.e. should be forwarded to the agent).
 */
export function parseSlashCommand(line: string): { name: string; args: string } | null {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const rest = trimmed.slice(1);
  const spaceIdx = rest.indexOf(" ");
  if (spaceIdx === -1) {
    return { name: rest.trim(), args: "" };
  }
  return { name: rest.slice(0, spaceIdx), args: rest.slice(spaceIdx + 1) };
}

/** Build the `/help` output from the registered command list. */
function renderHelp(): string {
  const rows = SLASH_COMMANDS.map((c) => {
    const head = c.args ? `/${c.name} ${c.args}` : `/${c.name}`;
    const aliases =
      c.aliases && c.aliases.length > 0
        ? ` (aliases: ${c.aliases.map((a) => `/${a}`).join(", ")})`
        : "";
    return `  ${head.padEnd(24)} ${c.summary}${aliases}`;
  });
  return ["Slash commands:", ...rows].join("\n");
}

/** Type-guard for the `PermissionMode` union. */
function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

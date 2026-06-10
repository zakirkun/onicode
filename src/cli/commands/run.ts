/**
 * Headless `run` command.
 *
 * Wires every layer together for a single non-interactive prompt:
 *
 *   load config → create logger → create provider → build tool registry
 *     → create session → build permission context → construct executor
 *     → construct agent → stream a single user turn → flush session.
 *
 * Output goes to stdout; logs go to stderr; the JSONL transcript lands in
 * `~/.onicode/sessions/<id>.jsonl`. The exit code is `0` on success and
 * non-zero on configuration or execution failures, so headless usage
 * composes cleanly in CI scripts.
 *
 * In headless mode the permission gate's `prompt` decisions are mapped to
 * `deny` automatically — there is no terminal to host an interactive
 * prompt. Users who want headless auto-allow set `mode=acceptEdits` or
 * `mode=bypassPermissions` via `--mode`.
 */
import { loadConfig } from "../../config/loader.js";
import type { OnicodeConfig, ProviderId } from "../../config/types.js";
import type { PromptHandler } from "../../core/tools/executor.js";
import { SessionManager } from "../../core/session/sessionManager.js";
import { Coordinator } from "../../core/coordinator/coordinator.js";
import { loadSkills } from "../../core/skills/loader.js";
import { createProvider } from "../../providers/registry.js";
import { buildBuiltinRegistry, registerOrchestrationTools } from "../../core/tools/builtinTools.js";
import { McpManager } from "../../core/mcp/manager.js";
import { createAgentSpawnTool } from "../../tools/builtin/agentSpawn.js";
import { newAgentId } from "../../utils/idgen.js";
import { createLogger, type Logger } from "../../utils/logger.js";
import type { ParsedArgs } from "../args.js";

/** OniCode binary version. Kept in sync with `package.json`. */
const ONICODE_VERSION = "0.1.0";

/** Default system prompt for the top-level headless agent. */
const DEFAULT_SYSTEM_PROMPT = `\
You are OniCode, an agentic AI coding assistant running in headless mode.

You have access to a set of tools to read and modify files, run shell
commands, and search the codebase. Use them deliberately:

- Always read a file before editing it.
- Prefer narrow, targeted Bash invocations over broad scripts.
- When you finish, summarize what you did in plain prose.
`;

/**
 * Run a single prompt headlessly.
 *
 * @param args - parsed CLI arguments.
 * @returns process exit code.
 */
export async function runHeadless(args: ParsedArgs): Promise<number> {
  if (!args.prompt || args.prompt.trim().length === 0) {
    process.stderr.write(
      "onicode run: missing prompt. Use `-p \"your prompt\"` to supply one.\n",
    );
    return 2;
  }

  const log = createLogger({
    level: args.debug ? "debug" : "info",
    base: { component: "cli.run" },
  });

  let config: OnicodeConfig;
  try {
    config = await loadConfig({ cwd: process.cwd() });
  } catch (err) {
    log.error("failed to load config", { err });
    return 1;
  }

  // Apply CLI-level overrides on top of the loaded config.
  if (args.mode) {
    config.permissions.mode = args.mode;
  }
  const providerId = args.provider ?? config.defaultProvider;
  const model = args.model ?? config.defaultModel;

  // Validate provider config early so we fail fast before creating sessions.
  const providerConfig = config.providers[providerId];
  if (!providerConfig) {
    log.error(`No configuration for provider "${providerId}".`);
    return 1;
  }

  const registry = buildBuiltinRegistry();

  // Initialize MCP servers and merge their tools into the main registry.
  const mcpManager = new McpManager(config.mcpServers, log);
  const mcpRegistry = await mcpManager.initializeAll();
  for (const tool of mcpRegistry.list()) {
    registry.register(tool);
  }

  const sessionManager = new SessionManager({ baseDir: config.session.dir, log });
  const session = await sessionManager.create({
    cwd: process.cwd(),
    model,
    provider: providerId,
    version: ONICODE_VERSION,
  });

  // Load skills from all scopes (builtin, user, project).
  const skillRegistry = await loadSkills({ log, cwd: process.cwd() });

  const agentId = newAgentId();
  const promptHandler: PromptHandler = async (_decision, prompt) => {
    log.warn("permission prompt in headless mode → deny", prompt);
    return "deny";
  };

  const permissionContext = {
    mode: config.permissions.mode,
    allow: config.permissions.allow,
    deny: config.permissions.deny,
  };

  // Coordinator owns sub-agent spawning; the AgentSpawn tool bridges to it.
  const coordinator = new Coordinator({
    skillRegistry,
    toolRegistry: registry,
    resolveProvider: (id) => {
      const pid = id as ProviderId;
      const providerConfig = config.providers[pid];
      if (!providerConfig) {
        throw new Error(`No configuration for provider "${id}".`);
      }
      return createProvider(pid, providerConfig, log);
    },
    permissionContext,
    promptHandler,
    sessionWriter: session.writer,
    log,
    cwd: process.cwd(),
    defaultModel: model,
    defaultProviderId: providerId,
    maxConcurrentSubAgents: config.coordinator.maxConcurrentSubAgents,
  });

  // Register the AgentSpawn tool so the top-level agent can spawn sub-agents.
  const agentSpawnTool = createAgentSpawnTool(coordinator, agentId);
  registry.register(agentSpawnTool);

  // Register DAG orchestration tools (TaskSpawn, TaskQuery).
  registerOrchestrationTools(registry, coordinator, agentId);

  // Use the coordinator's factory method to build the top-level agent.
  const agent = coordinator.buildTopLevelAgent(agentId, DEFAULT_SYSTEM_PROMPT);

  const controller = new AbortController();
  const onSigInt = (): void => controller.abort();
  process.on("SIGINT", onSigInt);

  let exitCode = 0;
  let sawError = false;
  try {
    for await (const event of agent.send(args.prompt, controller.signal)) {
      switch (event.kind) {
        case "text_delta":
          process.stdout.write(event.delta);
          break;
        case "tool_call":
          if (args.debug) {
            process.stderr.write(`\n[tool] ${event.call.name}\n`);
          }
          break;
        case "error":
          sawError = true;
          process.stderr.write(`\nError: ${event.error.message}\n`);
          break;
        case "done":
          // Force a trailing newline so shell prompts do not concatenate.
          process.stdout.write("\n");
          break;
        default:
          // Other events are not surfaced in headless mode.
          break;
      }
    }
  } catch (err) {
    sawError = true;
    log.error("headless run failed", { err });
    exitCode = 1;
  } finally {
    process.off("SIGINT", onSigInt);
    await session.writer.end(sawError ? "error" : "completed");
    await mcpManager.shutdown();
  }

  if (args.debug) {
    process.stderr.write(`\nSession: ${session.filePath}\n`);
  }
  return exitCode === 0 && sawError ? 1 : exitCode;
}

// Avoid an unused-import warning in environments where the Logger type is
// only referenced via inferred returns above.
type _LoggerKeep = Logger;
void (0 as unknown as _LoggerKeep);

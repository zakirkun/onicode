/**
 * Interactive `chat` command.
 *
 * Mirrors the wiring of `runHeadless` but keeps the agent loop running until
 * the user explicitly exits. The TUI runs the React Ink render loop; the
 * controller bridges Ink and the agent.
 *
 * Lifecycle:
 *
 *   1. Load config and apply CLI overrides.
 *   2. Create provider, registry, session.
 *   3. Build a permission context the controller can mutate live (so
 *      `/mode <new>` and `allow_always` decisions take effect immediately).
 *   4. Construct the executor with the controller's `promptHandler`.
 *   5. Construct the agent.
 *   6. Render the Ink `<App>`; await `waitUntilExit` for orderly shutdown.
 *
 * Logger output is muted to the file system path during interactive mode —
 * the alternate behavior (writing to stderr) would interleave with the Ink
 * render and corrupt the terminal.
 */
import { render } from "ink";
import React from "react";

import { loadConfig } from "../../config/loader.js";
import type { OnicodeConfig, ProviderId } from "../../config/types.js";
import { RuntimeConfigManager } from "../../core/config/runtimeConfig.js";
import { SessionManager } from "../../core/session/sessionManager.js";
import { Coordinator } from "../../core/coordinator/coordinator.js";
import { loadSkills } from "../../core/skills/loader.js";
import { createProvider } from "../../providers/registry.js";
import { buildBuiltinRegistry, registerOrchestrationTools } from "../../core/tools/builtinTools.js";
import type { PromptHandler } from "../../core/tools/executor.js";
import { McpManager } from "../../core/mcp/manager.js";
import { createMemoryManager } from "../../core/memory/memoryManager.js";
import { createAgentSpawnTool } from "../../tools/builtin/agentSpawn.js";
import { App } from "../../tui/App.js";
import { TuiController } from "../../tui/controller.js";
import { newAgentId } from "../../utils/idgen.js";
import { createLogger, NULL_LOGGER, type Logger } from "../../utils/logger.js";
import type { ParsedArgs } from "../args.js";

/** OniCode binary version. */
const ONICODE_VERSION = "0.1.0";

/** Default system prompt for the interactive top-level agent. */
const DEFAULT_SYSTEM_PROMPT = `\
You are OniCode, an agentic AI coding assistant in interactive mode.

You have access to a set of tools to read, search, and modify files, and to
run shell commands. Behavioral expectations:

- Read a file before editing it.
- Prefer narrow, targeted Bash invocations over broad scripts.
- When the user asks an open-ended question, plan briefly before acting.
- Keep responses concise; the user is reading them in a terminal pane.
`;

/**
 * Run the interactive chat TUI. Returns the process exit code; resolves only
 * after the Ink render loop terminates.
 *
 * @param args - parsed CLI arguments.
 */
export async function runChat(args: ParsedArgs): Promise<number> {
  // Logger: only emit to stderr when `--debug` is set; otherwise stay quiet
  // so the Ink renderer owns the terminal exclusively.
  const log: Logger = args.debug
    ? createLogger({ level: "debug", base: { component: "cli.chat" } })
    : NULL_LOGGER;

  let config: OnicodeConfig;
  try {
    config = await loadConfig({ cwd: process.cwd() });
  } catch (err) {
    process.stderr.write(`onicode: failed to load config: ${describe(err)}\n`);
    return 1;
  }

  if (args.mode) {
    config.permissions.mode = args.mode;
  }
  const providerId = args.provider ?? config.defaultProvider;
  const model = args.model ?? config.defaultModel;

  // Validate provider config early so we fail fast before creating sessions.
  if (!config.providers[providerId]) {
    process.stderr.write(`onicode: no configuration for provider "${providerId}".\n`);
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

  // Runtime config manager — lets slash commands mutate provider/model/mode
  // at runtime without restarting the session.
  const configManager = new RuntimeConfigManager({ config, cwd: process.cwd(), log });

  // The permission context is shared by reference between the controller
  // (which mutates `mode` and pushes runtime allow rules) and the executor
  // (which reads them on every call).
  const permissionContext = {
    mode: config.permissions.mode,
    allow: [...config.permissions.allow] as string[],
    deny: [...config.permissions.deny] as string[],
  };

  const agentId = newAgentId();
  // Forward declaration so the promptHandler can close over a controller
  // that has not yet been constructed (mutual dependency).
  let controller: TuiController | null = null;
  const promptHandler: PromptHandler = (decision, ctx) => {
    if (!controller) {
      // Defensive: should never happen because we set `controller` below
      // synchronously before any tool runs.
      return Promise.resolve("deny");
    }
    return controller.promptHandler(decision, ctx);
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

  // Load project memory and inject into system prompt.
  const memoryManager = createMemoryManager(process.cwd());
  const memory = await memoryManager.load();
  const systemPrompt = memory
    ? `${DEFAULT_SYSTEM_PROMPT}\n\n## Project Context\n\n${memory}`
    : DEFAULT_SYSTEM_PROMPT;

  // Use the coordinator's factory method to build the top-level agent.
  const agent = coordinator.buildTopLevelAgent(agentId, systemPrompt);

  controller = new TuiController({
    agent,
    permissionContext,
    registry,
    log,
    sessionFilePath: session.filePath,
    agentId,
    modelId: model,
    providerId,
    configManager,
    mcpManager,
    memoryManager,
    backgroundManager: coordinator.backgroundManager,
    cwd: process.cwd(),
    onExit: () => {
      // The Ink `<App>` watches the `exited` flag and calls `useApp().exit`.
    },
    pushAllowRule: (rule) => {
      permissionContext.allow.push(rule);
    },
  });

  const instance = render(
    React.createElement(App, {
      controller,
      modelId: model,
      providerId,
      sessionId: session.sessionId,
      cwd: process.cwd(),
    }),
    {
      // Use stdout for rendering; stderr stays free for the logger when --debug.
      stdout: process.stdout,
      stderr: process.stderr,
      exitOnCtrlC: false,
    },
  );

  // SIGINT cancels the current turn; Ink swallows raw Ctrl+C because of
  // `exitOnCtrlC: false`, so process-level signals come from outside.
  const onSigInt = (): void => controller?.cancel();
  process.on("SIGINT", onSigInt);

  let exitCode = 0;
  try {
    await instance.waitUntilExit();
  } catch (err) {
    process.stderr.write(`onicode: chat exited with error: ${describe(err)}\n`);
    exitCode = 1;
  } finally {
    process.off("SIGINT", onSigInt);
    await session.writer.end(exitCode === 0 ? "user_exit" : "error");
    await mcpManager.shutdown();
  }

  if (args.debug) {
    process.stderr.write(`Session: ${session.filePath}\n`);
  }
  return exitCode;
}

/** Render any thrown value as a printable string. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Tool executor.
 *
 * Single point of entry for running a tool call. Steps, in order:
 *
 *   1. **Resolve** — look the tool up in the registry. Missing tool → fail.
 *   2. **Summarize** — ask the tool for a one-line summary of the input.
 *   3. **Permission check** — consult the gate. Outcomes:
 *        - `allow`   → proceed.
 *        - `deny`    → fail with `ToolPermissionError`.
 *        - `prompt`  → invoke the configured `PromptHandler`. The handler
 *                      decides allow/deny by, e.g., showing a TUI prompt or
 *                      reading a flag in headless mode.
 *   4. **Execute** — invoke `tool.execute(input, ctx)` with a child logger.
 *   5. **Wrap** — catch any thrown value and convert to `ToolErrorPayload`.
 *
 * The executor is provider-agnostic and TUI-agnostic. The TUI's only role
 * is to provide a `PromptHandler`; in headless mode the handler can be
 * configured to auto-allow, auto-deny, or read from a CLI flag.
 */
import {
  ToolAbortedError,
  ToolNotFoundError,
  ToolPermissionError,
  toErrorPayload,
} from "./errors.js";
import type { Tool, ToolCall, ToolExecCtx, ToolResult } from "./types.js";
import type { ToolRegistry } from "./registry.js";
import { checkPermission } from "../permissions/gate.js";
import type { PermissionContext, PermissionDecision } from "../permissions/types.js";
import type { Logger } from "../../utils/logger.js";

/**
 * Decision returned by the prompt handler when the gate asks the user for
 * a per-call decision. Forms a feedback loop between TUI and executor.
 */
export type PromptOutcome = "allow" | "deny";

/**
 * Function called when the gate returns `prompt`. The TUI implements this
 * by rendering a yes/no prompt; headless mode plugs in a static answer.
 */
export type PromptHandler = (
  decision: Extract<PermissionDecision, { kind: "prompt" }>,
  context: { toolName: string; inputSummary: string },
) => Promise<PromptOutcome>;

/** Construction options for {@link ToolExecutor}. */
export interface ToolExecutorOptions {
  /** Registry the executor looks up tools in. */
  registry: ToolRegistry;
  /** Permission mode + rule lists in effect for this session. */
  permissionContext: PermissionContext;
  /** Handler invoked when the gate requests a per-call user decision. */
  promptHandler: PromptHandler;
  /** Top-level logger; child loggers are created per call. */
  log: Logger;
  /** Working directory injected into `ToolExecCtx.cwd`. */
  cwd: string;
  /** Identifier of the agent that owns this executor. */
  agentId: string;
}

/** Runs tool calls produced by the agent loop. */
export class ToolExecutor {
  private readonly registry: ToolRegistry;
  private readonly permissionContext: PermissionContext;
  private readonly promptHandler: PromptHandler;
  private readonly log: Logger;
  private readonly cwd: string;
  private readonly agentId: string;

  constructor(opts: ToolExecutorOptions) {
    this.registry = opts.registry;
    this.permissionContext = opts.permissionContext;
    this.promptHandler = opts.promptHandler;
    this.log = opts.log;
    this.cwd = opts.cwd;
    this.agentId = opts.agentId;
  }

  /**
   * Run a tool call end-to-end and produce a structured result.
   *
   * Never throws — failures are returned as `ok: false` results so the
   * agent loop has a uniform shape to feed back into the LLM.
   *
   * @param call - the tool call as emitted by the LLM.
   * @param signal - cancellation signal forwarded to the tool.
   */
  async run(call: ToolCall, signal: AbortSignal): Promise<ToolResult> {
    const callLog = this.log.child({ tool: call.name, callId: call.id, agentId: this.agentId });
    try {
      const tool = this.resolveTool(call.name);
      const summary = safeSummarize(tool, call.input);

      const decision = checkPermission(this.permissionContext, {
        toolName: tool.name,
        inputSummary: summary,
        destructive: tool.destructive,
      });
      await this.applyDecision(decision, tool.name, summary);

      if (signal.aborted) {
        throw new ToolAbortedError();
      }

      const ctx: ToolExecCtx = {
        signal,
        cwd: this.cwd,
        log: callLog,
        agentId: this.agentId,
        callId: call.id,
      };

      callLog.debug("tool exec start", { summary });
      const output = await tool.execute(call.input, ctx);
      callLog.debug("tool exec ok");
      return { callId: call.id, ok: true, output };
    } catch (err) {
      const payload = toErrorPayload(err);
      callLog.warn("tool exec failed", { kind: payload.kind, message: payload.message });
      return { callId: call.id, ok: false, error: payload };
    }
  }

  /** Look up a tool by name; throw if absent. */
  private resolveTool(name: string): Tool {
    const tool = this.registry.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }
    return tool;
  }

  /**
   * Apply a permission decision: allow → no-op, deny → throw, prompt → ask
   * the configured prompt handler and apply its answer.
   */
  private async applyDecision(
    decision: PermissionDecision,
    toolName: string,
    summary: string,
  ): Promise<void> {
    if (decision.kind === "allow") {
      return;
    }
    if (decision.kind === "deny") {
      throw new ToolPermissionError(decision.reason);
    }
    // kind === "prompt"
    const outcome = await this.promptHandler(decision, { toolName, inputSummary: summary });
    if (outcome === "deny") {
      throw new ToolPermissionError(`User denied ${toolName} call.`);
    }
  }
}

/**
 * Call `tool.summarize` defensively. A misbehaving tool that throws inside
 * `summarize` should not abort the executor; instead we report a fallback
 * summary so the gate still has something to match against.
 */
function safeSummarize(tool: Tool, input: unknown): string {
  try {
    return tool.summarize(input);
  } catch (err) {
    // Throwing here would mask the real error; degrade gracefully instead.
    const message = err instanceof Error ? err.message : "unknown";
    return `${tool.name} (summary unavailable: ${message})`;
  }
}

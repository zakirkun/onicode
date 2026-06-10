/**
 * TUI controller.
 *
 * The "controller" is the bridge between the React Ink view and the
 * stateless engine layer (`Agent`, `ToolExecutor`, `SessionWriter`). It owns
 * a single typed in-memory store, exposes `useStore`-style subscription, and
 * drives the agent loop on user submissions.
 *
 * The controller intentionally does *not* live inside React. Keeping the
 * store outside the render tree lets us:
 *
 *   - Drive long-running async loops without React re-render storms.
 *   - Expose the same surface to non-Ink runners (tests, integration
 *     harnesses) without pulling React in.
 *   - Re-target a different renderer later without touching the agent loop.
 *
 * View binding: components subscribe via {@link useTuiStore} (see
 * `hooks/useTuiStore.ts`). The controller mutates a single `state` object and
 * notifies subscribers; React re-renders on every notification.
 */
import { newEventId, newToolCallId } from "../utils/idgen.js";
import type { Agent } from "../core/agent/agent.js";
import type { AgentEvent } from "../core/agent/types.js";
import type { PromptHandler, PromptOutcome } from "../core/tools/executor.js";
import type { PermissionContext } from "../core/permissions/types.js";
import type { ToolRegistry } from "../core/tools/registry.js";
import type { TokenUsage } from "../providers/types.js";
import type { Logger } from "../utils/logger.js";
import {
  findCommand,
  parseSlashCommand,
  type SlashCommandContext,
} from "./slashCommands.js";
import type {
  AgentActivity,
  ChatMessageView,
  PendingPermission,
  PermissionPromptOutcome,
} from "./types.js";

/** Snapshot consumed by the React view. Treated as immutable per render. */
export interface TuiState {
  views: ChatMessageView[];
  activity: AgentActivity;
  pendingPermission: PendingPermission | null;
  history: string[];
  usage: TokenUsage;
  inputEnabled: boolean;
  exited: boolean;
}

/** Construction options for {@link TuiController}. */
export interface TuiControllerOptions {
  agent: Agent;
  permissionContext: PermissionContext;
  registry: ToolRegistry;
  log: Logger;
  sessionFilePath: string;
  agentId: string;
  modelId: string;
  providerId: string;
  /** Called when a slash command (or the user) requests exit. */
  onExit: () => void;
  /** Bind extra runtime allow rules on `allow_always` decisions. */
  pushAllowRule: (rule: string) => void;
}

/**
 * Drives the chat loop. The controller is a class because it owns long-lived
 * subscriptions and async state; React refs would be awkward for this.
 */
export class TuiController {
  private state: TuiState = {
    views: [],
    activity: { kind: "idle" },
    pendingPermission: null,
    history: [],
    usage: { inputTokens: 0, outputTokens: 0 },
    inputEnabled: true,
    exited: false,
  };

  private readonly subscribers = new Set<() => void>();
  private currentAbort: AbortController | null = null;

  constructor(private readonly opts: TuiControllerOptions) {}

  /** Subscribe to state changes. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  /** Read the current immutable snapshot. */
  getSnapshot(): TuiState {
    return this.state;
  }

  /** Return the active permission mode (read straight from the live context). */
  getMode(): string {
    return this.opts.permissionContext.mode;
  }

  /**
   * Permission handler the executor calls when the gate returns `prompt`.
   * Pushes a `PendingPermission` into state and awaits the user's keystroke.
   */
  promptHandler: PromptHandler = (decision, ctx) => {
    return new Promise<PromptOutcome>((resolve) => {
      const id = newEventId();
      const pending: PendingPermission = {
        id,
        toolName: ctx.toolName,
        inputSummary: ctx.inputSummary,
        preview: decision.preview,
        resolve: (outcome: PermissionPromptOutcome): void => {
          // Translate a TUI outcome into the executor's allow/deny.
          this.update((s) => ({
            ...s,
            activity: { kind: "thinking" },
            pendingPermission: null,
          }));
          if (outcome === "allow") {
            resolve("allow");
            return;
          }
          if (outcome === "deny") {
            resolve("deny");
            return;
          }
          // allow_always — install a runtime allow rule for this exact tool
          // input pattern, then allow the current call.
          this.opts.pushAllowRule(`${ctx.toolName}(${escapePattern(ctx.inputSummary)})`);
          this.pushSystem(`Added runtime allow rule: ${ctx.toolName}(${ctx.inputSummary})`);
          resolve("allow");
        },
      };
      this.update((s) => ({
        ...s,
        activity: {
          kind: "awaiting_permission",
          toolName: ctx.toolName,
          summary: ctx.inputSummary,
        },
        pendingPermission: pending,
      }));
    });
  };

  /** Resolve a pending prompt from the view. No-op when nothing is pending. */
  resolvePermission(id: string, outcome: PermissionPromptOutcome): void {
    const pending = this.state.pendingPermission;
    if (!pending || pending.id !== id) {
      return;
    }
    pending.resolve(outcome);
  }

  /** Cancel an in-flight agent turn (Ctrl+C). No-op when nothing is running. */
  cancel(): void {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.pushSystem("Aborted.");
    }
  }

  /**
   * Handle a fresh line from the chat input. Slash commands are dispatched
   * locally; everything else is forwarded to the agent.
   */
  async submit(line: string): Promise<void> {
    if (this.state.exited) {
      return;
    }
    this.update((s) => ({ ...s, history: appendHistory(s.history, line) }));

    const parsed = parseSlashCommand(line);
    if (parsed) {
      await this.runSlashCommand(parsed.name, parsed.args);
      return;
    }

    await this.runAgentTurn(line);
  }

  /** Execute a slash command in the current TUI context. */
  private async runSlashCommand(name: string, args: string): Promise<void> {
    const cmd = findCommand(name);
    if (!cmd) {
      this.pushError(`Unknown slash command: /${name}. Type /help for a list.`);
      return;
    }
    const ctx: SlashCommandContext = {
      permissionContext: this.opts.permissionContext,
      registry: this.opts.registry,
      sessionFilePath: this.opts.sessionFilePath,
      agentId: this.opts.agentId,
      modelId: this.opts.modelId,
      providerId: this.opts.providerId,
    };
    try {
      const result = await cmd.execute(args, ctx);
      if (cmd.name === "clear") {
        this.update((s) => ({ ...s, views: [] }));
      }
      for (const msg of result.messages ?? []) {
        this.pushSystem(msg);
      }
      if (result.exit) {
        this.update((s) => ({ ...s, exited: true, inputEnabled: false }));
        this.opts.onExit();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.pushError(`Slash command /${name} failed: ${message}`);
    }
  }

  /** Forward a line to the agent and stream events into the view store. */
  private async runAgentTurn(line: string): Promise<void> {
    const userId = newEventId();
    this.update((s) => ({
      ...s,
      views: [...s.views, { id: userId, kind: "user", text: line }],
      activity: { kind: "thinking" },
      inputEnabled: false,
    }));

    const abort = new AbortController();
    this.currentAbort = abort;

    let assistantViewId: string | null = null;
    const knownTools = new Map<string, { id: string; toolName: string; summary: string }>();

    try {
      for await (const event of this.opts.agent.send(line, abort.signal)) {
        this.applyAgentEvent(event, {
          getOrCreateAssistantView: (): string => {
            if (assistantViewId) {
              return assistantViewId;
            }
            const id = newEventId();
            assistantViewId = id;
            this.update((s) => ({
              ...s,
              views: [...s.views, { id, kind: "assistant", text: "", streaming: true }],
            }));
            return id;
          },
          recordTool: (callId, name, summary) => {
            knownTools.set(callId, { id: newToolCallId(), toolName: name, summary });
          },
          knownTools,
          finishAssistant: () => {
            if (!assistantViewId) {
              return;
            }
            const id = assistantViewId;
            assistantViewId = null;
            this.update((s) => ({
              ...s,
              views: s.views.map((v) =>
                v.id === id && v.kind === "assistant" ? { ...v, streaming: false } : v,
              ),
            }));
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.pushError(message);
    } finally {
      this.currentAbort = null;
      this.update((s) => ({
        ...s,
        activity: { kind: "idle" },
        inputEnabled: !s.exited,
      }));
    }
  }

  /** Translate a single `AgentEvent` into store mutations. */
  private applyAgentEvent(
    event: AgentEvent,
    helpers: {
      getOrCreateAssistantView: () => string;
      recordTool: (callId: string, name: string, summary: string) => void;
      knownTools: Map<string, { id: string; toolName: string; summary: string }>;
      finishAssistant: () => void;
    },
  ): void {
    switch (event.kind) {
      case "turn_start":
        this.update((s) => ({ ...s, activity: { kind: "thinking" } }));
        return;
      case "thinking_delta": {
        this.update((s) => {
          const views = [...s.views];
          const last = views[views.length - 1];
          if (last && last.kind === "thinking" && last.streaming) {
            views[views.length - 1] = { ...last, text: last.text + event.delta };
          } else {
            views.push({
              id: newEventId(),
              kind: "thinking",
              text: event.delta,
              streaming: true,
            });
          }
          return { ...s, views };
        });
        return;
      }
      case "text_delta": {
        // Finalize any streaming thinking view before text starts.
        this.update((s) => {
          const views = s.views.map((v) =>
            v.kind === "thinking" && v.streaming ? { ...v, streaming: false } : v,
          );
          return { ...s, views };
        });
        const id = helpers.getOrCreateAssistantView();
        this.update((s) => ({
          ...s,
          views: s.views.map((v) =>
            v.id === id && v.kind === "assistant" ? { ...v, text: v.text + event.delta } : v,
          ),
        }));
        return;
      }
      case "tool_call": {
        // Finalize any streaming thinking view before tool call starts.
        this.update((s) => ({
          ...s,
          views: s.views.map((v) =>
            v.kind === "thinking" && v.streaming ? { ...v, streaming: false } : v,
          ),
        }));
        helpers.finishAssistant();
        const summary = renderCallSummary(event.call.name, event.call.input);
        helpers.recordTool(event.call.id, event.call.name, summary);
        const viewId = newEventId();
        this.update((s) => ({
          ...s,
          activity: {
            kind: "running_tool",
            toolName: event.call.name,
            summary,
          },
          views: [...s.views, { id: viewId, kind: "tool_call", call: event.call, summary }],
        }));
        return;
      }
      case "tool_result": {
        const known = helpers.knownTools.get(event.result.callId);
        const preview = renderResultPreview(event.result, known);
        const viewId = newEventId();
        this.update((s) => ({
          ...s,
          views: [
            ...s.views,
            event.result.ok
              ? {
                  id: viewId,
                  kind: "tool_result",
                  callId: event.result.callId,
                  ok: true,
                  preview,
                }
              : {
                  id: viewId,
                  kind: "tool_result",
                  callId: event.result.callId,
                  ok: false,
                  preview,
                  error: event.result.error,
                },
          ],
          activity: { kind: "thinking" },
        }));
        return;
      }
      case "turn_end":
        this.update((s) => ({ ...s, usage: addUsage(s.usage, event.usage) }));
        return;
      case "done":
        helpers.finishAssistant();
        return;
      case "error":
        this.pushError(event.error.message);
        return;
    }
  }

  /** Append a `system` view line. */
  private pushSystem(text: string): void {
    const id = newEventId();
    this.update((s) => ({ ...s, views: [...s.views, { id, kind: "system", text }] }));
  }

  /** Append an `error` view line. */
  private pushError(text: string): void {
    const id = newEventId();
    this.update((s) => ({ ...s, views: [...s.views, { id, kind: "error", text }] }));
  }

  /** Mutate state and notify subscribers. */
  private update(reducer: (current: TuiState) => TuiState): void {
    this.state = reducer(this.state);
    for (const listener of this.subscribers) {
      listener();
    }
  }
}

/** Append to history with deduplication of the most recent entry. */
function appendHistory(history: readonly string[], line: string): string[] {
  const last = history[history.length - 1];
  if (last === line) {
    return [...history];
  }
  const next = [...history, line];
  return next.length > 200 ? next.slice(next.length - 200) : next;
}

/** Sum two `TokenUsage` records, preserving optional fields. */
function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const out: TokenUsage = {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
  if (a.cacheReadTokens !== undefined || b.cacheReadTokens !== undefined) {
    out.cacheReadTokens = (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0);
  }
  if (a.cacheCreationTokens !== undefined || b.cacheCreationTokens !== undefined) {
    out.cacheCreationTokens = (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0);
  }
  return out;
}

/** Best-effort one-line summary of a tool call. */
function renderCallSummary(name: string, input: unknown): string {
  if (input && typeof input === "object") {
    const obj = input as Record<string, unknown>;
    if (typeof obj.path === "string") {
      return `${name}: ${obj.path}`;
    }
    if (typeof obj.command === "string") {
      return `${name}: ${obj.command}`;
    }
    if (typeof obj.pattern === "string") {
      return `${name}: ${obj.pattern}`;
    }
  }
  return name;
}

/** Best-effort one-line summary of a tool result. */
function renderResultPreview(
  result: { ok: boolean; output?: unknown; error?: { kind: string; message: string } },
  known: { toolName: string; summary: string } | undefined,
): string {
  if (!result.ok) {
    return known ? `${known.toolName}: ${known.summary}` : "tool failed";
  }
  if (typeof result.output === "string") {
    const head = result.output.split("\n")[0] ?? "";
    return known ? `${known.toolName}: ${truncate(head, 80)}` : truncate(head, 80);
  }
  return known ? `${known.toolName}: ${known.summary}` : "ok";
}

/** Truncate a string for the result preview. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Escape characters that have special meaning inside a permission glob, so
 * that `allow_always` rules match the *exact* call summary rather than
 * accidentally widening to a broader glob.
 */
function escapePattern(input: string): string {
  return input.replace(/[\\*?[\]{}!]/g, (ch) => `\\${ch}`);
}

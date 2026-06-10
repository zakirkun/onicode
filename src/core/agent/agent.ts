/**
 * Agent loop.
 *
 * One `Agent` instance owns one LLM context window. The loop is driven by
 * `send(userText, signal)`, which yields `AgentEvent`s as the conversation
 * progresses. The lifecycle of a single send:
 *
 *   1. Append the user's text to the context.
 *   2. **Round-trip loop** — until `stop` reason is `end_turn`, or
 *      `maxTurns` is reached:
 *        a. Build a `ChatRequest` from the current context.
 *        b. Stream the provider response, collecting text deltas and
 *           tool-use blocks.
 *        c. Append the assistant turn to the context (text + tool uses).
 *        d. If the stop reason is `tool_use`, run all tool calls in
 *           parallel via the executor; append results to the context;
 *           continue the loop.
 *        e. Otherwise, emit `done` and return.
 *   3. JSONL session entries are written at every step so a resumed
 *      session contains the full transcript.
 *
 * The agent is reusable: a single instance can serve many `send()` calls
 * within one TUI session, accumulating history across turns.
 */
import { buildRequest } from "./messageFormatter.js";
import { AgentContext } from "./agentContext.js";
import type { AgentConfig, AgentEvent, AgentResult } from "./types.js";
import type { LLMProvider } from "../../providers/types.js";
import type { ChatChunk, ChatContentBlock, StopReason, TokenUsage } from "../../providers/types.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Tool, ToolCall, ToolResult } from "../tools/types.js";
import type { SessionWriter } from "../session/writer.js";
import type { Logger } from "../../utils/logger.js";

/** Default cap on provider round-trips per `send()`. */
const DEFAULT_MAX_TURNS = 16;

/** Runtime dependencies wired into `Agent`. */
export interface AgentDeps {
  /** Provider used to stream completions. */
  provider: LLMProvider;
  /** Tool registry visible to this agent (full or filtered for sub-agents). */
  registry: ToolRegistry;
  /** Executor responsible for permission gating and tool dispatch. */
  executor: ToolExecutor;
  /** Session writer; pass `null` for in-memory-only agents (e.g. tests). */
  sessionWriter: SessionWriter | null;
  /** Pre-tagged child logger. */
  log: Logger;
}

/**
 * Driver for a single LLM context window. See module-level docstring for
 * the run lifecycle.
 */
export class Agent {
  private readonly config: AgentConfig;
  private readonly deps: AgentDeps;
  private readonly ctx = new AgentContext();

  constructor(config: AgentConfig, deps: AgentDeps) {
    this.config = config;
    this.deps = deps;
  }

  /** The agent's id (matches `AgentConfig.id`). */
  get id(): string {
    return this.config.id;
  }

  /**
   * Run a single user turn through the agent. Yields a stream of events
   * the caller can render (TUI) or log (headless mode). The returned
   * iterable always ends with either a `done` or `error` event.
   *
   * @param userText - the user's message.
   * @param signal - cancellation signal — aborts mid-stream.
   * @returns an async iterable of {@link AgentEvent}s ending with `done` or `error`.
   */
  async *send(userText: string, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const { provider, registry, sessionWriter, log } = this.deps;
    const maxTurns = this.config.maxTurns ?? DEFAULT_MAX_TURNS;
    const agentId = this.config.id;

    // Record the user turn before the first request so a crash mid-turn
    // still leaves the prompt in the JSONL.
    this.ctx.appendUser(userText);
    await sessionWriter?.userMessage(userText, agentId);

    let finalText = "";
    let lastStopReason: StopReason = "end_turn";

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        if (signal.aborted) {
          throw new Error("Agent send aborted by signal.");
        }

        yield { kind: "turn_start", agentId, turnIndex: turn };

        const req = buildRequest({
          model: this.config.model,
          systemPrompt: this.config.systemPrompt,
          messages: this.ctx.messages(),
          manifests: registry.manifests(),
          ...(this.config.temperature !== undefined
            ? { temperature: this.config.temperature }
            : {}),
          ...(this.config.maxOutputTokens !== undefined
            ? { maxOutputTokens: this.config.maxOutputTokens }
            : {}),
        });

        const turnState = new TurnState();

        for await (const chunk of provider.stream(req, signal)) {
          if (signal.aborted) {
            throw new Error("Agent send aborted by signal.");
          }
          for await (const event of this.handleChunk(chunk, turnState, agentId)) {
            yield event;
          }
        }

        // The stream guarantees a `stop` chunk; if it didn't arrive
        // (defensive) treat it as `error` to avoid an infinite loop.
        if (!turnState.stopReason) {
          throw new Error("Provider stream ended without a stop chunk.");
        }
        lastStopReason = turnState.stopReason;
        finalText = turnState.textBuffer;

        // Persist the assistant turn (text + tool_use) into the context.
        this.ctx.appendAssistant(turnState.assistantBlocks);
        this.ctx.addUsage(turnState.usage);
        yield {
          kind: "turn_end",
          agentId,
          turnIndex: turn,
          usage: turnState.usage,
        };

        // Stream any final-text marker so the writer knows the turn closed.
        if (turnState.textBuffer.length > 0) {
          await sessionWriter?.assistantText(turnState.textBuffer, {
            agentId,
            final: true,
          });
        }

        // No tool calls → conversation is done for this `send()`.
        if (turnState.toolCalls.length === 0 || lastStopReason !== "tool_use") {
          break;
        }

        // Run every tool call in parallel and append the results.
        const results = await this.runToolCalls(turnState.toolCalls, signal, agentId);
        for (const result of results) {
          yield { kind: "tool_result", agentId, result };
        }
        this.ctx.appendToolResults(results);
      }

      const result: AgentResult = {
        agentId,
        finalText,
        toolCalls: [...this.ctx.toolCalls()],
        usage: this.ctx.usage(),
        stopReason: lastStopReason,
      };
      yield { kind: "done", agentId, result };
    } catch (err) {
      log.error("agent send failed", { err });
      const message = err instanceof Error ? err.message : String(err);
      yield { kind: "error", agentId, error: { message } };
    }
  }

  /**
   * Process a single provider chunk, mutating `turnState` in place and
   * yielding any events that should be surfaced to the caller.
   */
  private async *handleChunk(
    chunk: ChatChunk,
    turnState: TurnState,
    agentId: string,
  ): AsyncIterable<AgentEvent> {
    switch (chunk.kind) {
      case "text":
        turnState.flushThinking();
        turnState.textBuffer += chunk.delta;
        await this.deps.sessionWriter?.assistantText(chunk.delta, { agentId });
        yield { kind: "text_delta", agentId, delta: chunk.delta };
        return;
      case "thinking":
        turnState.thinkingBuffer += chunk.delta;
        yield { kind: "thinking_delta", agentId, delta: chunk.delta };
        return;
      case "tool_call": {
        const call: ToolCall = { id: chunk.id, name: chunk.name, input: chunk.input };
        turnState.toolCalls.push(call);
        turnState.assistantBlocks.push({
          type: "tool_use",
          id: chunk.id,
          name: chunk.name,
          input: chunk.input,
        });
        this.ctx.recordToolCall(call);
        const tool = this.deps.registry.get(chunk.name);
        const summary = tool ? safeSummarize(tool, chunk.input) : undefined;
        await this.deps.sessionWriter?.toolCall({
          callId: chunk.id,
          toolName: chunk.name,
          input: chunk.input,
          ...(summary !== undefined ? { summary } : {}),
          agentId,
        });
        yield { kind: "tool_call", agentId, call };
        return;
      }
      case "stop":
        // Flush any trailing thinking before finalizing blocks.
        turnState.flushThinking();
        // Insert the buffered text as a single text block so the
        // assistant turn is well-formed when there are no tool calls.
        if (turnState.textBuffer.length > 0) {
          turnState.assistantBlocks.unshift({ type: "text", text: turnState.textBuffer });
        }
        turnState.stopReason = chunk.reason;
        turnState.usage = chunk.usage;
        return;
    }
  }

  /** Execute all tool calls of a turn in parallel and write their results. */
  private async runToolCalls(
    calls: readonly ToolCall[],
    signal: AbortSignal,
    agentId: string,
  ): Promise<ToolResult[]> {
    const results = await Promise.all(
      calls.map((call) => this.deps.executor.run(call, signal)),
    );
    for (const result of results) {
      if (result.ok) {
        await this.deps.sessionWriter?.toolResult({
          callId: result.callId,
          ok: true,
          output: result.output,
          agentId,
        });
      } else {
        await this.deps.sessionWriter?.toolResult({
          callId: result.callId,
          ok: false,
          error: { kind: result.error.kind, message: result.error.message },
          agentId,
        });
      }
    }
    return results;
  }
}

/** Mutable state accumulated during a single provider round-trip. */
class TurnState {
  textBuffer = "";
  thinkingBuffer = "";
  toolCalls: ToolCall[] = [];
  assistantBlocks: ChatContentBlock[] = [];
  stopReason: StopReason | null = null;
  usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  /** Flush accumulated thinking into a content block (if any). */
  flushThinking(): void {
    if (this.thinkingBuffer.length > 0) {
      this.assistantBlocks.push({ type: "thinking", thinking: this.thinkingBuffer });
      this.thinkingBuffer = "";
    }
  }
}

/** Defensive `tool.summarize` wrapper; mirrors the executor's helper. */
function safeSummarize(tool: Tool, input: unknown): string {
  try {
    return tool.summarize(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return `${tool.name} (summary unavailable: ${message})`;
  }
}

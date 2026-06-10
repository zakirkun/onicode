/**
 * Per-agent context container.
 *
 * Owns the canonical message history, the tool-call log, and the running
 * token-usage counter for a single agent. The agent loop appends to the
 * context as it runs; outsiders read snapshots via the accessor methods.
 *
 * The context is intentionally **not** thread-safe: an agent runs one turn
 * at a time, and concurrent mutation would scramble the LLM transcript.
 * Sub-agents have their own separate context instances.
 */
import type { ToolCall, ToolResult } from "../tools/types.js";
import type {
  ChatContentBlock,
  ChatMessage,
  TokenUsage,
} from "../../providers/types.js";

/** Container for an agent's message history and side-state. */
export class AgentContext {
  private readonly history: ChatMessage[] = [];
  private readonly calls: ToolCall[] = [];
  private aggregateUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  /** Read-only snapshot of the message history. */
  messages(): readonly ChatMessage[] {
    return this.history;
  }

  /** Read-only snapshot of all tool calls made so far. */
  toolCalls(): readonly ToolCall[] {
    return this.calls;
  }

  /** Current aggregated token usage. */
  usage(): TokenUsage {
    return { ...this.aggregateUsage };
  }

  /** Add the user's text as a new message. */
  appendUser(text: string): void {
    this.history.push({
      role: "user",
      content: [{ type: "text", text }],
    });
  }

  /**
   * Append the assistant's content blocks for a completed turn. Both the
   * text the model produced and any tool-use blocks share a single
   * assistant message — this is what Anthropic expects on the next turn
   * when responding to tool results.
   */
  appendAssistant(blocks: readonly ChatContentBlock[]): void {
    if (blocks.length === 0) {
      return;
    }
    this.history.push({
      role: "assistant",
      content: [...blocks],
    });
  }

  /**
   * Append the tool results for the previous turn as a single tool-role
   * message. Anthropic's chat-tools loop requires that all tool results
   * for a turn be delivered together in one user-role message; we emit
   * them under role `tool` and let the provider mapper fold them into
   * the user turn.
   */
  appendToolResults(results: readonly ToolResult[]): void {
    if (results.length === 0) {
      return;
    }
    const blocks: ChatContentBlock[] = results.map(toToolResultBlock);
    this.history.push({
      role: "tool",
      content: blocks,
    });
  }

  /** Record a tool call for the run-level audit trail. */
  recordToolCall(call: ToolCall): void {
    this.calls.push(call);
  }

  /** Add a per-turn usage delta into the aggregate. */
  addUsage(usage: TokenUsage): void {
    this.aggregateUsage = {
      inputTokens: this.aggregateUsage.inputTokens + usage.inputTokens,
      outputTokens: this.aggregateUsage.outputTokens + usage.outputTokens,
      ...(usage.cacheReadTokens !== undefined
        ? {
            cacheReadTokens:
              (this.aggregateUsage.cacheReadTokens ?? 0) + usage.cacheReadTokens,
          }
        : {}),
      ...(usage.cacheCreationTokens !== undefined
        ? {
            cacheCreationTokens:
              (this.aggregateUsage.cacheCreationTokens ?? 0) + usage.cacheCreationTokens,
          }
        : {}),
    };
  }
}

/** Convert a `ToolResult` into the canonical `tool_result` content block. */
function toToolResultBlock(result: ToolResult): ChatContentBlock {
  if (result.ok) {
    return {
      type: "tool_result",
      toolUseId: result.callId,
      content: serializeOutput(result.output),
    };
  }
  return {
    type: "tool_result",
    toolUseId: result.callId,
    content: `Error (${result.error.kind}): ${result.error.message}`,
    isError: true,
  };
}

/**
 * Serialize a tool's output into the string form the LLM expects in a
 * tool_result block. Strings pass through; everything else is JSON-encoded.
 */
function serializeOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

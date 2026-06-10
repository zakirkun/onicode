/**
 * OpenAI <-> OniCode message format mapper.
 *
 * Converts between OniCode's canonical message types (defined in
 * `../types.ts`) and the shapes accepted by the `openai` SDK
 * (`ChatCompletionMessageParam`, `ChatCompletionTool`). Keeping these
 * conversions in a single file makes it easy to snapshot-test the
 * mappings and to swap SDK versions without touching the agent loop.
 */
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";

import type { ChatMessage, StopReason } from "../types.js";
import type { ToolManifest } from "../../core/tools/types.js";

/**
 * Convert OniCode messages to the OpenAI message-param array.
 *
 * OpenAI accepts `user`, `assistant`, `tool`, and `system`/`developer`
 * roles in the messages array. Since OniCode extracts the system prompt
 * into the separate `system` parameter, system messages are dropped here.
 * Multiple text blocks are concatenated into a single string since OpenAI
 * user/assistant messages accept flat string content.
 *
 * @param messages - canonical message list.
 * @returns OpenAI-formatted message params.
 */
export function toOpenAIMessages(messages: readonly ChatMessage[]): ChatCompletionMessageParam[] {
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg): ChatCompletionMessageParam => {
      if (msg.role === "tool") {
        const toolResult = msg.content[0];
        if (toolResult?.type !== "tool_result") {
          throw new Error("Tool message must have tool_result content");
        }
        return {
          role: "tool",
          tool_call_id: toolResult.toolUseId,
          content: toolResult.content,
        } as ChatCompletionMessageParam;
      }
      const text = msg.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { type: "text"; text: string }).text)
        .join("");
      return {
        role: msg.role,
        content: text,
      } as ChatCompletionMessageParam;
    });
}

/**
 * Convert OniCode `ToolManifest` array to OpenAI tool definitions.
 *
 * OpenAI expects tools in the `function` calling format where the JSON
 * Schema lives under `function.parameters` rather than at the top level.
 *
 * @param manifests - tool manifests as produced by `ToolRegistry.manifests()`.
 */
export function toOpenAITools(manifests: readonly ToolManifest[]): ChatCompletionTool[] {
  return manifests.map((m) => ({
    type: "function" as const,
    function: {
      name: m.name,
      description: m.description,
      parameters: m.inputSchema,
    },
  }));
}

/** Map an OpenAI finish_reason string to OniCode's `StopReason`. */
export function mapOpenAIStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "stop_sequence";
    default:
      return "error";
  }
}

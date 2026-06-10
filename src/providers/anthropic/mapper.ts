/**
 * Anthropic <-> OniCode message format mapper.
 *
 * Converts between OniCode's canonical message types (defined in
 * `../types.ts`) and the shapes accepted by the `@anthropic-ai/sdk`
 * client. Keeping these conversions in a single file makes it easy to
 * snapshot-test the mappings and to swap SDK versions without touching
 * the agent loop.
 */
import type Anthropic from "@anthropic-ai/sdk";

import type { ChatContentBlock, ChatMessage, StopReason } from "../types.js";
import type { ToolManifest } from "../../core/tools/types.js";

/** SDK message-param shape (loosely typed; the SDK's own type is non-enumerable). */
type AnthropicMessageParam = Anthropic.Messages.MessageParam;
/** SDK tool definition shape. */
type AnthropicTool = Anthropic.Messages.Tool;

/**
 * Convert OniCode messages to the SDK's message-param array.
 *
 * Anthropic accepts only `user` and `assistant` roles in the messages
 * array (the system prompt is passed separately as `system`). Tool
 * messages are folded into the surrounding user turn as `tool_result`
 * blocks; system messages are dropped and the caller is expected to have
 * extracted them into the `system` field.
 *
 * @param messages - canonical message list.
 * @returns Anthropic-formatted message params.
 */
export function toAnthropicMessages(messages: readonly ChatMessage[]): AnthropicMessageParam[] {
  const out: AnthropicMessageParam[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      continue;
    }
    if (msg.role === "tool") {
      // Tool results are attached to the user turn as content blocks.
      out.push({
        role: "user",
        content: msg.content.map(toAnthropicContentBlock),
      });
      continue;
    }
    out.push({
      role: msg.role === "user" ? "user" : "assistant",
      content: msg.content.map(toAnthropicContentBlock),
    });
  }
  return out;
}

/** Convert one canonical content block to an Anthropic content block. */
function toAnthropicContentBlock(
  block: ChatContentBlock,
): Anthropic.Messages.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: (block.input ?? {}) as Record<string, unknown>,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.content,
        ...(block.isError ? { is_error: true } : {}),
      };
  }
}

/**
 * Convert an OniCode `ToolManifest` to the SDK's tool definition shape.
 *
 * Anthropic accepts a JSON Schema directly under `input_schema`; OniCode's
 * loose `JSONSchema = Record<string, unknown>` is structurally compatible
 * after a cast.
 *
 * @param manifests - tool manifests as produced by `ToolRegistry.manifests()`.
 */
export function toAnthropicTools(manifests: readonly ToolManifest[]): AnthropicTool[] {
  return manifests.map((m) => ({
    name: m.name,
    description: m.description,
    input_schema: m.inputSchema as AnthropicTool["input_schema"],
  }));
}

/** Map an Anthropic SDK stop reason string to OniCode's `StopReason`. */
export function mapStopReason(raw: string | null | undefined): StopReason {
  switch (raw) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "error";
  }
}

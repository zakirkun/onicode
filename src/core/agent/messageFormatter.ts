/**
 * Message formatter — assembles a `ChatRequest` from agent state.
 *
 * The agent loop calls `buildRequest(...)` once per provider round-trip.
 * The formatter is intentionally minimal — it copies fields into the
 * canonical request shape and applies optional defaults. Provider-specific
 * translation is the adapter's job (`providers/<name>/mapper.ts`).
 *
 * Future v0.x will add token-budget aware truncation here, dropping the
 * oldest tool-call cycles when `coordinator.perAgentTokenBudget` is
 * exceeded. The contract — input agent state, output `ChatRequest` — is
 * already correct for that extension.
 */
import type { ChatMessage, ChatRequest } from "../../providers/types.js";
import type { ToolManifest } from "../tools/types.js";

/** Inputs for {@link buildRequest}. */
export interface BuildRequestOptions {
  /** Provider model id. */
  model: string;
  /** System prompt — sent outside the messages array. */
  systemPrompt: string;
  /** Current message history. */
  messages: readonly ChatMessage[];
  /** Tool manifests advertised to the model. */
  manifests: readonly ToolManifest[];
  /** Optional sampling temperature. */
  temperature?: number;
  /** Optional output token cap. */
  maxOutputTokens?: number;
}

/**
 * Construct a provider-agnostic `ChatRequest` from agent state.
 *
 * The output is safe to hand directly to `LLMProvider.stream`.
 *
 * @param opts - request inputs.
 */
export function buildRequest(opts: BuildRequestOptions): ChatRequest {
  return {
    model: opts.model,
    system: opts.systemPrompt,
    messages: [...opts.messages],
    ...(opts.manifests.length > 0 ? { tools: opts.manifests } : {}),
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
  };
}

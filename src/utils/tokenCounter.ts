/**
 * Heuristic token counter.
 *
 * OniCode does not bundle a tokenizer (tiktoken, llama.cpp's BPE, ...)
 * because every supported provider has its own. Instead we use a simple
 * character-based approximation that is "good enough" for budget tracking
 * and UI display: empirically, modern BPE tokenizers (cl100k, tiktoken o200k,
 * Anthropic's tokenizer) hover around **3.5–4.5 characters per token** on
 * English code and prose.
 *
 * Callers that need exact counts (e.g. precise context-window enforcement)
 * should ask the provider via {@link LLMProvider.countTokens}; this helper
 * is for fast-path estimates only.
 */

/** Approximate character-to-token ratio used by {@link estimateTokens}. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the number of tokens a string represents under a typical BPE
 * tokenizer. Returns 0 for empty strings.
 *
 * @param text - text to estimate.
 * @returns approximate token count, never negative.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate total tokens across an array of strings, summing each entry.
 *
 * @param texts - strings to estimate.
 * @returns total approximate token count.
 */
export function estimateTokensTotal(texts: readonly string[]): number {
  let total = 0;
  for (const t of texts) {
    total += estimateTokens(t);
  }
  return total;
}

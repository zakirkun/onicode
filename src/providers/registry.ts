/**
 * Provider factory.
 *
 * Resolves a `ProviderId` plus its config into a constructed
 * {@link LLMProvider} instance. Encapsulates the secret-handling rules:
 *
 *   - The API key is read from the environment variable whose name is
 *     stored in `config.apiKeyEnv`. The env-var-by-name indirection keeps
 *     literal keys out of files on disk.
 *   - A missing or empty key throws — providers are never constructed
 *     with an unauthenticated client (except Ollama, which needs no key).
 *
 * Both OpenAI and Ollama share the {@link OpenAIProvider} adapter since
 * Ollama exposes an OpenAI-compatible `/v1/chat/completions` endpoint.
 */
import { AnthropicProvider } from "./anthropic/provider.js";
import { OpenAIProvider } from "./openai/provider.js";
import type { LLMProvider } from "./types.js";
import type { ProviderConfig, ProviderId } from "../config/types.js";
import type { Logger } from "../utils/logger.js";

/**
 * Construct a provider adapter.
 *
 * @param id - provider id from config.
 * @param config - per-provider config (api key env var, base URL).
 * @param log - logger inherited by the provider for diagnostics.
 * @returns ready-to-use provider.
 * @throws if the required env var is missing or the provider is not yet
 *         implemented.
 */
export function createProvider(
  id: ProviderId,
  config: ProviderConfig,
  log: Logger,
): LLMProvider {
  switch (id) {
    case "anthropic": {
      const apiKey = readApiKey(id, config);
      return new AnthropicProvider({
        apiKey,
        ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        log,
      });
    }
    case "openai": {
      const apiKey = readApiKey(id, config);
      return new OpenAIProvider({
        apiKey,
        ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        log,
      });
    }
    case "ollama":
      // Ollama needs no real API key; the OpenAI SDK requires a non-empty
      // string so we pass a placeholder. Ollama's OpenAI-compat endpoint
      // ignores the Authorization header entirely.
      return new OpenAIProvider({
        apiKey: "ollama",
        ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        log,
        id: "ollama",
      });
  }
}

/**
 * Read the API key for a provider from the environment variable referenced
 * by its config. Throws if the variable is unset or empty.
 */
function readApiKey(id: ProviderId, config: ProviderConfig): string {
  const envName = config.apiKeyEnv;
  if (!envName) {
    throw new Error(`Provider "${id}" config is missing apiKeyEnv.`);
  }
  const value = process.env[envName];
  if (!value || value.length === 0) {
    throw new Error(
      `Provider "${id}" requires environment variable ${envName} to be set.`,
    );
  }
  return value;
}

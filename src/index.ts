/**
 * Public library entrypoint for OniCode.
 *
 * Re-exports the stable, programmatic surface of OniCode so that the package
 * can be embedded in other tools (test harnesses, custom CLIs, web servers)
 * without having to import deep paths like `onicode/dist/core/agent/agent`.
 *
 * The CLI binary lives in `src/cli/index.ts` and is **not** re-exported here:
 * embedding the CLI would pull in React Ink and process-level side effects
 * that consumers of the library do not want.
 *
 * This file is the contract for what is considered public API. Anything not
 * re-exported here may change without a major version bump.
 */

// Logging
export {
  createLogger,
  NULL_LOGGER,
  type Logger,
  type LoggerOptions,
  type LogLevel,
  type LogMeta,
} from "./utils/logger.js";

// Identifier helpers
export { newAgentId, newEventId, newSessionId, newToolCallId } from "./utils/idgen.js";

// Path helpers
export {
  ensureDir,
  expandHome,
  projectConfigPath,
  projectSkillDir,
  resolveAgainst,
  userConfigPath,
  userRootDir,
  userSessionDir,
  userSkillDir,
} from "./utils/pathUtils.js";

// Retry helper
export { withRetry, type RetryOptions } from "./utils/retry.js";

// Token estimation
export { estimateTokens, estimateTokensTotal } from "./utils/tokenCounter.js";

// Frontmatter parser
export { parseFrontmatter, type ParsedFrontmatter } from "./utils/yamlFrontmatter.js";

// MCP client
export { McpManager } from "./core/mcp/manager.js";
export { adaptMcpTool, type McpToolDefinition, MCP_TOOL_NAME_PREFIX } from "./core/mcp/adapter.js";

// Providers
export {
  type LLMProvider,
  type ChatRequest,
  type ChatChunk,
  type ChatMessage,
  type ChatContentBlock,
  type TokenUsage,
  type StopReason,
  type Role,
} from "./providers/types.js";
export { AnthropicProvider, type AnthropicProviderOptions } from "./providers/anthropic/provider.js";
export { OpenAIProvider, type OpenAIProviderOptions } from "./providers/openai/provider.js";
export {
  toOpenAIMessages,
  toOpenAITools,
  mapOpenAIStopReason,
} from "./providers/openai/mapper.js";
export { createProvider } from "./providers/registry.js";

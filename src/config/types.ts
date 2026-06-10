/**
 * OniCode configuration types.
 *
 * The runtime shape of `onicode.config.json` (project) and
 * `~/.onicode/config.json` (user). The zod schema in `./schema.ts`
 * is the runtime source of truth; the types here are the compile-time
 * mirror — kept in sync via `z.infer<typeof OnicodeConfigSchema>`.
 *
 * These types are intentionally exposed as a separate file so that other
 * modules can import them without paying the parse-time cost of the zod
 * runtime in environments where validation is unnecessary (e.g. unit tests
 * that construct configs by hand).
 */
import type { LogLevel } from "../utils/logger.js";

/** Identifier of an LLM provider supported out of the box. */
export type ProviderId = "anthropic" | "openai" | "ollama";

/**
 * Permission mode controlling tool execution policy.
 *
 * - `default`: prompt the user for any tool call not explicitly allowed.
 * - `acceptEdits`: auto-allow edit-class tools (Write/Edit), still prompt for Bash etc.
 * - `plan`: plan-only — disallow all destructive tools; the agent may only read and propose.
 * - `bypassPermissions`: dangerous; auto-allow every tool. Used for trusted automation only.
 */
export type PermissionMode = "default" | "acceptEdits" | "plan" | "bypassPermissions";

/**
 * Provider-specific connection configuration.
 *
 * - `apiKeyEnv` is the **name of the environment variable** holding the API
 *   key, never the key itself. This keeps secrets out of disk-resident files.
 * - `baseUrl` overrides the default API endpoint (used by Ollama and by
 *   Anthropic-compatible proxies).
 */
export interface ProviderConfig {
  /** Name of the environment variable holding the API key. */
  apiKeyEnv?: string;
  /** Override the default API endpoint. */
  baseUrl?: string;
}

/** Allow / deny rule list and active mode. */
export interface PermissionsConfig {
  mode: PermissionMode;
  /**
   * Patterns that, when matched by a tool call, allow execution without a
   * prompt. Format: `ToolName(input-pattern)`. The input pattern is matched
   * against a tool-specific string (e.g. file path for Read/Write, full
   * command for Bash). Prefix the inner pattern with `re:` to use a regex.
   */
  allow: string[];
  /**
   * Patterns that, when matched, deny execution outright — even in
   * `bypassPermissions` mode. Use for hard safety bounds.
   */
  deny: string[];
}

/**
 * Configuration for an external MCP server that OniCode should launch and
 * connect to as a stdio child process.
 */
export interface McpServerConfig {
  /** Executable to spawn (e.g. "npx", "node", "uvx"). */
  command: string;
  /** Arguments passed to the executable. */
  args: string[];
  /** Optional environment variables to inject into the child process. */
  env?: Record<string, string>;
}

/** Where session JSONL files are written. */
export interface SessionConfig {
  /** Directory for session transcripts. Supports `~`. */
  dir: string;
}

/** Limits applied to the coordinator and its sub-agents. */
export interface CoordinatorConfig {
  /** Maximum number of sub-agents that may run in parallel. */
  maxConcurrentSubAgents: number;
  /**
   * Optional soft cap on a sub-agent's accumulated context token estimate.
   * When exceeded, the coordinator instructs the agent to summarize and
   * truncate. `undefined` disables the cap.
   */
  perAgentTokenBudget?: number;
}

/**
 * Top-level OniCode configuration. The full validated shape is loaded by
 * `src/config/loader.ts` from a merge of defaults + user config + project
 * config (later sources override earlier).
 */
export interface OnicodeConfig {
  /** Provider used when a skill does not specify one. */
  defaultProvider: ProviderId;
  /** Model used when a skill does not specify one. */
  defaultModel: string;
  /** Per-provider configuration. */
  providers: Record<ProviderId, ProviderConfig>;
  /** Permission mode and rules. */
  permissions: PermissionsConfig;
  /** External MCP servers, keyed by stable nickname. */
  mcpServers: Record<string, McpServerConfig>;
  /** Session storage. */
  session: SessionConfig;
  /** Coordinator and sub-agent limits. */
  coordinator: CoordinatorConfig;
  /** Logger verbosity. Default: `"info"`. */
  logLevel?: LogLevel;
}

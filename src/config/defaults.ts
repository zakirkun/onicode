/**
 * Built-in default OniCode configuration.
 *
 * The defaults here ship with the binary and represent a "safe out-of-the-box"
 * setup: Anthropic-primary, default permission mode (prompt for everything
 * non-trivial), and a conservative concurrency cap of 3 sub-agents.
 *
 * The loader merges these defaults with the user-level config
 * (`~/.onicode/config.json`) and the project-level config
 * (`<cwd>/onicode.config.json`), in that order. Later sources override
 * earlier ones.
 *
 * NOTE: Provider API keys are referenced by **environment-variable name**,
 * never embedded literally. This keeps secrets out of disk-resident files.
 */
import type { OnicodeConfig } from "./types.js";

/** Default OniCode configuration. Treated as immutable; never mutate at runtime. */
export const DEFAULT_CONFIG: OnicodeConfig = {
  defaultProvider: "anthropic",
  defaultModel: "claude-sonnet-4-20250514",
  providers: {
    anthropic: { apiKeyEnv: "ANTHROPIC_API_KEY" },
    openai: { apiKeyEnv: "OPENAI_API_KEY" },
    ollama: { baseUrl: "http://localhost:11434/v1" },
  },
  permissions: {
    mode: "default",
    // Read-only file inspection is allowed by default — equivalent to
    // letting the agent answer questions about the codebase without
    // blocking on each glob.
    allow: ["Read(**)", "Glob(**)", "Grep(**)"],
    deny: [],
  },
  mcpServers: {},
  session: {
    // `~` is expanded by the loader before the value reaches consumers.
    dir: "~/.onicode/sessions",
  },
  coordinator: {
    maxConcurrentSubAgents: 3,
  },
  logLevel: "info",
};

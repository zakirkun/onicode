/**
 * Runtime configuration manager.
 *
 * Wraps {@link OnicodeConfig} with mutation methods, change notification,
 * and optional persistence. Slash commands and the TUI use this to
 * change provider, model, and permission settings at runtime without
 * requiring a restart.
 *
 * The manager intentionally holds a shallow-copy snapshot of the config
 * rather than a reference to the original object — callers that retain
 * a reference to the initial config will not see mutations reflected
 * there. Subscribe via {@link RuntimeConfigManager.onChange} to react
 * to changes.
 */
import type { OnicodeConfig, ProviderId, PermissionMode } from "../../config/types.js";
import { loadConfig, type LoadConfigOptions } from "../../config/loader.js";
import type { Logger } from "../../utils/logger.js";

/**
 * Summary of what changed between two config snapshots. Handlers use
 * this to decide whether expensive rebuilds (provider swap) are needed
 * or whether a lighter-weight invalidation (model name) suffices.
 */
export interface ConfigDiff {
  providerChanged: boolean;
  modelChanged: boolean;
  mcpServersChanged: boolean;
  permissionsChanged: boolean;
}

/** Callback invoked when the runtime config changes. */
export type ConfigChangeHandler = (diff: ConfigDiff) => void;

/** Construction options for {@link RuntimeConfigManager}. */
export interface RuntimeConfigOptions {
  /** Initial config snapshot (typically the result of `loadConfig()`). */
  config: OnicodeConfig;
  /** Working directory passed to `loadConfig()` on {@link RuntimeConfigManager.reload}. */
  cwd: string;
  /** Logger for diagnostic messages. */
  log: Logger;
  /** Optional initial change handler (convenience for single-handler callers). */
  onChange?: ConfigChangeHandler;
}

/**
 * Manages the mutable runtime config. All mutations are synchronous
 * except `reload()` which re-reads from disk.
 */
export class RuntimeConfigManager {
  private config: OnicodeConfig;
  private readonly cwd: string;
  private readonly log: Logger;
  private readonly handlers = new Set<ConfigChangeHandler>();

  constructor(opts: RuntimeConfigOptions) {
    this.config = { ...opts.config };
    this.cwd = opts.cwd;
    this.log = opts.log.child({ component: "RuntimeConfigManager" });
    if (opts.onChange) {
      this.handlers.add(opts.onChange);
    }
  }

  /** Read the current config snapshot. Treat as immutable. */
  get current(): OnicodeConfig {
    return this.config;
  }

  /**
   * Subscribe to config changes. Returns the unsubscribe function.
   * The handler fires synchronously on every mutation.
   */
  onChange(handler: ConfigChangeHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Change the active model. No-op when the value is unchanged.
   *
   * @param model - model identifier (e.g. `"claude-opus-4-20250514"`).
   */
  setModel(model: string): void {
    if (model === this.config.defaultModel) {
      return;
    }
    this.config = { ...this.config, defaultModel: model };
    this.notify({
      providerChanged: false,
      modelChanged: true,
      mcpServersChanged: false,
      permissionsChanged: false,
    });
  }

  /**
   * Change the active LLM provider. No-op when the value is unchanged.
   *
   * @param id - provider identifier (`"anthropic"`, `"openai"`, `"ollama"`).
   */
  setProvider(id: ProviderId): void {
    if (id === this.config.defaultProvider) {
      return;
    }
    this.config = { ...this.config, defaultProvider: id };
    this.notify({
      providerChanged: true,
      modelChanged: false,
      mcpServersChanged: false,
      permissionsChanged: false,
    });
  }

  /**
   * Change the permission mode. No-op when the value is unchanged.
   *
   * @param mode - permission mode (`"default"`, `"acceptEdits"`, `"plan"`, `"bypassPermissions"`).
   */
  setMode(mode: PermissionMode): void {
    if (mode === this.config.permissions.mode) {
      return;
    }
    this.config = {
      ...this.config,
      permissions: { ...this.config.permissions, mode },
    };
    this.notify({
      providerChanged: false,
      modelChanged: false,
      mcpServersChanged: false,
      permissionsChanged: true,
    });
  }

  /**
   * Reload configuration from disk. Merges defaults + user + project
   * configs the same way the initial load does. Computes a diff between
   * the old and new configs and notifies handlers.
   *
   * @returns resolves when the config is reloaded and handlers notified.
   */
  async reload(): Promise<void> {
    const loadOpts: LoadConfigOptions = { cwd: this.cwd };
    const fresh = await loadConfig(loadOpts);
    const diff = computeDiff(this.config, fresh);
    this.config = fresh;
    this.notify(diff);
  }

  /** Fan out a change notification to all registered handlers. */
  private notify(diff: ConfigDiff): void {
    for (const handler of this.handlers) {
      try {
        handler(diff);
      } catch (err) {
        this.log.error("config change handler error", { err });
      }
    }
  }
}

/**
 * Compare two config snapshots and produce a {@link ConfigDiff}.
 *
 * Uses `JSON.stringify` for deep structural comparison of nested objects
 * (`mcpServers`, `permissions`). This is fine for config-sized payloads
 * where reference equality is unreliable.
 */
function computeDiff(prev: OnicodeConfig, next: OnicodeConfig): ConfigDiff {
  return {
    providerChanged: prev.defaultProvider !== next.defaultProvider,
    modelChanged: prev.defaultModel !== next.defaultModel,
    mcpServersChanged:
      JSON.stringify(prev.mcpServers) !== JSON.stringify(next.mcpServers),
    permissionsChanged:
      JSON.stringify(prev.permissions) !== JSON.stringify(next.permissions),
  };
}

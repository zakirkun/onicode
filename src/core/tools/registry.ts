/**
 * Tool registry.
 *
 * A name-indexed collection of {@link Tool} definitions. The registry is
 * the single source of truth for the executor and the agent: when the LLM
 * emits a tool call, the executor looks up the tool by name here; when the
 * agent serializes the available toolset for the LLM, it dumps `manifests()`
 * from here.
 *
 * The registry is intentionally simple — no plugin lifecycle, no observers.
 * Sub-agents that need a restricted toolset use `filter(allowList)` to
 * obtain a fresh registry view.
 */
import type { Tool, ToolManifest } from "./types.js";

/**
 * Registry of available tools. Names must be unique; re-registering an
 * existing name throws to surface the conflict at startup time.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /**
   * Register a tool. Throws if a tool with the same name is already
   * registered — overwriting silently would mask conflicts between
   * built-ins and MCP-imported tools.
   *
   * @param tool - tool definition.
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Look up a tool by name. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Check whether a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Number of registered tools. */
  size(): number {
    return this.tools.size;
  }

  /** All registered tools, in insertion order. */
  list(): readonly Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Manifests for all registered tools — the LLM-facing public surface.
   * The agent passes this directly to the provider as the tool list.
   */
  manifests(): readonly ToolManifest[] {
    return this.list().map(toManifest);
  }

  /**
   * Build a new registry containing only the tools whose names appear in
   * `allowList`. Names in the allow list that have no matching tool are
   * silently ignored — sub-agents that request unknown tools simply do
   * not get them, rather than failing to start.
   *
   * The filtered registry shares no state with the parent: registering a
   * new tool on either does not affect the other.
   *
   * @param allowList - names to keep.
   */
  filter(allowList: readonly string[]): ToolRegistry {
    const out = new ToolRegistry();
    for (const name of allowList) {
      const tool = this.tools.get(name);
      if (tool) {
        out.register(tool);
      }
    }
    return out;
  }
}

/** Reduce a `Tool` to its `ToolManifest`. */
function toManifest(tool: Tool): ToolManifest {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    source: tool.source,
  };
}

/**
 * Shared built-in tool registry factory.
 *
 * Both the `chat` and `run` CLI commands need an identical
 * `ToolRegistry` pre-loaded with the six v0.1 built-in tools.
 * This module is the single source of truth for that wiring,
 * eliminating the duplication that previously lived in each
 * command file.
 */
import { ToolRegistry } from "./registry.js";
import type { Tool } from "./types.js";
import { bashTool } from "../../tools/builtin/bash.js";
import { editTool } from "../../tools/builtin/edit.js";
import { globTool } from "../../tools/builtin/glob.js";
import { grepTool } from "../../tools/builtin/grep.js";
import { readTool } from "../../tools/builtin/read.js";
import { writeTool } from "../../tools/builtin/write.js";

/**
 * Construct a {@link ToolRegistry} pre-loaded with every v0.1 built-in tool.
 *
 * Registration order: read, write, edit, bash, glob, grep.
 * The `AgentSpawn` tool is registered separately by each command after
 * the coordinator is constructed (it requires a live coordinator reference).
 */
export function buildBuiltinRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  const builtins: readonly Tool[] = [readTool, writeTool, editTool, bashTool, globTool, grepTool];
  for (const tool of builtins) {
    registry.register(tool);
  }
  return registry;
}

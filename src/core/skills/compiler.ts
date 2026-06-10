/**
 * Skill compiler.
 *
 * Translates a validated {@link Skill} plus the parent's
 * runtime context into the inputs needed to construct an
 * {@link Agent}: a concrete `AgentConfig` and a filtered `ToolRegistry`.
 *
 * The compiler is pure — no I/O, no provider construction. The
 * coordinator owns provider selection and agent instantiation.
 */
import type { AgentConfig } from "../agent/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { Skill } from "./types.js";

/** Inputs to {@link compileSkill}. */
export interface CompileSkillInput {
  /** Skill the parent agent asked to spawn. */
  skill: Skill;
  /** Sub-agent id (allocated by the coordinator). */
  agentId: string;
  /** Default model used when the skill itself has no override. */
  defaultModel: string;
  /** Default provider id used when the skill has no override. */
  defaultProviderId: string;
  /** Parent registry from which a filtered view is derived. */
  parentRegistry: ToolRegistry;
}

/** Output of {@link compileSkill}. */
export interface CompiledSkill {
  config: AgentConfig;
  registry: ToolRegistry;
}

/**
 * Compile a skill into the agent + registry pair the coordinator needs.
 *
 * @param input - compile options.
 */
export function compileSkill(input: CompileSkillInput): CompiledSkill {
  const { skill, agentId, defaultModel, defaultProviderId, parentRegistry } = input;

  const registry =
    skill.allowedTools && skill.allowedTools.length > 0
      ? parentRegistry.filter(skill.allowedTools)
      : parentRegistry;

  const config: AgentConfig = {
    id: agentId,
    model: skill.model ?? defaultModel,
    providerId: skill.provider ?? defaultProviderId,
    systemPrompt: skill.body,
    ...(skill.temperature !== undefined ? { temperature: skill.temperature } : {}),
    ...(skill.maxOutputTokens !== undefined ? { maxOutputTokens: skill.maxOutputTokens } : {}),
  };

  return { config, registry };
}

/**
 * Skill types.
 *
 * A "skill" is a Markdown file with YAML frontmatter that compiles into
 * an `AgentConfig` for a sub-agent. The frontmatter captures the
 * machine-readable metadata (name, description, model, allowed tools,
 * temperature) and the body is the system prompt.
 *
 * Discovery is driven by `SkillLoader`, validation by zod (in
 * `./schema.ts`), compilation by `compiler.ts`. The agent never sees
 * `Skill` directly — it only consumes the compiled `AgentConfig` plus a
 * filtered `ToolRegistry`.
 */
import type { ProviderId } from "../../config/types.js";

/** Where the skill came from on disk. */
export type SkillScope = "builtin" | "user" | "project";

/** Source pointer for a skill — where the file lives, which scope owns it. */
export interface SkillSource {
  /** Absolute path to the SKILL.md file. */
  path: string;
  /** Scope this skill belongs to. */
  scope: SkillScope;
}

/**
 * Validated skill record.
 *
 * `body` is the Markdown system prompt with leading whitespace trimmed.
 * `allowedTools` is a name list applied as a filter against the parent
 * registry; `undefined` means inherit the parent's full registry.
 */
export interface Skill {
  /** Unique skill name. Used by `AgentSpawn` to look up the skill. */
  name: string;
  /** One-paragraph description, surfaced to the spawning agent's LLM. */
  description: string;
  /** Markdown body — used verbatim as the sub-agent's system prompt. */
  body: string;
  /** Optional model override (overrides the parent's model when set). */
  model?: string;
  /** Optional provider override (rare; mostly for routing experiments). */
  provider?: ProviderId;
  /** Optional sampling temperature override. */
  temperature?: number;
  /** Optional output token cap override. */
  maxOutputTokens?: number;
  /** Optional allow-list of tools the sub-agent may use. */
  allowedTools?: readonly string[];
  /** Source location of the skill. */
  source: SkillSource;
}

/**
 * Skill registry.
 *
 * In-memory map of skill name → `Skill`. Population order:
 *
 *   1. `builtin`  — bundled skills shipped with the binary.
 *   2. `user`     — `~/.onicode/skills/**`.
 *   3. `project`  — `<cwd>/.onicode/skills/**`.
 *
 * Later scopes override earlier ones, so a project may shadow a user or
 * builtin skill simply by reusing the name. Conflicts within a single
 * scope (two files declaring the same `name`) throw to surface the bug.
 */
import type { Skill, SkillScope } from "./types.js";

/** A name-keyed catalog of skills. */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  /**
   * Register a skill, overriding any existing entry with the same name
   * when the new scope has higher precedence than the existing one.
   *
   * @param skill - skill to register.
   * @returns `true` when the skill was added or replaced an entry,
   *          `false` when a higher-precedence skill already won.
   */
  register(skill: Skill): boolean {
    const existing = this.skills.get(skill.name);
    if (!existing) {
      this.skills.set(skill.name, skill);
      return true;
    }
    if (scopeRank(skill.source.scope) >= scopeRank(existing.source.scope)) {
      this.skills.set(skill.name, skill);
      return true;
    }
    return false;
  }

  /** Look up a skill by name. */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /** Whether a skill with this name is registered. */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** Number of skills in the registry. */
  size(): number {
    return this.skills.size;
  }

  /** All skills, sorted alphabetically by name. */
  list(): readonly Skill[] {
    return Array.from(this.skills.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
}

/**
 * Numeric precedence: project > user > builtin. Used in `register` so
 * lower-precedence reloads do not clobber higher-precedence overrides.
 */
function scopeRank(scope: SkillScope): number {
  switch (scope) {
    case "builtin":
      return 0;
    case "user":
      return 1;
    case "project":
      return 2;
  }
}

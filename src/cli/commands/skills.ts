/**
 * `skills` subcommand.
 *
 * Discovers and lists available skills from all scopes (builtin, user,
 * project). When invoked without arguments, prints a summary table. When
 * given a skill name, prints the full frontmatter and body.
 *
 * This is a diagnostic command — it does not spawn agents or contact
 * providers. Useful for verifying that custom skills are discovered and
 * parsed correctly before relying on them via `AgentSpawn`.
 */
import { loadConfig } from "../../config/loader.js";
import { loadSkills } from "../../core/skills/loader.js";
import type { Skill } from "../../core/skills/types.js";
import { createLogger } from "../../utils/logger.js";
import type { ParsedArgs } from "../args.js";

/**
 * Run the `skills` subcommand. Prints skill information to stdout.
 *
 * @param args - parsed CLI arguments. `args.prompt` is reused as the
 *               optional skill name to inspect (when omitted, list all).
 * @returns process exit code.
 */
export async function runSkills(args: ParsedArgs): Promise<number> {
  const log = createLogger({
    level: args.debug ? "debug" : "warn",
    base: { component: "cli.skills" },
  });

  try {
    await loadConfig({ cwd: process.cwd() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`onicode skills: failed to load config: ${msg}\n`);
    return 1;
  }

  const registry = await loadSkills({ log, cwd: process.cwd() });
  const skills = registry.list();

  if (skills.length === 0) {
    process.stdout.write("No skills discovered.\n");
    process.stdout.write("\nSkill directories searched:\n");
    process.stdout.write("  builtin: <install>/skills/\n");
    process.stdout.write("  user:    ~/.onicode/skills/\n");
    process.stdout.write("  project: <cwd>/.onicode/skills/\n");
    return 0;
  }

  // If a specific skill name was provided, show full detail.
  if (args.prompt) {
    const skill = registry.get(args.prompt);
    if (!skill) {
      process.stderr.write(`onicode skills: unknown skill "${args.prompt}".\n`);
      process.stderr.write(`Available: ${skills.map((s) => s.name).join(", ")}\n`);
      return 1;
    }
    printSkillDetail(skill);
    return 0;
  }

  // List all skills as a summary table.
  process.stdout.write(`Discovered ${skills.length} skill(s):\n\n`);
  for (const skill of skills) {
    const scope = skill.source.scope;
    const model = skill.model ?? "(default)";
    const tools = skill.allowedTools
      ? skill.allowedTools.join(", ")
      : "(all)";
    process.stdout.write(`  ${skill.name} [${scope}]\n`);
    process.stdout.write(`    ${skill.description.trim().split("\n")[0]}\n`);
    process.stdout.write(`    model: ${model}  tools: ${tools}\n`);
    process.stdout.write(`    path:  ${skill.source.path}\n\n`);
  }

  process.stdout.write(
    'Use `onicode skills -p "<name>"` to see a skill\'s full body.\n',
  );
  return 0;
}

/** Print full detail for a single skill. */
function printSkillDetail(skill: Skill): void {
  process.stdout.write(`Skill: ${skill.name}\n`);
  process.stdout.write(`Scope: ${skill.source.scope}\n`);
  process.stdout.write(`Path:  ${skill.source.path}\n`);
  process.stdout.write(`Description:\n  ${skill.description.trim()}\n`);

  if (skill.model !== undefined) {
    process.stdout.write(`Model: ${skill.model}\n`);
  }
  if (skill.provider !== undefined) {
    process.stdout.write(`Provider: ${skill.provider}\n`);
  }
  if (skill.temperature !== undefined) {
    process.stdout.write(`Temperature: ${skill.temperature}\n`);
  }
  if (skill.maxOutputTokens !== undefined) {
    process.stdout.write(`Max output tokens: ${skill.maxOutputTokens}\n`);
  }
  if (skill.allowedTools !== undefined) {
    process.stdout.write(`Allowed tools: ${skill.allowedTools.join(", ")}\n`);
  }

  process.stdout.write(`\n--- Body ---\n${skill.body}\n`);
}

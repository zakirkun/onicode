/**
 * Skill loader.
 *
 * Discovers SKILL.md files on disk and parses them into validated
 * {@link Skill} records, then loads them into a {@link SkillRegistry}.
 *
 * File pattern: `**\/*.skill.md` under each scope directory.
 *
 * Discovery scopes (later scopes take precedence; see registry):
 *   - **builtin**: `<bundleDir>/skills/`. Resolved relative to the
 *     compiled `dist/cli.js`. Falls back to a sibling `skills/` directory
 *     during development.
 *   - **user**:    `~/.onicode/skills/`.
 *   - **project**: `<cwd>/.onicode/skills/`.
 *
 * Parse failures (invalid frontmatter, missing required fields) are
 * logged and skipped — one bad skill must not prevent the others from
 * loading.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import fastGlob from "fast-glob";

import { SkillFrontmatterSchema } from "./schema.js";
import { SkillRegistry } from "./registry.js";
import type { Skill, SkillScope, SkillSource } from "./types.js";
import { parseFrontmatter } from "../../utils/yamlFrontmatter.js";
import {
  projectSkillDir,
  userSkillDir,
} from "../../utils/pathUtils.js";
import type { Logger } from "../../utils/logger.js";

/** Construction options for {@link SkillLoader}. */
export interface SkillLoaderOptions {
  /** Logger used to record per-file parse failures. */
  log: Logger;
  /**
   * Override the bundled-skill discovery root. When omitted, the loader
   * resolves it from the compiled module location.
   */
  builtinDir?: string;
  /** Override the user skill directory (typically for tests). */
  userDir?: string;
  /** Override the project skill directory (typically for tests). */
  projectDir?: string;
  /**
   * Override the working directory used to compute the default project
   * skill directory. Ignored when `projectDir` is supplied.
   */
  cwd?: string;
}

/**
 * Load every discoverable SKILL.md file into a fresh registry. Returns
 * an empty registry when no skill files exist.
 *
 * @param opts - loader options.
 */
export async function loadSkills(opts: SkillLoaderOptions): Promise<SkillRegistry> {
  const registry = new SkillRegistry();
  const builtinDir = opts.builtinDir ?? defaultBuiltinDir();
  const userDir = opts.userDir ?? userSkillDir();
  const projectDir = opts.projectDir ?? projectSkillDir(opts.cwd ?? process.cwd());

  // Order matters: load builtin first so project / user can override it.
  await loadScope(registry, builtinDir, "builtin", opts.log);
  await loadScope(registry, userDir, "user", opts.log);
  await loadScope(registry, projectDir, "project", opts.log);

  return registry;
}

/** Glob and parse every `*.skill.md` file under `dir`. Missing dirs are silent. */
async function loadScope(
  registry: SkillRegistry,
  dir: string,
  scope: SkillScope,
  log: Logger,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fastGlob("**/*.skill.md", {
      cwd: dir,
      absolute: true,
      dot: false,
      onlyFiles: true,
      followSymbolicLinks: false,
    });
  } catch (err) {
    log.debug("skill scope unavailable", { dir, scope, err: describe(err) });
    return;
  }

  for (const filePath of entries) {
    try {
      const skill = await parseSkillFile(filePath, scope);
      registry.register(skill);
    } catch (err) {
      log.warn("skipping invalid skill", { filePath, scope, err: describe(err) });
    }
  }
}

/**
 * Read and validate a single skill file. Throws on any failure — the
 * caller logs and skips so one bad file does not block the rest.
 */
async function parseSkillFile(filePath: string, scope: SkillScope): Promise<Skill> {
  const raw = await readFile(filePath, "utf8");
  const { data, body } = parseFrontmatter(raw);
  const fm = SkillFrontmatterSchema.parse(data);

  const allowedTools = normalizeAllowedTools(fm.allowedTools);
  const source: SkillSource = { path: filePath, scope };

  const skill: Skill = {
    name: fm.name,
    description: fm.description,
    body: body.trim(),
    source,
    ...(fm.model !== undefined ? { model: fm.model } : {}),
    ...(fm.provider !== undefined ? { provider: fm.provider } : {}),
    ...(fm.temperature !== undefined ? { temperature: fm.temperature } : {}),
    ...(fm.maxOutputTokens !== undefined ? { maxOutputTokens: fm.maxOutputTokens } : {}),
    ...(allowedTools !== undefined ? { allowedTools } : {}),
  };

  if (skill.body.length === 0) {
    throw new Error(`Skill body is empty: ${filePath}`);
  }
  return skill;
}

/**
 * Normalize the `allowedTools` field into a deduplicated string array.
 *
 * The frontmatter accepts either a real YAML array (`[Read, Glob]`) or a
 * comma-separated string. Both are common in hand-edited markdown.
 */
function normalizeAllowedTools(
  value: string | string[] | undefined,
): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  const list = Array.isArray(value) ? value : value.split(",");
  const cleaned = list.map((s) => s.trim()).filter((s) => s.length > 0);
  if (cleaned.length === 0) {
    return undefined;
  }
  return Array.from(new Set(cleaned));
}

/**
 * Resolve the bundled-skill directory. In production, the binary lives at
 * `<install>/dist/cli.js` and bundled skills live at `<install>/skills/`.
 * During development with `tsup --watch` the layout is the same, so the
 * default is to walk one directory up from the running module.
 */
function defaultBuiltinDir(): string {
  // `import.meta.url` points at the running module file. Resolving `../skills`
  // from there yields `<install>/skills` regardless of platform.
  const here = fileURLToPath(import.meta.url);
  // `here` resolves to `dist/cli.js` in production (bundled by tsup).
  // `../skills` from `dist/` yields `<install>/skills`.
  return path.resolve(path.dirname(here), "..", "skills");
}

/** Render any thrown value as a printable string. */
function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Configuration loader.
 *
 * Resolves the effective {@link OnicodeConfig} by merging three sources, in
 * order of increasing precedence:
 *
 *   1. **Defaults**  — `DEFAULT_CONFIG` shipped with the binary.
 *   2. **User**      — `~/.onicode/config.json`, if present.
 *   3. **Project**   — `<cwd>/onicode.config.json`, if present.
 *
 * The loader validates each source against `PartialOnicodeConfigSchema`
 * before merging, then validates the merged result against the strict
 * `OnicodeConfigSchema`. This guarantees that callers downstream never see
 * an invalid config, but still produces precise error messages pointing
 * at the offending file when validation fails.
 *
 * Path expansion (`~`) is applied to `session.dir` after merging so that
 * downstream consumers can use the value verbatim.
 */
import { readFile } from "node:fs/promises";

import { DEFAULT_CONFIG } from "./defaults.js";
import { OnicodeConfigSchema, PartialOnicodeConfigSchema } from "./schema.js";
import type { OnicodeConfig } from "./types.js";
import { expandHome, projectConfigPath, userConfigPath } from "../utils/pathUtils.js";

/** Options accepted by {@link loadConfig}. */
export interface LoadConfigOptions {
  /** Current working directory used to locate the project-level config file. */
  cwd: string;
  /** Override the default user config file path (mainly for tests). */
  userConfigPath?: string;
  /** Override the default project config file path (mainly for tests). */
  projectConfigPath?: string;
}

/**
 * Load and validate the effective OniCode configuration.
 *
 * @param opts - loader options.
 * @returns fully validated, fully merged config object.
 * @throws if any source file is invalid JSON or fails schema validation.
 */
export async function loadConfig(opts: LoadConfigOptions): Promise<OnicodeConfig> {
  const userPath = opts.userConfigPath ?? userConfigPath();
  const projectPath = opts.projectConfigPath ?? projectConfigPath(opts.cwd);

  const userPartial = await readPartial(userPath, "user");
  const projectPartial = await readPartial(projectPath, "project");

  const merged = mergeConfigs(DEFAULT_CONFIG, userPartial, projectPartial);
  // The zod-inferred type widens optional fields to `T | undefined`, while
  // our static `OnicodeConfig` uses exact-optional semantics. Cast through
  // `unknown` after parsing so the static surface stays clean for callers.
  const validated = OnicodeConfigSchema.parse(merged) as unknown as OnicodeConfig;

  // Expand `~` in path-bearing fields so the rest of the codebase can treat
  // them as fully-resolved.
  validated.session.dir = expandHome(validated.session.dir);

  return validated;
}

/**
 * Read and validate a partial config file. Missing files are treated as an
 * empty partial — the absence of a config file is not an error.
 *
 * @param filePath - absolute path to the partial config JSON.
 * @param scope - human-readable label used to enrich error messages.
 */
async function readPartial(
  filePath: string,
  scope: "user" | "project",
): Promise<Partial<OnicodeConfig>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err: unknown) {
    if (isFileNotFound(err)) {
      return {};
    }
    throw new Error(`Failed to read ${scope} config at ${filePath}: ${describeError(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON in ${scope} config (${filePath}): ${describeError(err)}`);
  }

  const result = PartialOnicodeConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid ${scope} config (${filePath}):\n${formatZodIssues(result.error.issues)}`,
    );
  }
  return result.data as Partial<OnicodeConfig>;
}

/**
 * Deep-merge config layers. Plain objects are merged recursively; arrays
 * and primitives are replaced by the higher-precedence source.
 */
function mergeConfigs(
  base: OnicodeConfig,
  ...overrides: Partial<OnicodeConfig>[]
): OnicodeConfig {
  let acc: OnicodeConfig = structuredClone(base);
  for (const override of overrides) {
    acc = deepMerge(acc, override) as OnicodeConfig;
  }
  return acc;
}

/** Deep-merge object trees. Arrays and non-plain values are replaced wholesale. */
function deepMerge<T>(base: T, override: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : (override as T)) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }
    const current = out[key];
    out[key] =
      isPlainObject(current) && isPlainObject(value)
        ? deepMerge(current, value as Record<string, unknown>)
        : value;
  }
  return out as T;
}

/** Predicate: true for plain `{...}` objects (not arrays, not class instances). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** Detect Node's "file not found" error in a way that survives polyfills. */
function isFileNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

/** Render an unknown thrown value as a readable string. */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/** Collapse zod issues into a one-issue-per-line string. */
function formatZodIssues(
  issues: ReadonlyArray<{ path: (string | number)[]; message: string }>,
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `  - ${path}: ${issue.message}`;
    })
    .join("\n");
}

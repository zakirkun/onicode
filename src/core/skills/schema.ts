/**
 * Skill frontmatter validation schema.
 *
 * The frontmatter is parsed into an untyped `Record<string, unknown>` by
 * `gray-matter`, then validated here before being shaped into a `Skill`.
 *
 * Field rules:
 *   - `name` and `description` are required.
 *   - `model`, `provider`, `temperature`, `maxOutputTokens` are optional.
 *   - `allowedTools` may be `undefined` (inherit parent toolset) or an
 *     array of tool names. We allow `string` as a convenience and split on
 *     commas in the caller.
 */
import { z } from "zod";

import { ProviderIdSchema } from "../../config/schema.js";

/**
 * Accept YAML `null` (from `~`) or absent field, both mapping to
 * `undefined` so downstream `...(v !== undefined ? {k: v} : {})` skips
 * the field cleanly.
 */
const yamlOptional = <T extends z.ZodTypeAny>(schema: T) =>
  schema.optional().nullable().transform((v) => (v == null ? undefined : v));

/** Frontmatter validated shape. */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, {
    message: "name must contain only letters, digits, dashes, underscores",
  }),
  description: z.string().min(1),
  model: yamlOptional(z.string().min(1)),
  provider: yamlOptional(ProviderIdSchema),
  temperature: yamlOptional(z.number().min(0).max(2)),
  maxOutputTokens: yamlOptional(z.number().int().positive()),
  allowedTools: yamlOptional(z.union([z.array(z.string().min(1)), z.string().min(1)])),
});

/** Inferred type for static use. */
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

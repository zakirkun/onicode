/**
 * Zod schema for OniCode configuration.
 *
 * The schema is the runtime source of truth: the static types in
 * `./types.ts` are aligned with `z.infer<typeof OnicodeConfigSchema>`. When
 * the schema changes, the types must be updated to match (this is verified
 * at compile-time by the type-equivalence assertion at the bottom of this
 * file).
 *
 * `PartialOnicodeConfigSchema` is exported separately so user / project
 * config files can omit fields they want to inherit from defaults.
 */
import { z } from "zod";

import type {
  CoordinatorConfig,
  McpServerConfig,
  OnicodeConfig,
  PermissionMode,
  PermissionsConfig,
  ProviderConfig,
  ProviderId,
  SessionConfig,
} from "./types.js";

/** Allowed provider ids. Extending this requires also adding an adapter. */
export const ProviderIdSchema = z.enum(["anthropic", "openai", "ollama"]);

/** Allowed permission modes. */
export const PermissionModeSchema = z.enum([
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
]);

/** Per-provider connection configuration. */
export const ProviderConfigSchema = z
  .object({
    apiKeyEnv: z.string().min(1).optional(),
    baseUrl: z.string().url().optional(),
  })
  .strict();

/** Permission mode + allow / deny rule arrays. */
export const PermissionsConfigSchema = z
  .object({
    mode: PermissionModeSchema,
    allow: z.array(z.string()).default([]),
    deny: z.array(z.string()).default([]),
  })
  .strict();

/** External MCP server stdio launch spec. */
export const McpServerConfigSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
  })
  .strict();

/** Session-storage configuration. */
export const SessionConfigSchema = z
  .object({
    dir: z.string().min(1),
  })
  .strict();

/** Coordinator and sub-agent limits. */
export const CoordinatorConfigSchema = z
  .object({
    maxConcurrentSubAgents: z.number().int().positive().max(64),
    perAgentTokenBudget: z.number().int().positive().optional(),
  })
  .strict();

/** Top-level OniCode configuration. */
export const OnicodeConfigSchema = z
  .object({
    defaultProvider: ProviderIdSchema,
    defaultModel: z.string().min(1),
    providers: z.record(ProviderIdSchema, ProviderConfigSchema),
    permissions: PermissionsConfigSchema,
    mcpServers: z.record(z.string().min(1), McpServerConfigSchema).default({}),
    session: SessionConfigSchema,
    coordinator: CoordinatorConfigSchema,
    logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  })
  .strict();

/**
 * Deep-partial variant accepted from user / project config files.
 *
 * Each user supplies only the fields they care about; the loader merges
 * the partial with `defaults` and validates the merged shape against
 * `OnicodeConfigSchema`.
 */
export const PartialOnicodeConfigSchema = z
  .object({
    defaultProvider: ProviderIdSchema.optional(),
    defaultModel: z.string().min(1).optional(),
    providers: z.record(ProviderIdSchema, ProviderConfigSchema).optional(),
    permissions: PermissionsConfigSchema.partial().optional(),
    mcpServers: z.record(z.string().min(1), McpServerConfigSchema).optional(),
    session: SessionConfigSchema.partial().optional(),
    coordinator: CoordinatorConfigSchema.partial().optional(),
    logLevel: z.enum(["debug", "info", "warn", "error"]).optional(),
  })
  .strict();

/** Compile-time check that the zod inferred type matches the static type. */
type _ProviderIdCheck = z.infer<typeof ProviderIdSchema> extends ProviderId ? true : never;
type _PermissionModeCheck =
  z.infer<typeof PermissionModeSchema> extends PermissionMode ? true : never;
type _ProviderConfigCheck =
  z.infer<typeof ProviderConfigSchema> extends ProviderConfig ? true : never;
type _PermissionsConfigCheck =
  z.infer<typeof PermissionsConfigSchema> extends PermissionsConfig ? true : never;
type _McpServerConfigCheck =
  z.infer<typeof McpServerConfigSchema> extends McpServerConfig ? true : never;
type _SessionConfigCheck =
  z.infer<typeof SessionConfigSchema> extends SessionConfig ? true : never;
type _CoordinatorConfigCheck =
  z.infer<typeof CoordinatorConfigSchema> extends CoordinatorConfig ? true : never;
type _OnicodeConfigCheck =
  z.infer<typeof OnicodeConfigSchema> extends OnicodeConfig ? true : never;

// Reference the helper aliases so `noUnusedLocals` does not complain.
type _Aliases = [
  _ProviderIdCheck,
  _PermissionModeCheck,
  _ProviderConfigCheck,
  _PermissionsConfigCheck,
  _McpServerConfigCheck,
  _SessionConfigCheck,
  _CoordinatorConfigCheck,
  _OnicodeConfigCheck,
];
export type _ConfigSchemaCheck = _Aliases;

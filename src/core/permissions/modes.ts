/**
 * Per-mode permission policy table.
 *
 * The gate consults this table after the deny list and before the allow list
 * to determine the **default** decision for a tool call when no explicit
 * rule has matched. Each mode is a flag set; the gate composes them into a
 * decision in `gate.ts`.
 *
 * Modes are defined in `src/config/types.ts`. Adding a new mode requires
 * extending both the type and this table.
 */
import type { PermissionMode } from "./types.js";

/**
 * Mode-specific defaults for tool calls that match neither allow nor deny.
 *
 * - `autoAllowNonDestructive`: read-only tools (`destructive=false`) auto-allow.
 * - `autoAllowDestructive`: destructive tools auto-allow (dangerous; only for
 *   `bypassPermissions`).
 * - `autoDenyDestructive`: destructive tools auto-deny without prompting (for
 *   `plan` mode, where the agent should never mutate state).
 * - `promptOnDestructive`: destructive tools prompt the user when neither
 *   allow nor deny matches.
 * - `promptOnNonDestructive`: non-destructive tools prompt the user when
 *   neither allow nor deny matches.
 */
export interface ModePolicy {
  autoAllowNonDestructive: boolean;
  autoAllowDestructive: boolean;
  autoDenyDestructive: boolean;
  promptOnDestructive: boolean;
  promptOnNonDestructive: boolean;
}

/** Mode policies. Treated as immutable. */
export const MODE_POLICIES: Record<PermissionMode, ModePolicy> = {
  // Default: prompt for everything not explicitly allowed.
  default: {
    autoAllowNonDestructive: false,
    autoAllowDestructive: false,
    autoDenyDestructive: false,
    promptOnDestructive: true,
    promptOnNonDestructive: true,
  },

  // Accept-edits: auto-allow non-destructive and destructive edit-class tools.
  // The deny list still applies (enforced by gate.ts), so users keep hard
  // safety bounds via `Bash(rm -rf *)` or similar.
  acceptEdits: {
    autoAllowNonDestructive: true,
    autoAllowDestructive: true,
    autoDenyDestructive: false,
    promptOnDestructive: false,
    promptOnNonDestructive: false,
  },

  // Plan: read-only mode. Reading is free; any destructive call is denied.
  plan: {
    autoAllowNonDestructive: true,
    autoAllowDestructive: false,
    autoDenyDestructive: true,
    promptOnDestructive: false,
    promptOnNonDestructive: false,
  },

  // Bypass: dangerous; allow every call. Deny list still wins (enforced by gate).
  bypassPermissions: {
    autoAllowNonDestructive: true,
    autoAllowDestructive: true,
    autoDenyDestructive: false,
    promptOnDestructive: false,
    promptOnNonDestructive: false,
  },
};

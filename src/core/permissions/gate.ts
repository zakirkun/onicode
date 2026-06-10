/**
 * Permission gate.
 *
 * The gate is a pure decision function. It composes:
 *   1. The configured **deny** rule list (highest priority — wins even in
 *      `bypassPermissions` mode).
 *   2. The active mode's policy (`MODE_POLICIES[mode]`).
 *   3. The configured **allow** rule list.
 *
 * The output is one of `allow`, `deny`, or `prompt`. The executor in
 * `core/tools/executor.ts` interprets the decision: `allow` runs the tool,
 * `deny` raises a `ToolPermissionError`, and `prompt` is forwarded to the
 * TUI which surfaces a yes/no/always question to the user.
 *
 * Decision order (top to bottom; first match wins):
 *
 *   1. If a deny rule matches → `{ kind: "deny" }`.
 *   2. If `mode.autoDenyDestructive` and the call is destructive → `{ kind: "deny" }`.
 *   3. If an allow rule matches → `{ kind: "allow" }`.
 *   4. If destructive and `mode.autoAllowDestructive` → `{ kind: "allow" }`.
 *   5. If non-destructive and `mode.autoAllowNonDestructive` → `{ kind: "allow" }`.
 *   6. Otherwise → `{ kind: "prompt" }`.
 */
import { MODE_POLICIES } from "./modes.js";
import { matchAny } from "./matcher.js";
import type { PermissionCheckInput, PermissionContext, PermissionDecision } from "./types.js";

/**
 * Decide whether a tool call should run.
 *
 * @param ctx - active mode and rule lists.
 * @param input - tool name, summary, and destructive flag.
 * @returns the gate's decision.
 */
export function checkPermission(
  ctx: PermissionContext,
  input: PermissionCheckInput,
): PermissionDecision {
  // 1. Deny list always wins.
  if (matchAny(ctx.deny, input.toolName, input.inputSummary)) {
    return {
      kind: "deny",
      reason: `Denied by rule for ${input.toolName}: ${input.inputSummary}`,
    };
  }

  const policy = MODE_POLICIES[ctx.mode];

  // 2. Mode-level auto-deny for destructive calls.
  if (input.destructive && policy.autoDenyDestructive) {
    return {
      kind: "deny",
      reason: `Mode "${ctx.mode}" forbids destructive ${input.toolName} calls.`,
    };
  }

  // 3. Allow list.
  if (matchAny(ctx.allow, input.toolName, input.inputSummary)) {
    return { kind: "allow" };
  }

  // 4-5. Mode-level auto-allow.
  if (input.destructive && policy.autoAllowDestructive) {
    return { kind: "allow" };
  }
  if (!input.destructive && policy.autoAllowNonDestructive) {
    return { kind: "allow" };
  }

  // 6. Fallback: prompt the user. The preview is intentionally short so the
  //    TUI can render it on a single line.
  return {
    kind: "prompt",
    preview: `${input.toolName}: ${input.inputSummary}`,
  };
}

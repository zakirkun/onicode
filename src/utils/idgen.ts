/**
 * Short, URL-safe identifier generator.
 *
 * All OniCode entity ids share a common shape: a short alphabetic prefix
 * (`ses`, `agt`, `tc`, ...) followed by an underscore and a 12-character
 * nanoid body. The prefix is purely a debugging aid — it lets a human reading
 * a JSONL transcript distinguish session ids from tool-call ids at a glance.
 *
 * The nanoid alphabet excludes ambiguous characters (`0/O`, `1/I/l`) so that
 * ids remain readable when copied from logs.
 */
import { customAlphabet } from "nanoid";

/** Unambiguous alphabet — lowercase letters + digits, minus visually similar chars. */
const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

/** ID body length. 12 characters of the trimmed alphabet → ~59 bits of entropy. */
const ID_LENGTH = 12;

const generate = customAlphabet(ID_ALPHABET, ID_LENGTH);

/**
 * Build a prefixed id of the form `<prefix>_<body>`.
 *
 * @param prefix - short identifier prefix; should be lowercase ASCII (e.g. "ses").
 * @returns prefixed id string.
 */
function prefixed(prefix: string): string {
  return `${prefix}_${generate()}`;
}

/** Generate a new session id (`ses_...`). */
export function newSessionId(): string {
  return prefixed("ses");
}

/** Generate a new agent id (`agt_...`) for both top-level and sub-agents. */
export function newAgentId(): string {
  return prefixed("agt");
}

/** Generate a new tool-call id (`tc_...`) — used to correlate tool_call ↔ tool_result. */
export function newToolCallId(): string {
  return prefixed("tc");
}

/** Generate a new generic event id (`evt_...`) for arbitrary log entries. */
export function newEventId(): string {
  return prefixed("evt");
}

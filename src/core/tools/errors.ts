/**
 * Tool execution error types.
 *
 * Each subclass corresponds to a `ToolErrorPayload.kind`. The executor
 * catches these and converts them into structured `ToolResult` failures
 * via {@link toErrorPayload}, so the agent loop never has to inspect a
 * raw `Error` shape.
 *
 * All classes set `name` explicitly so that `error.name` works correctly
 * after minification and across realm boundaries.
 */
import type { ToolErrorPayload } from "./types.js";

/** Base class for all tool errors that should be surfaced as structured results. */
export abstract class ToolError extends Error {
  /** Discriminator used to build the payload. */
  abstract readonly kind: ToolErrorPayload["kind"];
  /** Optional structured detail attached to the error. */
  readonly details?: unknown;

  protected constructor(message: string, details?: unknown) {
    super(message);
    this.details = details;
  }
}

/** The requested tool is not registered. */
export class ToolNotFoundError extends ToolError {
  override readonly name = "ToolNotFoundError";
  override readonly kind = "execution" as const;

  constructor(toolName: string) {
    super(`Tool not found: ${toolName}`);
  }
}

/** Input did not match the tool's input schema. */
export class ToolValidationError extends ToolError {
  override readonly name = "ToolValidationError";
  override readonly kind = "validation" as const;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/** Permission gate denied the call. */
export class ToolPermissionError extends ToolError {
  override readonly name = "ToolPermissionError";
  override readonly kind = "permission" as const;

  constructor(reason: string) {
    super(reason);
  }
}

/** Tool threw or returned an error during execution. */
export class ToolExecutionError extends ToolError {
  override readonly name = "ToolExecutionError";
  override readonly kind = "execution" as const;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

/** Tool was aborted via the AbortSignal. */
export class ToolAbortedError extends ToolError {
  override readonly name = "ToolAbortedError";
  override readonly kind = "aborted" as const;

  constructor(message = "Tool execution aborted") {
    super(message);
  }
}

/**
 * Convert any thrown value into a `ToolErrorPayload`.
 *
 * Recognized `ToolError` subclasses preserve their `kind`; everything else
 * is reported as a generic execution failure. The original `Error.message`
 * is preserved verbatim so it can be shown to the user.
 */
export function toErrorPayload(err: unknown): ToolErrorPayload {
  if (err instanceof ToolError) {
    return {
      kind: err.kind,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    };
  }
  if (err instanceof Error) {
    return { kind: "execution", message: err.message };
  }
  return { kind: "execution", message: String(err) };
}

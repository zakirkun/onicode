/**
 * Shared test fixtures and factories.
 *
 * Provides mock loggers, fake streams, and common data shapes
 * to reduce boilerplate across test files.
 */
import { vi } from "vitest";
import type { Logger } from "../../src/utils/logger.js";
import type { ChatMessage } from "../../src/providers/types.js";

/** Create a mock Logger where child() returns itself. */
export function createMockLogger(): Logger {
  const logger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  (logger.child as ReturnType<typeof vi.fn>).mockReturnValue(logger);
  return logger;
}

/** Create a minimal ChatMessage with text content. */
export function textMessage(
  role: "user" | "assistant" | "system",
  text: string,
): ChatMessage {
  return { role, content: [{ type: "text", text }] };
}

/** Create a fake async iterable stream from an array of chunks. */
export function createFakeStream<T>(
  chunks: T[],
): AsyncIterable<T> & { controller: AbortController } {
  const controller = new AbortController();
  return {
    controller,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        if (controller.signal.aborted) break;
        yield chunk;
      }
    },
  };
}

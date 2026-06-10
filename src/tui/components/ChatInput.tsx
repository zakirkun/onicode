/**
 * Chat input component.
 *
 * Single-line text editor implemented with `useInput` so we do not pull in
 * `ink-text-input` — keeps the dependency tree narrow. Captures printable
 * keystrokes, backspace, left/right cursor moves, history navigation
 * (up/down), and submission via return.
 *
 * The component is "controlled" from the controller's perspective: the
 * controller owns history but the buffer state lives here. The controller
 * receives the buffer via `onSubmit` and is free to ignore or transform it.
 */
import { Box, Text, useInput } from "ink";
import React, { useState, useImperativeHandle, forwardRef } from "react";

/** Public handle exposed by {@link ChatInput} via `ref`. */
export interface ChatInputHandle {
  /** Replace the @-mention range with the resolved path. */
  replaceRange: (start: number, end: number, replacement: string) => void;
  /** Get the current buffer text. */
  getBuffer: () => string;
}

/** Props for {@link ChatInput}. */
export interface ChatInputProps {
  /** Whether input should be accepted right now. */
  enabled: boolean;
  /** Recent submissions (newest last). Used for up/down history scroll. */
  history: readonly string[];
  /** Submission callback. */
  onSubmit: (text: string) => void;
  /** Optional placeholder shown when the buffer is empty. */
  placeholder?: string;
  /** Called when user types `@` to signal mention mode start. */
  onMentionStart?: (cursorPosition: number) => void;
}

/** Single-line input editor. */
export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(props, ref) {
  const [buffer, setBuffer] = useState("");
  const [cursor, setCursor] = useState(0);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);

  useImperativeHandle(ref, () => ({
    replaceRange: (start: number, end: number, replacement: string) => {
      setBuffer((b) => b.slice(0, start) + replacement + b.slice(end));
      setCursor(start + replacement.length);
    },
    getBuffer: () => buffer,
  }), [buffer]);

  useInput(
    (input, key) => {
      // Submission.
      if (key.return) {
        const trimmed = buffer.trim();
        if (trimmed.length === 0) {
          return;
        }
        props.onSubmit(trimmed);
        setBuffer("");
        setCursor(0);
        setHistoryIdx(null);
        return;
      }

      // History navigation. Up = older, Down = newer.
      if (key.upArrow) {
        if (props.history.length === 0) {
          return;
        }
        const next = historyIdx === null ? props.history.length - 1 : Math.max(historyIdx - 1, 0);
        const value = props.history[next] ?? "";
        setHistoryIdx(next);
        setBuffer(value);
        setCursor(value.length);
        return;
      }
      if (key.downArrow) {
        if (historyIdx === null) {
          return;
        }
        const next = historyIdx + 1;
        if (next >= props.history.length) {
          setHistoryIdx(null);
          setBuffer("");
          setCursor(0);
          return;
        }
        const value = props.history[next] ?? "";
        setHistoryIdx(next);
        setBuffer(value);
        setCursor(value.length);
        return;
      }

      // Cursor moves.
      if (key.leftArrow) {
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(c + 1, buffer.length));
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor === 0) {
          return;
        }
        setBuffer((b) => b.slice(0, cursor - 1) + b.slice(cursor));
        setCursor((c) => Math.max(c - 1, 0));
        return;
      }
      if (key.ctrl && input === "u") {
        // Ctrl+U — kill line.
        setBuffer("");
        setCursor(0);
        return;
      }

      // Printable input. `input` may be multi-character on paste.
      if (input && !key.ctrl && !key.meta) {
        setBuffer((b) => b.slice(0, cursor) + input + b.slice(cursor));
        const newCursor = cursor + input.length;
        setCursor(newCursor);
        setHistoryIdx(null);

        // Detect @-mention start.
        if (input === "@" && props.onMentionStart) {
          props.onMentionStart(newCursor);
        }
      }
    },
    { isActive: props.enabled },
  );

  // Render: prompt arrow, buffered text with inverse cursor cell.
  const showPlaceholder = buffer.length === 0 && props.placeholder !== undefined;
  return (
    <Box paddingX={1}>
      <Text color={props.enabled ? "cyan" : "gray"}>{"› "}</Text>
      {showPlaceholder ? (
        <Text dimColor>{props.placeholder}</Text>
      ) : (
        <Text>{renderWithCursor(buffer, cursor, props.enabled)}</Text>
      )}
    </Box>
  );
});

/**
 * Build the rendered string: cursor cell shown in inverse video. When
 * disabled, render plain text without a cursor.
 */
function renderWithCursor(buffer: string, cursor: number, enabled: boolean): React.ReactNode {
  if (!enabled) {
    return buffer;
  }
  const before = buffer.slice(0, cursor);
  const at = buffer[cursor] ?? " ";
  const after = buffer.slice(cursor + 1);
  return (
    <>
      <Text>{before}</Text>
      <Text inverse>{at}</Text>
      <Text>{after}</Text>
    </>
  );
}

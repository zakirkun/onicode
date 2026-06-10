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
import React, { useState } from "react";

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
}

/** Single-line input editor. */
export function ChatInput(props: ChatInputProps): React.ReactElement {
  const [buffer, setBuffer] = useState("");
  const [cursor, setCursor] = useState(0);
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);

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
        setCursor((c) => c + input.length);
        setHistoryIdx(null);
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
}

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

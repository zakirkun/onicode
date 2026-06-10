/**
 * Tool status badge.
 *
 * Compact one-line ink component used inside `MessageList` for `tool_call`
 * and `tool_result` view entries. Centralizes the colour palette so all
 * tool-related lines look consistent.
 */
import { Text } from "ink";
import React from "react";

/** Props for {@link ToolStatus}. */
export interface ToolStatusProps {
  /** Tool registered name, shown verbatim. */
  toolName: string;
  /** One-line summary of the tool input. */
  summary: string;
  /** Visual state. */
  state: "running" | "ok" | "error" | "denied";
  /** Optional error message (used when `state` is `error` or `denied`). */
  errorMessage?: string;
}

/** Render the status line. */
export function ToolStatus(props: ToolStatusProps): React.ReactElement {
  const palette = renderPalette(props.state);
  return (
    <Text>
      <Text color={palette.glyphColor}>{palette.glyph} </Text>
      <Text color="cyan">{props.toolName}</Text>
      <Text> {props.summary}</Text>
      {props.errorMessage ? <Text color="red"> — {props.errorMessage}</Text> : null}
    </Text>
  );
}

/** Map state → glyph + color. */
function renderPalette(state: ToolStatusProps["state"]): {
  glyph: string;
  glyphColor: string;
} {
  switch (state) {
    case "running":
      return { glyph: "⟳", glyphColor: "yellow" };
    case "ok":
      return { glyph: "✓", glyphColor: "green" };
    case "error":
      return { glyph: "✗", glyphColor: "red" };
    case "denied":
      return { glyph: "⊘", glyphColor: "red" };
  }
}

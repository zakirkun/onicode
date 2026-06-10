/**
 * Single message renderer.
 *
 * Switches on `ChatMessageView.kind` and renders the appropriate ink
 * primitives. Kept presentational; all state lives in the controller.
 */
import { Box, Text } from "ink";
import React from "react";

import { ToolStatus } from "./ToolStatus.js";
import type { ChatMessageView } from "../types.js";

/** Props for {@link Message}. */
export interface MessageProps {
  view: ChatMessageView;
}

/** Render one message view. */
export function Message(props: MessageProps): React.ReactElement {
  const v = props.view;
  switch (v.kind) {
    case "user":
      return (
        <Box>
          <Text color="cyan">›</Text>
          <Text> {v.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column">
          <Text>
            {v.text}
            {v.streaming ? <Text color="yellow"> ▋</Text> : null}
          </Text>
        </Box>
      );
    case "tool_call":
      return <ToolStatus toolName={v.call.name} summary={v.summary} state="running" />;
    case "tool_result":
      return (
        <ToolStatus
          toolName={extractToolName(v.preview)}
          summary={v.preview}
          state={resultState(v)}
          {...(v.error?.message !== undefined ? { errorMessage: v.error.message } : {})}
        />
      );
    case "system":
      return (
        <Box>
          <Text dimColor>{v.text}</Text>
        </Box>
      );
    case "error":
      return (
        <Box>
          <Text color="red">! {v.text}</Text>
        </Box>
      );
  }
}

/** Map a tool-result view to the appropriate `ToolStatus` state. */
function resultState(
  v: Extract<ChatMessageView, { kind: "tool_result" }>,
): "ok" | "error" | "denied" {
  if (v.ok) {
    return "ok";
  }
  return v.error?.kind === "permission" ? "denied" : "error";
}

/**
 * Pull the leading tool name out of a result preview. The controller emits
 * previews shaped as `<ToolName>: <details>`; we try to recover the name for
 * a tidier badge. If the preview is unstructured, return an empty string —
 * `ToolStatus` will hide the chip if `toolName` is empty.
 */
function extractToolName(preview: string): string {
  const colonIdx = preview.indexOf(":");
  if (colonIdx === -1) {
    return "";
  }
  return preview.slice(0, colonIdx);
}

/**
 * Status bar component.
 *
 * Bottom-of-screen single-line status. Renders permission mode, provider,
 * model, current activity, accumulated token usage, and a hint for `/help`.
 */
import { Box, Text } from "ink";
import React from "react";

import type { TokenUsage } from "../../providers/types.js";
import type { AgentActivity } from "../types.js";

/** Props for {@link StatusBar}. */
export interface StatusBarProps {
  modelId: string;
  providerId: string;
  mode: string;
  activity: AgentActivity;
  usage: TokenUsage;
  sessionId: string;
}

/** Render the bottom status bar. */
export function StatusBar(props: StatusBarProps): React.ReactElement {
  return (
    <Box
      borderStyle="single"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      flexDirection="row"
      justifyContent="space-between"
    >
      <Box>
        <Text color="cyan">{props.providerId}</Text>
        <Text> · </Text>
        <Text color="magenta">{props.modelId}</Text>
        <Text> · </Text>
        <Text color={modeColor(props.mode)}>mode: {props.mode}</Text>
      </Box>
      <Box>
        <Text dimColor>{renderActivity(props.activity)}</Text>
      </Box>
      <Box>
        <Text dimColor>
          tokens in:{props.usage.inputTokens} out:{props.usage.outputTokens}
        </Text>
        <Text dimColor> · /help</Text>
      </Box>
    </Box>
  );
}

/** Map mode → ink color for quick visual feedback. */
function modeColor(mode: string): string {
  switch (mode) {
    case "default":
      return "white";
    case "acceptEdits":
      return "yellow";
    case "plan":
      return "green";
    case "bypassPermissions":
      return "red";
    default:
      return "white";
  }
}

/** Stringify the current `AgentActivity`. */
function renderActivity(activity: AgentActivity): string {
  switch (activity.kind) {
    case "idle":
      return "idle";
    case "thinking":
      return "thinking…";
    case "running_tool":
      return `running ${activity.toolName}: ${truncate(activity.summary, 40)}`;
    case "awaiting_permission":
      return `awaiting permission for ${activity.toolName}`;
  }
}

/** Truncate a string to a printable max length. */
function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

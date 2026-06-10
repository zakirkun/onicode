/**
 * Permission prompt component.
 *
 * Rendered when the executor's permission gate returns `prompt`. Captures a
 * single keystroke:
 *
 *   - `y` / Enter → allow this single call.
 *   - `n` / Esc   → deny this single call.
 *   - `a`         → allow this and silence future identical calls (the
 *                   controller installs an allow rule at runtime).
 *
 * The component is purely presentational: it surfaces the outcome via the
 * `onResolve` callback supplied by the controller.
 */
import { Box, Text, useInput } from "ink";
import React from "react";

import type { PendingPermission, PermissionPromptOutcome } from "../types.js";

/** Props for {@link PermissionPrompt}. */
export interface PermissionPromptProps {
  pending: PendingPermission;
  onResolve: (id: string, outcome: PermissionPromptOutcome) => void;
}

/** Render the modal prompt. */
export function PermissionPrompt(props: PermissionPromptProps): React.ReactElement {
  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (key.return || ch === "y") {
      props.onResolve(props.pending.id, "allow");
      return;
    }
    if (key.escape || ch === "n") {
      props.onResolve(props.pending.id, "deny");
      return;
    }
    if (ch === "a") {
      props.onResolve(props.pending.id, "allow_always");
    }
  });

  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      flexDirection="column"
      marginY={1}
    >
      <Text color="yellow">! Permission required</Text>
      <Text>
        Tool: <Text color="cyan">{props.pending.toolName}</Text>
      </Text>
      <Text>Action: {props.pending.inputSummary}</Text>
      <Box marginTop={1}>
        <Text dimColor>[y] allow once  [a] allow always  [n] deny  [Esc] deny</Text>
      </Box>
    </Box>
  );
}

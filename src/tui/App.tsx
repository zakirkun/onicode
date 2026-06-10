/**
 * Top-level Ink app.
 *
 * Pure view component: pulls state from the controller via
 * `useTuiStore`, dispatches user input back into it, and intercepts
 * Ctrl+C / Ctrl+D for cancel / exit.
 */
import { Box, Text, useApp, useInput } from "ink";
import React, { useRef, useState } from "react";

import { ChatInput, type ChatInputHandle } from "./components/ChatInput.js";
import { MentionPicker } from "./components/MentionPicker.js";
import { MessageList } from "./components/MessageList.js";
import { PermissionPrompt } from "./components/PermissionPrompt.js";
import { StatusBar } from "./components/StatusBar.js";
import type { TuiController } from "./controller.js";
import { useTuiStore } from "./hooks/useTuiStore.js";

/** Props for {@link App}. */
export interface AppProps {
  controller: TuiController;
  modelId: string;
  providerId: string;
  sessionId: string;
  cwd: string;
}

/** Render the OniCode chat TUI. */
export function App(props: AppProps): React.ReactElement {
  const state = useTuiStore(props.controller);
  const { exit } = useApp();
  const inputRef = useRef<ChatInputHandle>(null);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);

  // Global key bindings.
  useInput((input, key) => {
    // Ctrl+C: cancel a running turn or exit if idle.
    if (key.ctrl && input === "c") {
      if (state.activity.kind !== "idle") {
        props.controller.cancel();
        return;
      }
      exit();
      return;
    }
    // Ctrl+D: exit when input is empty (handled here at top level since
    // ChatInput swallows printable input).
    if (key.ctrl && input === "d" && state.inputEnabled) {
      exit();
    }
  });

  // When the controller flips `exited`, drop out of the Ink render loop.
  React.useEffect(() => {
    if (state.exited) {
      exit();
    }
  }, [state.exited, exit]);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color="cyan" bold>
          OniCode
        </Text>
        <Text dimColor>Type /help to list slash commands. Ctrl+C to cancel/exit.</Text>
      </Box>

      <MessageList views={state.views} />

      {state.pendingPermission ? (
        <PermissionPrompt
          pending={state.pendingPermission}
          onResolve={(id, outcome) => props.controller.resolvePermission(id, outcome)}
        />
      ) : null}

      {mention ? (
        <MentionPicker
          query={mention.query}
          cwd={props.cwd}
          onSelect={(result) => {
            inputRef.current?.replaceRange(mention.start, mention.start + 1 + mention.query.length, result.path);
            setMention(null);
          }}
          onCancel={() => setMention(null)}
        />
      ) : null}

      <ChatInput
        ref={inputRef}
        enabled={state.inputEnabled && state.pendingPermission === null}
        history={state.history}
        onSubmit={(text) => {
          void props.controller.submit(text);
        }}
        placeholder={state.activity.kind === "idle" ? "Ask OniCode…" : "(busy)"}
        onMentionStart={(cursorPos) => {
          const text = inputRef.current?.getBuffer() ?? "";
          const beforeCursor = text.slice(0, cursorPos);
          const match = /@([^\s@]*)$/.exec(beforeCursor);
          if (match) {
            setMention({ query: match[1] ?? "", start: match.index! });
          }
        }}
      />

      <StatusBar
        modelId={props.modelId}
        providerId={props.providerId}
        sessionId={props.sessionId}
        mode={props.controller.getMode()}
        activity={state.activity}
        usage={state.usage}
        bgCount={state.bgCount}
      />
    </Box>
  );
}

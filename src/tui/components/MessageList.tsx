/**
 * Scroll-back list.
 *
 * Renders a simple top-down list of `ChatMessageView`s. Ink does not provide
 * a built-in scroll viewport in the same way browser DOM does — long
 * sessions naturally scroll the terminal, and the most recent content is
 * always at the bottom of the buffer the user sees.
 */
import { Box } from "ink";
import React from "react";

import { Message } from "./Message.js";
import type { ChatMessageView } from "../types.js";

/** Props for {@link MessageList}. */
export interface MessageListProps {
  views: readonly ChatMessageView[];
}

/** Render every view in order. */
export function MessageList(props: MessageListProps): React.ReactElement {
  return (
    <Box flexDirection="column" paddingX={1}>
      {props.views.map((v) => (
        <Box key={v.id} marginBottom={1}>
          <Message view={v} />
        </Box>
      ))}
    </Box>
  );
}

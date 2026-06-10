/**
 * Overlay picker for @-mention file/folder selection.
 *
 * Renders above the ChatInput when mention mode is active.
 * Arrow keys navigate, Enter selects, Esc cancels.
 */
import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { resolveMention, type MentionResult } from "../mentionResolver.js";

export interface MentionPickerProps {
  query: string;
  cwd: string;
  onSelect: (result: MentionResult) => void;
  onCancel: () => void;
}

export function MentionPicker({
  query,
  cwd,
  onSelect,
  onCancel,
}: MentionPickerProps): React.ReactElement {
  const [results, setResults] = useState<MentionResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    resolveMention(query, { cwd }).then((r) => {
      if (!cancelled) {
        setResults(r);
        setSelectedIdx(0);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [query, cwd]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return || input === "\r") {
      const item = results[selectedIdx];
      if (item) onSelect(item);
      return;
    }
    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIdx((i) => Math.min(results.length - 1, i + 1));
    }
  });

  if (results.length === 0) {
    return (
      <Box borderStyle="round" borderColor="gray" paddingX={1}>
        <Text dimColor>No matches for @{query}</Text>
      </Box>
    );
  }

  const visible = results.slice(0, 8);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      {visible.map((r, i) => {
        const selected = i === selectedIdx;
        return (
          <Text key={r.path} {...(selected ? { color: "cyan" as const, bold: true } : {})}>
            {selected ? "▸ " : "  "}
            {r.isDir ? "📁 " : "📄 "}
            {r.path}
          </Text>
        );
      })}
      {results.length > 8 && <Text dimColor>  ... and {results.length - 8} more</Text>}
      <Text dimColor>  ↑↓ navigate · Enter select · Esc cancel</Text>
    </Box>
  );
}

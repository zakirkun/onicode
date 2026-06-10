/**
 * Project-level memory management.
 *
 * Memory is a markdown file at `<cwd>/.onicode/memory.md` that gets
 * auto-loaded into the system prompt. Users manage it via /memory
 * slash commands. Persistent across sessions.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Interface for project-level memory operations.
 *
 * Memory persists as markdown at `<cwd>/.onicode/memory.md` and is
 * auto-loaded into the system prompt at session start.
 */
export interface MemoryManager {
  /** Load memory contents from disk. Returns `null` if the file does not exist. */
  load(): Promise<string | null>;
  /** Overwrite the memory file with new content. Creates parent directories if needed. */
  save(content: string): Promise<void>;
  /** Append an entry to the existing memory file, creating it if absent. */
  append(entry: string): Promise<void>;
  /** Reset the memory file to an empty template. */
  clear(): Promise<void>;
  /** Return the absolute path to the memory file. */
  path(): string;
}

/**
 * Create a memory manager bound to a working directory.
 *
 * @param cwd - project root; memory lives at `<cwd>/.onicode/memory.md`.
 * @returns a {@link MemoryManager} for reading and writing project memory.
 */
export function createMemoryManager(cwd: string): MemoryManager {
  const filePath = join(cwd, ".onicode", "memory.md");

  return {
    path: () => filePath,

    async load(): Promise<string | null> {
      try {
        return await readFile(filePath, "utf-8");
      } catch {
        return null;
      }
    },

    async save(content: string): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf-8");
    },

    async append(entry: string): Promise<void> {
      const existing = (await this.load()) ?? "# Project Memory\n\n";
      const separator = existing.endsWith("\n") ? "" : "\n";
      await this.save(existing + separator + entry + "\n");
    },

    async clear(): Promise<void> {
      await this.save("# Project Memory\n\n_No entries yet._\n");
    },
  };
}

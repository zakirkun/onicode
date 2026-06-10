/**
 * Project-level memory management.
 *
 * Memory is a markdown file at `<cwd>/.onicode/memory.md` that gets
 * auto-loaded into the system prompt. Users manage it via /memory
 * slash commands. Persistent across sessions.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface MemoryManager {
  load(): Promise<string | null>;
  save(content: string): Promise<void>;
  append(entry: string): Promise<void>;
  clear(): Promise<void>;
  path(): string;
}

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

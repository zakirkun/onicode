/**
 * OniCode CLI entrypoint.
 *
 * The shebang `#!/usr/bin/env node` is injected by `tsup` at build time
 * (see `tsup.config.ts`) so that `dist/cli.js` is directly executable
 * after `pnpm build`.
 *
 * Responsibilities:
 *   - Parse `process.argv` into a `ParsedArgs`.
 *   - Dispatch to the appropriate subcommand handler.
 *   - Convert handler exit codes into `process.exit(...)`.
 *
 * Subcommands not yet implemented in v0.1 print a short message naming
 * the version that adds them, then exit 0. This keeps the CLI usable and
 * self-documenting during the staged rollout.
 */
import { HELP_TEXT, parseArgs, type ParsedArgs } from "./args.js";
import { runChat } from "./commands/chat.js";
import { runHeadless } from "./commands/run.js";
import { runSkills } from "./commands/skills.js";

/** Run the CLI. Returns the exit code; the wrapper at the bottom calls `process.exit`. */
export async function main(argv: readonly string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`onicode: ${msg}\n\n${HELP_TEXT}`);
    return 2;
  }

  if (args.help || args.command === "help") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }

  switch (args.command) {
    case "run":
      return runHeadless(args);

    case "chat":
      return runChat(args);

    case "resume":
      process.stderr.write("onicode: `resume` arrives in v0.6.\n");
      return 0;

    case "skills":
      return runSkills(args);
  }
}

// Top-level invocation. Awaits the handler then exits with the returned
// code. Unhandled rejections fall through to a generic exit-1 path so the
// process always terminates on a deterministic code.
const code = await main(process.argv.slice(2)).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`onicode: fatal: ${msg}\n`);
  return 1;
});
process.exit(code);

# Contributing to OniCode

Thank you for your interest in contributing to OniCode! This document provides guidelines and information for contributors.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## How to Contribute

### Reporting Bugs

1. Check existing issues to avoid duplicates
2. Use clear, descriptive titles
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - OniCode version (`onicode --version`)
   - Node.js version (`node --version`)
   - Relevant config files
   - Error messages or stack traces

### Suggesting Features

1. Open an issue with `[Feature]` prefix
2. Describe the use case and motivation
3. Propose implementation approach if you have ideas
4. Consider backward compatibility implications

### Submitting Code

#### Prerequisites

- Node.js 20 or later
- pnpm 8 or later
- TypeScript 5.9 or later

#### Setup

```bash
git clone https://github.com/onicode/onicode.git
cd onicode
pnpm install
pnpm build
```

#### Development Workflow

1. **Fork and branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make changes**
   - Follow existing code patterns
   - Write tests for new functionality
   - Update documentation as needed
   - Keep commits atomic and well-described

3. **Verify**
   ```bash
   pnpm typecheck    # TypeScript compilation
   pnpm test         # All tests pass
   pnpm lint         # Code style
   pnpm build        # Production build
   ```

4. **Commit**
   ```bash
   git add <files>
   git commit -m "feat: add descriptive commit message"
   ```

5. **Push and PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Open a pull request with clear description.

## Code Style

### TypeScript

- **Strict mode enabled** — `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`
- **No `any`** — use `unknown` + zod validation at boundaries
- **ESM modules** — `"type": "module"`, explicit `.js` extensions in imports
- **Type-only imports** — use `import type` for type-only imports
- **Explicit return types** — required on exported functions

### Documentation

- **File-level JSDoc** — every file starts with `/** ... */` explaining responsibility
- **TSDoc on exports** — every exported symbol has `/** ... */` with `@param`, `@returns`
- **English everywhere** — identifiers, comments, JSDoc, prose
- **No placeholders** — avoid TODO/FIXME in production code

### Naming Conventions

- **PascalCase** — classes, interfaces, types (`ToolRegistry`, `AgentConfig`)
- **camelCase** — functions, variables, methods (`createProvider`, `buildRegistry`)
- **UPPER_SNAKE_CASE** — constants (`DEFAULT_MODEL`, `MAX_RETRIES`)
- **Descriptive names** — prefer clarity over brevity

### File Organization

- **Single responsibility** — one concern per file
- **Co-location** — related files live together
- **Barrel exports** — use `index.ts` for public API surface
- **No circular dependencies** — structure imports as a DAG

### Testing

- **Test file location** — `tests/<module>/<name>.test.ts`
- **Test naming** — descriptive `it()` blocks
- **Coverage** — new code should maintain or improve coverage
- **Mocking** — use `vitest` mocks, avoid heavy mocking frameworks
- **Pure functions** — prefer testing pure logic over side effects

### Git

- **Atomic commits** — one logical change per commit
- **Conventional commits** — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- **Signed commits** — sign with GPG if configured
- **Rebase before PR** — keep history clean

## Architecture Guidelines

### Adding a New Tool

See `CLAUDE.md` section "When Adding a New Tool" for detailed steps.

Quick checklist:
1. Create `src/tools/builtin/<name>.ts` with `Tool<I, O>` export
2. Define input via zod schema
3. Set `destructive: true` if tool mutates state
4. Implement `summarize(input)` for permission gate
5. Register in `buildBuiltinRegistry()`

### Adding a New Provider

See `CLAUDE.md` section "When Adding a New Provider" for detailed steps.

Quick checklist:
1. Create `src/providers/<id>/{provider,mapper}.ts`
2. Implement `LLMProvider` interface
3. Add mapper functions for canonical ↔ provider types
4. Register in `createProvider()` factory
5. Update `ProviderIdSchema` and `ProviderId` type

### Adding a Slash Command

See `CLAUDE.md` section "When Adding a Slash Command" for detailed steps.

Quick checklist:
1. Add entry to `SLASH_COMMANDS` in `src/tui/slashCommands.ts`
2. Implement `execute(args, ctx)` returning `{ messages?, exit? }`
3. Keep `summary` and `args` fields populated for `/help`
4. Mutations to `ctx.permissionContext.mode` take effect immediately

## Review Process

### What We Look For

- **Correctness** — does it do what it claims?
- **Test coverage** — are edge cases covered?
- **Code quality** — follows project patterns and style?
- **Documentation** — are changes documented?
- **Backward compatibility** — does it break existing usage?

### Review Timeline

- Initial review within 3–5 business days
- Address feedback promptly
- Ping maintainers if no response after a week

### Merge Criteria

- All CI checks pass
- At least one maintainer approval
- No unresolved comments
- Up-to-date with main branch

## Getting Help

- **Questions** — open a discussion or issue
- **Bugs** — file an issue with reproduction steps
- **Features** — open a feature request issue
- **Security** — see SECURITY.md (if applicable)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

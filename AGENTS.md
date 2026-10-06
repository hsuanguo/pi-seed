# Repository Guidelines

## Purpose

Share a minimal, stable pi setup others can adapt. **Less is More:** add something only for a recurring need worth its maintenance cost. This file is for contributors; `setup/AGENTS.md` is the template `install.mjs` installs for users.

## Layout & Style

- `extensions/`: pi extensions, loaded through `pi.extensions` in `package.json`. `setup/`: installer templates. `tests/`: `node:test` suites.
- `skills/` holds package skills. Skills require `SKILL.md` frontmatter.
- Tabs, double quotes, semicolons, and ES modules in JS/TS; two spaces in JSON; four spaces in Python. Use camelCase functions, PascalCase types, UPPER_SNAKE_CASE constants, and kebab-case extension filenames and skill directories.

## Installer Contract

- Copy `setup/AGENTS.md` without boundary markers only when no supported user context file exists. Otherwise skip it and tell the user to maintain their context manually, even with `--force`. Never overwrite or append to an existing context file.
- Never lose user data: keep existing values unless `--force`, union arrays, respect an explicit opposite such as `-codemode`, back up before writing, stay idempotent.
- `setup/settings.json` holds only shareable defaults: no theme, model, `enabledModels`, private providers, or credentials. `packages` are installed with `pi install`, not merged.
- Keep `SELF_SOURCE` and README URLs in line with the GitHub repository name.

## Extension Principles

- Use pi's extension points (`resources_discover`, `systemPromptOptions`, `tool_result`) rather than rewriting the system prompt.
- Derive state that must survive `/tree`, resume, and compaction from session branch entries, not memory.
- Check `ctx.isProjectTrusted()` before reading project configuration or loading project skills.
- Host packages (`@earendil-works/*`, `typebox`) go in `peerDependencies` as `"*"`, never `dependencies`; `devDependencies` pin the pi version tested against.
- Document behavior and config in the extension's header comment and the README Extensions table.

## Verification

- Install locked development dependencies with `npm ci --ignore-scripts`. `npm run check` runs the strict typecheck and all tests without credentials or network; run it before every commit.
- Tests never touch the real `~/.pi`: `tests/helpers.ts` points HOME, the agent directory, and the workspace at a temp dir. Test behavior that depends on pi itself (transcript order, compaction, codemode, system prompt) in a real session via `createTestSession` (pi's faux model); cover edge cases with unit tests.
- New behavior needs a test that fails without it.
- Optional live check: `pi -p --no-extensions -e ./extensions/<name>.ts` in a temp workspace, with `PI_CODING_AGENT_DIR` set to a temp dir and credentials from env, never your live `auth.json`.
- Use `pi -e ./` for temporary package loading; `pi install ./` persists a package declaration and can duplicate a git-installed copy. Isolate HOME, the agent directory, and cwd for tests; `-e` and `--session-dir` alone do not isolate configuration.
- Upgrading pi: bump the pinned `devDependencies`, then `npm run check`.

## Commits & Security

- Focused commits with descriptive subjects; update README for user-facing changes.
- Run `pre-commit run --all-files` (Gitleaks) before pushing. Never commit `auth.json`, `models.json`, `mcp.json`, sessions, or backups. Removed files stay in history: check content for internal names and hosts before committing.

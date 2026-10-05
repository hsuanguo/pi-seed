# Repository Guidelines

## Purpose

Share a minimal, stable pi setup others can adapt. **Less is More:** add something only for a recurring need worth its maintenance cost. This file is for contributors; `setup/AGENTS.md` is the template `install.mjs` installs for users.

## Layout & Style

- `extensions/`: pi extensions, loaded through `pi.extensions` in `package.json`. `setup/`: installer templates. `tests/`: `node:test` suites.
- `skills/skill-creator/` is vendored from Anthropic (Apache-2.0): do not edit it; update by copying upstream.
- Tabs, double quotes, semicolons, and ES modules in JS/TS; two spaces in JSON; kebab-case file and skill names.

## Installer Contract

- Never lose user data: keep existing values unless `--force`, union arrays, respect an explicit opposite such as `-codemode`, back up before writing, stay idempotent.
- The `<!-- pi-dotfiles:begin/end -->` markers identify installed blocks; changing them duplicates blocks for existing users.
- `setup/settings.json` holds only shareable defaults: no theme, model, `enabledModels`, private providers, or credentials. `packages` are installed with `pi install`, not merged.
- Keep `SELF_SOURCE` and README URLs in line with the GitHub repository name.

## Extension Principles

- Use pi's extension points (`resources_discover`, `systemPromptOptions`, `tool_result`) rather than rewriting the system prompt.
- Derive state that must survive `/tree`, resume, and compaction from session branch entries, not memory.
- Read project-level config only when `ctx.isProjectTrusted()`.
- Host packages (`@earendil-works/*`, `typebox`) go in `peerDependencies` as `"*"`, never `dependencies`; `devDependencies` pin the pi version tested against.
- Document behavior and config in the extension's header comment and the README Extensions table.

## Verification

- `npm install && npm run check` runs the strict typecheck and all tests in seconds, without credentials or network. Run it before every commit.
- Tests never touch the real `~/.pi`: `tests/helpers.ts` points HOME, the agent directory, and the workspace at a temp dir. Test behavior that depends on pi itself (transcript order, compaction, codemode, system prompt) in a real session via `createTestSession` (pi's faux model); cover edge cases with unit tests.
- New behavior needs a test that fails without it.
- Optional live check: `pi -p --no-extensions -e ./extensions/<name>.ts` in a temp workspace, with `PI_CODING_AGENT_DIR` set to a temp dir and credentials from env, never your live `auth.json`.
- Upgrading pi: bump the pinned `devDependencies`, then `npm run check`.

## Commits & Security

- Focused commits with descriptive subjects; update README for user-facing changes.
- Run `pre-commit run --all-files` (Gitleaks) before pushing. Never commit `auth.json`, `models.json`, `mcp.json`, sessions, or backups. Removed files stay in history: check content for internal names and hosts before committing.

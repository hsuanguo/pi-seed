# Repository Guidelines

## Purpose & Scope

Share a minimal, stable, reliable pi setup as a starting point others can adapt. **Less is More:** justify additions by a recurring need and their maintenance cost. This root file defines development conventions; `setup/AGENTS.md` is the user-context template installed by `install.mjs`.

## Project Structure & Style

`extensions/` holds TypeScript extensions declared in `package.json`; `setup/` holds installation defaults. `skills/skill-creator/` bundles Python utilities, references, and HTML evaluation assets. Match existing style: tabs in JavaScript/TypeScript, double quotes, semicolons, ES modules; two spaces in JSON; four spaces in Python. Use camelCase functions, PascalCase types, UPPER_SNAKE_CASE constants, and kebab-case extension filenames and skill directories. Skills require `SKILL.md` frontmatter.

## Installer Compatibility & Shared Defaults

- Preserve recognition of existing `<!-- pi-dotfiles:begin ... -->` and `<!-- pi-dotfiles:end -->` markers. The opening marker includes explanatory text; changing marker identity or matching can duplicate installed blocks. Preserve user content outside the block.
- Keep `install.mjs`'s `SELF_SOURCE` and README installation URLs aligned with the GitHub repository name; update them together when renaming.
- Put only shareable defaults in `setup/settings.json`. Exclude personal themes, default models, `enabledModels`, private providers, and packages containing credentials.
- `packages` is removed before settings merging and installed individually through `pi install`.
- Preserve existing values without `--force`, union arrays, respect explicit opposite tool choices such as `-codemode`, back up before writes, and keep repeated runs idempotent.

## Extension Conventions

- Declare host-provided `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-tui`, and `typebox` only in `peerDependencies` with `"*"`; never bundle them in `dependencies`.
- Prefer pi extension points such as `resources_discover` and `systemPromptOptions` over manually concatenating system prompts.
- Reconstruct context-sensitive state from session branch records, accounting for `/tree`, resume, and compaction. Memory-only state is insufficient across those transitions.
- Check `ctx.isProjectTrusted()` before reading project configuration or loading project skills.
- Document behavior and configuration in each extension's opening comment; update README's Extensions table when adding one.

## Isolated Development & Verification

Development must preserve the existing pi installation, settings, credentials, trust records, and sessions. Use `pi -e ./` for temporary package loading; `pi install ./` persists a local package declaration and can duplicate a git-installed copy. For tests, also isolate the agent directory and working directory; `-e` and `--session-dir` alone do not isolate configuration.

Initialize a disposable workspace from the repository root:

```sh
PI_TEST_REPO=$(pwd)
PI_TEST_ROOT=$(mktemp -d /tmp/pi-dotfiles-test.XXXXXX)
export PI_CODING_AGENT_DIR="$PI_TEST_ROOT/agent"
mkdir -p "$PI_CODING_AGENT_DIR" "$PI_TEST_ROOT/workspace"
cd "$PI_TEST_ROOT/workspace"
```

Check the installer without installing packages:

```sh
node --check "$PI_TEST_REPO/install.mjs"
node "$PI_TEST_REPO/install.mjs" --dry-run --no-packages
node "$PI_TEST_REPO/install.mjs" --no-packages
```

Seed disposable existing settings/context and rerun to verify merging, backups, and idempotence.

For a headless extension test, create fixtures in the temporary workspace:

```sh
pi -p --no-extensions -e "$PI_TEST_REPO/extensions/scoped-context.ts" \
  --session-dir "$PI_TEST_ROOT/sessions" --tools read,ls "<fixture-specific prompt>"
```

Inspect `$PI_TEST_ROOT/sessions/*.jsonl` for tool results and expected custom entries. Enable write tools only for disposable fixtures. Supply model credentials through environment variables; do not reuse or symlink live credential files. Agent-directory isolation is not a filesystem sandbox: extension code must keep test writes inside the temporary workspace.

For loading checks without a model request, start `pi --mode rpc --no-session --no-extensions -e "$PI_TEST_REPO/extensions/<name>.ts"`, send `{"type":"get_commands"}` over stdin, and check the response's command list. Test project trust with per-run `--approve` and `--no-approve`; check resume, branching, and compaction when relevant. Consult installed `pi --help` for version-specific flags.

No build/test script, formatter, or coverage threshold is configured. There is no tsconfig: editor implicit-any diagnostics alone are not authoritative. For strict checking, link pi's installed packages in a disposable type-check workspace and run `tsc --strict --noEmit` with appropriate module settings and Node typings. Do not dismiss errors from that check. Run `pre-commit run --all-files` for the configured Gitleaks scan when available.

## Commits, PRs & Security

Use focused commits with descriptive subjects; no Conventional Commits scheme is established. PRs should explain behavior changes, compatibility impact, and reproducible validation. Update README for user-facing changes. Keep credentials, sessions, and backups out of Git; retain the bundled skill's Apache-2.0 license.

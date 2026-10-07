# Installation and updates

Requires pi and Node.js 22.19+.

```bash
git clone https://github.com/hsuanguo/pi-seed && cd pi-seed
node install.mjs --dry-run   # preview every change
node install.mjs
```

Then start a new pi session (or `/reload` a running one).

Only want the extensions and skills? `pi install git:github.com/hsuanguo/pi-seed` — this repo is a pi package that ships `extensions/` and `skills/` without merging settings or user context.

Cloning over SSH (e.g. while the repo is private)? Pass the SSH source so the package installs the same way: `node install.mjs --self git@github.com:hsuanguo/pi-seed.git` (pi itself needs the `git:` prefix: `pi install git:git@github.com:hsuanguo/pi-seed`).

## Installer behavior

| Step | Source | Behavior |
| --- | --- | --- |
| Settings | `setup/settings.json` | Merged into `~/.pi/agent/settings.json`. Lists are unioned; any value you already set is kept (`--force` takes this setup's value). An explicit `-codemode` of yours is never flipped. Backed up as `settings.json.bak-<time>`. |
| Packages | `packages` in `setup/settings.json` | `pi install` for each one you don't have yet, plus this repo for its extensions and skills. |
| AGENTS.md | `setup/AGENTS.md` | Copied directly to your agent directory without boundary markers, only if no supported context file exists (`AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, or `CLAUDE.MD`). Otherwise skipped with a reminder to maintain it yourself, even with `--force`. |
| Prompt | [setup/prompts/improve-agents-md.md](../setup/prompts/improve-agents-md.md) | Copied to `~/.pi/agent/prompts/improve-agents-md.md`. Existing content is kept; `--force` replaces it after backing it up. Identical content is skipped. |
| Prompt | [setup/prompts/show-me.md](../setup/prompts/show-me.md) | Copied to `~/.pi/agent/prompts/show-me.md`, with the same protection for existing content. Adds `/show-me` for focused visual explanations. |
| Extensions | `extensions/` | Loaded from this package, see [Extensions](../README.md#extensions). |
| Skills | `skills/` | Includes [background-tasks](../skills/background-tasks/SKILL.md) for background waits and scheduling, [pr-sitting](../skills/pr-sitting/SKILL.md) for PR work, and [pi-skill-creator](../skills/pi-skill-creator/SKILL.md) for creating and evaluating skills. See [skills/README.md](../skills/README.md). |

Rerunning is safe: anything already in place is skipped.

Options: `--dry-run`, `--force`, `--no-packages`, `--no-agents`, `--no-prompts`, `--no-self`, `--self <source>`. `PI_CODING_AGENT_DIR` targets another agent directory, e.g. for a trial run:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-try node install.mjs --self ./
```

## Updating

- Extensions and skills: `pi update git:github.com/hsuanguo/pi-seed` (or `pi update --extensions`).
- Settings / new packages: `git pull && node install.mjs`.
- Prompts: rerun the installer; existing content is kept. To take updated templates, use `--force` (also replaces differing settings; both are backed up).
- User context: manually merge any wanted changes from `setup/AGENTS.md`. Existing files, including those installed by older versions, are left untouched.

## Uninstall

```bash
pi remove git:github.com/hsuanguo/pi-seed   # and any package you don't want: pi remove npm:<name>
```

Remove the copied instructions from your user context file manually, keeping any custom content. Restore `settings.json.bak-<time>` if you want your old settings back. Remove `prompts/improve-agents-md.md` and `prompts/show-me.md` from your pi agent directory to uninstall the prompts.

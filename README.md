# pi-seed

A small [pi](https://pi.dev) setup, shared as a starting point for your own: extensions, a skills directory,
packages, a reusable prompt, default settings, and AGENTS.md.

## Philosophy

**Less is More.** The goal is a minimal setup that stays stable, reliable, and easy to understand.
Sharing it gives others a practical foundation they can inspect, try, and adapt to their own work.

- Keep defaults small and purposeful; add something only when it solves a recurring need.
- Favor predictable behavior and simple configuration that is easy to maintain.
- Take what helps you, remove what doesn't, and build from there.

This is a starting point, not an endpoint. Your setup should grow with your needs.

## Install

Requires pi (and therefore Node.js).

```bash
git clone https://github.com/hsuanguo/pi-seed && cd pi-seed
node install.mjs --dry-run   # preview every change
node install.mjs
```

Then start a new pi session (or `/reload` a running one).

Only want the extensions and skills? `pi install git:github.com/hsuanguo/pi-seed` — this repo is a
pi package that ships `extensions/` and `skills/` without merging settings or user context.

Cloning over SSH (e.g. while the repo is private)? Pass the SSH source so the package installs the same way:
`node install.mjs --self git@github.com:hsuanguo/pi-seed.git` (pi itself needs the `git:` prefix:
`pi install git:git@github.com:hsuanguo/pi-seed`).

## What it does

| Step | Source | Behavior |
|---|---|---|
| Settings | `setup/settings.json` | Merged into `~/.pi/agent/settings.json`. Lists are unioned; any value you already set is kept (`--force` takes this setup's value). An explicit `-codemode` of yours is never flipped. Backed up as `settings.json.bak-<time>`. |
| Packages | `packages` in `setup/settings.json` | `pi install` for each one you don't have yet, plus this repo for its extensions and skills. |
| AGENTS.md | `setup/AGENTS.md` | Copied directly to your agent directory without boundary markers, only if no supported context file exists (`AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, or `CLAUDE.MD`). Otherwise skipped with a reminder to maintain it yourself, even with `--force`. |
| Prompt | [setup/prompts/improve-agents-md.md](setup/prompts/improve-agents-md.md) | Copied to `~/.pi/agent/prompts/improve-agents-md.md`. Existing content is kept; `--force` replaces it after backing it up. Identical content is skipped. |
| Extensions | `extensions/` | Loaded from this package, see [Extensions](#extensions). |
| Skills | `skills/` | Includes [background-tasks](skills/background-tasks/SKILL.md) for background execution, scheduled checks, reminders, and recurring tasks using pi-subagents. See [skills/README.md](skills/README.md). |

Rerunning is safe: anything already in place is skipped.

Options: `--dry-run`, `--force`, `--no-packages`, `--no-agents`, `--no-prompts`, `--no-self`, `--self <source>`.
`PI_CODING_AGENT_DIR` targets another agent directory, e.g. for a trial run:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-try node install.mjs --self ./
```

## Improve Agent Instructions

The installer adds `/improve-agents-md` globally, available in any project after
starting a new pi session or running `/reload`:

```text
/improve-agents-md
/improve-agents-md packages/api/AGENTS.md
/improve-agents-md "/path/to/another project/AGENTS.md" audit-only
```

The prompt checks clarity, duplication, and project-specific constraints. It reports
findings and proposes a minimal patch without editing until approved; `audit-only`
reports findings without proposing a patch. It defaults to `AGENTS.md` in cwd.
The prompt is installed by `install.mjs`, not by `pi install` alone.

## Make it your own

Before installing, review `setup/settings.json` and `setup/AGENTS.md`. Adjust the package list,
defaults, and instructions to fit your workflow, then preview the changes with `--dry-run`.
Use `--no-packages`, `--no-agents`, or `--no-prompts` to skip those parts, or install just the extensions and skills
with the pi package command above. The [extension selection example](#extensions) lets you choose
which extensions to load.

Share improvements that make this foundation simpler or more dependable. Keep specialized workflows
in your own setup unless they serve a clear, common need.

## Extensions

| Extension | What it does | Command |
|---|---|---|
| `claude-skills.ts` | Loads skills from `~/.claude/skills/` and project `.claude/skills/` (trusted projects only). `ancestors` (default) searches upward; `eager` also discovers nested project skill directories. Config: `claudeSkills` in `pi-seed-config.json`. | `/claude-skills` |
| `scoped-context.ts` | Loads `AGENTS.md` / `CLAUDE.md` from subdirectories of the working directory: `lazy` (default) appends a file the first time a tool touches a path below it; `eager` adds all of them to the system prompt. Config: `scopedContext` in `pi-seed-config.json`. | `/scoped-context` |

Details are in the comment at the top of each file.

Both extensions use the same optional configuration file: `~/.pi/agent/pi-seed-config.json`
(or `$PI_CODING_AGENT_DIR/pi-seed-config.json`), with project overrides in
`<cwd>/.pi/pi-seed-config.json`. Project configuration is read only when the project is trusted;
valid project values override user values field by field. Missing sections use defaults.

```json
{
  "claudeSkills": {
    "mode": "ancestors",
    "ignoreUserSkills": false,
    "ignoreProjectSkills": false
  },
  "scopedContext": {
    "mode": "lazy"
  }
}
```

| Field | Values | Default | Effect |
|---|---|---|---|
| `claudeSkills.mode` | `"ancestors"`, `"eager"` | `"ancestors"` | `ancestors` searches cwd and its ancestors up to the Git root. `eager` also searches nested directories below the Git root (or cwd outside Git). This controls skill discovery, not insertion of full skill instructions into the prompt. |
| `claudeSkills.ignoreUserSkills` | `true`, `false` | `false` | `true` skips user skills in `~/.claude/skills/`; `false` includes them. |
| `claudeSkills.ignoreProjectSkills` | `true`, `false` | `false` | `true` skips project `.claude/skills/` directories; `false` includes them when the project is trusted. |
| `scopedContext.mode` | `"lazy"`, `"eager"` | `"lazy"` | `lazy` appends relevant subdirectory instructions to tool results when a path in that scope is touched. `eager` adds all discovered subdirectory instructions to the system prompt. |

The ignore flags apply only to Claude skill directories, not pi's native or packaged skills.

Set `claudeSkills.mode` to `"eager"` to discover directories such as
`<repo-root>/A/.claude/skills/`, even when starting pi in another repository subdirectory.
Outside Git, the downward scan starts at cwd. Hidden directories (except the `.claude/skills`
candidate at each visited directory), `node_modules`, and directory symlinks are skipped.
Nested repositories containing a `.git` directory or file are also skipped entirely,
including their own `.claude/skills/`. Start pi inside a nested repository to load its skills.
The downward scan only runs for trusted projects with project skills enabled. User skills
and existing ancestor skill directories retain priority over newly discovered directories.
This registers skills at startup or `/reload`; it does not eagerly insert every skill's full
instructions into the system prompt.

Invalid JSON, invalid section types, unknown sections or fields, and invalid values produce
warnings; invalid values do not replace valid user values. Run `/reload` after editing.
The installer does not create or migrate this optional file. To migrate existing configuration,
move values from `claude-skills.json` into `claudeSkills` and from `scoped-context.json` into
`scopedContext`, at the same user or project scope. The old files are no longer read.

To load only some of them, use the object form of the package in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    { "source": "git:github.com/hsuanguo/pi-seed", "extensions": ["!extensions/claude-skills.ts"] }
  ]
}
```

## Contributing

Keep contributions small and focused on making this shared starting point simpler or more reliable.
The root [AGENTS.md](AGENTS.md) covers development conventions and installer compatibility.
Run `npm ci --ignore-scripts && npm run check` before submitting: tests run in disposable directories and never
touch your pi settings or sessions. Use `pi -e ./` to try this checkout for one run.

## Updating

- Extensions and skills: `pi update git:github.com/hsuanguo/pi-seed` (or `pi update --extensions`).
- Settings / new packages: `git pull && node install.mjs`.
- Prompt: rerun the installer; existing content is kept. To take an updated template, use `--force` (also replaces differing settings; both are backed up).
- User context: manually merge any wanted changes from `setup/AGENTS.md`. Existing files, including those installed by older versions, are left untouched.

## Notes

- No credentials are included: `auth.json`, `models.json`, and `mcp.json` are not part of this setup.

## Uninstall

```bash
pi remove git:github.com/hsuanguo/pi-seed   # and any package you don't want: pi remove npm:<name>
```

Remove the copied instructions from your user context file manually, keeping any custom content. Restore `settings.json.bak-<time>` if you want your old settings back.
Remove `prompts/improve-agents-md.md` from your pi agent directory to uninstall the prompt.

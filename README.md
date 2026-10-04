# pi-dotfiles

A small [pi](https://pi.dev) setup, shared as a starting point for your own: extensions, skills,
packages, default settings, and AGENTS.md.

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
git clone https://github.com/hsuanguo/pi-dotfiles && cd pi-dotfiles
node install.mjs --dry-run   # preview every change
node install.mjs
```

Then start a new pi session (or `/reload` a running one).

Only want the extensions and skills? `pi install git:github.com/hsuanguo/pi-dotfiles` — this repo is a
pi package that ships `extensions/` and `skills/`.

Cloning over SSH (e.g. while the repo is private)? Pass the SSH source so the package installs the same way:
`node install.mjs --self git@github.com:hsuanguo/pi-dotfiles.git` (pi itself needs the `git:` prefix:
`pi install git:git@github.com:hsuanguo/pi-dotfiles`).

## What it does

| Step | Source | Behavior |
|---|---|---|
| Settings | `setup/settings.json` | Merged into `~/.pi/agent/settings.json`. Lists are unioned; any value you already set is kept (`--force` takes this setup's value). An explicit `-codemode` of yours is never flipped. Backed up as `settings.json.bak-<time>`. |
| Packages | `packages` in `setup/settings.json` | `pi install` for each one you don't have yet, plus this repo for its extensions and skills. |
| AGENTS.md | `setup/AGENTS.md` | Written as a `<!-- pi-dotfiles:begin -->…<!-- pi-dotfiles:end -->` block in your user context file (`AGENTS.md`, or the `CLAUDE.md` / `AGENTS.override.md` you already use). Your own content outside the block is kept; rerunning replaces only the block. Backed up first. |
| Extensions | `extensions/` | Loaded from this package, see [Extensions](#extensions). |
| Skills | `skills/` | Loaded from this package: `skill-creator`. |

Rerunning is safe: anything already in place is skipped.

Options: `--dry-run`, `--force`, `--no-packages`, `--no-agents`, `--no-self`, `--self <source>`.
`PI_CODING_AGENT_DIR` targets another agent directory, e.g. for a trial run:

```bash
PI_CODING_AGENT_DIR=/tmp/pi-try node install.mjs --self ./
```

## Make it your own

Before installing, review `setup/settings.json` and `setup/AGENTS.md`. Adjust the package list,
defaults, and instructions to fit your workflow, then preview the changes with `--dry-run`.
Use `--no-packages` or `--no-agents` to skip those parts, or install only the extensions and skills
with the pi package command above. The [extension selection example](#extensions) lets you choose
which extensions to load.

Share improvements that make this foundation simpler or more dependable. Keep specialized workflows
in your own setup unless they serve a clear, common need.

## Extensions

| Extension | What it does | Command |
|---|---|---|
| `claude-skills.ts` | Loads skills from `~/.claude/skills/` and project `.claude/skills/` (trusted projects only). Config: `~/.pi/agent/claude-skills.json`. | `/claude-skills` |
| `scoped-context.ts` | Loads `AGENTS.md` / `CLAUDE.md` from subdirectories of the working directory: `lazy` (default) appends a file the first time a tool touches a path below it; `eager` adds all of them to the system prompt. Config: `~/.pi/agent/scoped-context.json`, e.g. `{ "mode": "eager" }`. | `/scoped-context` |

Details are in the comment at the top of each file.

To load only some of them, use the object form of the package in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    { "source": "git:github.com/hsuanguo/pi-dotfiles", "extensions": ["!extensions/claude-skills.ts"] }
  ]
}
```

## Updating

- Extensions and skills: `pi update git:github.com/hsuanguo/pi-dotfiles` (or `pi update --extensions`).
- Settings / AGENTS.md / new packages: `git pull && node install.mjs`.

## Notes

- `skill-creator` is Apache-2.0, see `skills/skill-creator/LICENSE.txt`.
- No credentials are included: `auth.json`, `models.json`, and `mcp.json` are not part of this setup.

## Uninstall

```bash
pi remove git:github.com/hsuanguo/pi-dotfiles   # and any package you don't want: pi remove npm:<name>
```

Delete the `pi-dotfiles` block from your AGENTS.md, and restore `settings.json.bak-<time>` if you want your old settings back.

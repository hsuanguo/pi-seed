<p align="center">
  <img src="assets/pi-seed-logo.png" alt="pi-seed — a pixel-art seed sprouting a π-shaped stem" width="256" />
</p>

<p align="center">
  <strong>A minimal <a href="https://pi.dev">pi</a> setup you can make your own.</strong><br />
  Extensions, skills, packages, reusable prompts, settings, and agent instructions.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#whats-included">What's included</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#documentation">Docs</a>
</p>

**Less is More.** Keep defaults small, add what solves a recurring need, and adapt this setup to your workflow.

## Install

Requires Node.js 22.19+.

### Recommended: install with your AI assistant

1. [Install pi](https://pi.dev/) and start a session with a working model.
2. Paste this prompt into pi:

```text
Fetch https://raw.githubusercontent.com/hsuanguo/pi-seed/main/install.md and follow it. Ask me about optional setup and wait for my approval before installing packages or changing my files.
```

The [installation prompt](install.md) guides the agent through checks, your choices, an approved plan, and verification. The recommended setup includes pi-seed and five essential third-party packages: `pi-web-access`, `pi-cache-optimizer`, `@juicesharp/rpiv-todo`, `pi-subagents`, and `pi-lens`. You choose settings, prompts, and initial instructions. Existing context files always stay untouched. These packages are essential to this setup, not to pi itself.

The agent can fetch the guide with its shell tools; no web extension is needed beforehand. Review its plan before approval. AI-assisted setup can vary by model; use the manual method if you prefer predictable installer behavior.

### Manual installation

```bash
git clone https://github.com/hsuanguo/pi-seed && cd pi-seed
node install.mjs --dry-run   # preview changes
node install.mjs
```

Start a new pi session or run `/reload`.

The installer merges settings, installs packages, and copies prompts to `~/.pi/agent/`. It preserves existing settings and prompts unless `--force` is used, and backs up files before replacing them. It copies the agent instructions only when no supported user context file exists; existing context files are always left for you to maintain manually.

For just the extensions and skills:

```bash
pi install git:github.com/hsuanguo/pi-seed
```

**pi-web users:**

- Do not use the pi-web built-in subagent(default off)
- Due to the limitation of pi-web, set `PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT` before you launch it.

```bash
SDK_ROOT="$(npm root -g)/@agegr/pi-web/node_modules/@earendil-works/pi-coding-agent"
export PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT="$SDK_ROOT"
```

See [installation details](docs/installation.md) for options, SSH sources, updates, uninstalling, and details about [pi-web SDK-root workaround](docs/installation.md#pi-web-subagent-startup-workaround).

## What's included

### Extensions

| Extension | What it does | Usage |
| --- | --- | --- |
| `claude-skills.ts` | Discovers skills in user and trusted project `.claude/skills/` directories. | `/claude-skills` shows discovery status. |
| `scoped-context.ts` | Loads subdirectory `AGENTS.md` / `CLAUDE.md` instructions as you work. | `/scoped-context` shows loaded context. |
| `ask-user-question/` | Adds structured questions with choices, custom answers, notes, and review in terminal and pi-web/RPC dialogs. | Pi calls `ask_user_question` when it needs a decision. |
| `handoff/` | Splits a task and relevant context into a persistent session in an independent Git worktree. Works in CLI and pi-web without a host dependency. | `/handoff [task]` or ask Pi to hand an issue off to a new session. |

### Skills and prompts

Use `pi-skill-creator` to develop your own skills and `background-tasks` to manage long-running work. The other bundled skills and prompts are working examples you can use as-is or adapt as references for new use cases. PR sitting shows one way to build on background tasks; the same approach can support job monitoring, recurring checks, and other workflows that wake the session when results are ready.

| Item | What it does | Usage |
| --- | --- | --- |
| `background-tasks` | Background work, bounded scheduled checks, and reminders. | Ask Pi to run work in the background or schedule checks. |
| `pr-sitting` | Continuous PR review, author maintenance, or monitoring. | Ask Pi to review, maintain, or watch a PR. |
| `pi-skill-creator` | Creates and improves skills, with evaluations against a baseline. | `/skill:pi-skill-creator` or ask Pi to create a skill. |
| `improve-agents-md` | Audits agent instructions and proposes a minimal patch for approval. | `/improve-agents-md [path] [audit-only]` |
| `show-me` | Explains the current topic or a named concept visually. | `/show-me [topic]` |

Prompts are copied by the agent-led setup or `install.mjs`; extensions and skills are also available through `pi install`. See the [workflow guide](docs/workflows.md) for examples and the [skills directory](skills/README.md) for skill instructions.

### Setup defaults

[setup/settings.json](setup/settings.json) enables skill commands and codemode, and installs `pi-web-access`, `pi-cache-optimizer`, `@juicesharp/rpiv-todo`, `pi-subagents`, and `pi-lens`. [setup/AGENTS.md](setup/AGENTS.md) provides the user instruction template. No credentials are included.

## Usage

Use Pi as you normally would: describe the task and let the agent choose the tools. With the setup installed, `codemode` lets it combine sequences of tool calls into fewer model turns. Long-running work can run in the background and wake the session when it finishes, leaving you free to continue chatting. Keep Pi running to receive completion notifications.

Claude skills are discovered automatically from your user and trusted project skill directories. Subdirectory instructions load as the agent works, and structured questions appear when it needs your input.

Use `/handoff Fix the cache issue we just found` to split a side issue into its own task. Pi prepares a focused brief, creates a worktree from the current checkout's exact HEAD, and saves a new, idle session there. Open it with the returned command or refresh pi-web's session list. Your original session stays in place. Local changes and ignored files are not copied; keep the new worktree until you explicitly remove it. See [handoff details](docs/workflows.md#handoff).

Setup includes [pi-subagents](https://github.com/nicobailon/pi-subagents). Ask Pi to delegate in plain language:

| Use case | Example request |
| --- | --- |
| Explore code | Have scout map the installer flow before we plan a change. |
| Challenge a plan | Ask oracle to identify hidden assumptions and simpler alternatives. |
| Review from several angles | Use independent reviewers for correctness, missing tests, and maintainability, then combine their findings. |
| Work in the background | Delegate this investigation in the background and bring back the report when it finishes. |

See [subagent examples](docs/subagents.md) for more workflow guide.

This setup is optimized for recurring and scheduled monitoring, for example, ask Pi to watch a PR:

```text
Watch PR #123 every 10 minutes for 24 hours and notify me when action is needed.
```

It can also review new revisions or maintain your PR by addressing feedback. See [PR Sitting](docs/workflows.md#pr-sitting) for modes and permissions.

## Configuration

The recommended agent-led setup asks which settings, prompts, and initial instructions you want. All five third-party packages are essential to that setup. For the manual installer, you can customize [setup/settings.json](setup/settings.json) and [setup/AGENTS.md](setup/AGENTS.md). Preview with `--dry-run`; use `--no-packages`, `--no-agents`, or `--no-prompts` to skip those parts.

For extension options, create `~/.pi/agent/pi-seed-config.json` (or `$PI_CODING_AGENT_DIR/pi-seed-config.json`). These are the defaults:

```json
{
  "claudeSkills": {
    "mode": "ancestors",
    "ignoreUserSkills": false,
    "ignoreProjectSkills": false
  },
  "scopedContext": {
    "mode": "lazy"
  },
  "askUserQuestion": {
    "timeoutSeconds": 0
  }
}
```

Trusted projects can override individual fields in `<cwd>/.pi/pi-seed-config.json`. Run `/reload` after editing. Use `"eager"` for broader skill discovery or upfront context loading; set a positive `timeoutSeconds` for unattended questionnaires (`0` waits indefinitely). The first response disables that questionnaire's timer; expiry submits no answers and grants no approval.

See the [configuration reference](docs/configuration.md) for all options, discovery rules, configuration migration, and selecting which extensions to load.

## Updating

```bash
pi update git:github.com/hsuanguo/pi-seed   # extensions and skills
git pull && node install.mjs              # setup templates and packages
```

Existing prompts are preserved; `--force` replaces them and differing settings after backup. Existing user context files are skipped with a yellow warning in terminals (`NO_COLOR` disables color). Manually merge any wanted changes from `setup/AGENTS.md` into your user context.

## Documentation

- [Installation and updates](docs/installation.md): installer behavior, flags, SSH, and uninstalling.
- [Extension configuration](docs/configuration.md): options, discovery behavior, and extension selection.
- [Structured questions](docs/ask-user-question.md): controls and timeouts.
- [Subagent examples](docs/subagents.md): exploration, parallel review, research, and background work.
- [Prompts and skill workflows](docs/workflows.md): usage examples and operating details.
- [Development](docs/development.md): local checks, personal extension copies, and browser verification.

Keep contributions small and focused. See [AGENTS.md](AGENTS.md) for repository conventions.

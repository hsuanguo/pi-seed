# Prompts and skill workflows

## Handoff

Split an issue discovered in the current conversation into a separate task:

```text
/handoff Fix the stale cache issue we just found
```

With no argument, `/handoff` asks Pi to hand off the issue just identified. You can also ask in plain language: “Hand this issue off to a new session in its own worktree, with the relevant findings.” The current model prepares a self-contained task and focused context, then calls `handoff`. This uses an ordinary model turn in the current session. Review the brief in the tool arguments or the new session; it is model-generated and may omit details.

The extension creates a unique `handoff/<title>-<id>` branch from the **current checkout's exact HEAD**, including when that checkout is already a worktree. The new checkout lives under `<main-repo>-worktrees/handoff-<title>-<id>`. The new session starts at the checkout root, even when the source session was in a subdirectory. Worktrees start from committed files: staged, unstaged, untracked and ignored files, dependencies, and local configuration are not copied. Tracked/untracked local changes produce a warning in both the result and the brief. The extension never commits or stashes your work.

The new session contains the task, relevant context, source session/entry information, source working directory, base commit, and the source model selection. It uses pi's default session storage for the new working directory, even when the parent uses a custom `--session-dir`. A persisted parent is linked through `parentSession`; an ephemeral parent is identified in the brief without a dangling file link. The receipt also stays on the source session branch and in the tool result, so it remains available after resume or compaction.

The new task is **idle until you open it and send a message**. The extension starts no child process or model turn in the new session, and leaves the original session active. In the CLI, use the returned POSIX shell command (`cd ... && pi --session ...`) in another terminal. In pi-web, refresh the session list and select the named new session; Git worktree discovery groups it with the same project. Opening/switching a web tab is not automated. No pi-web server, HTTP API, or pi-subagents package is required.

Successful worktrees and branches remain until you remove them explicitly, through pi or Git. Removing the checkout leaves its session history on disk but prevents continuing work there until the checkout is restored. Failure or cancellation rolls back newly created resources only when they remain unchanged; modified, untracked, or ignored files and changed commits are retained and reported. Git checkout is allowed to settle, with a five-minute timeout, before cancellation cleanup. The extension has no configuration or automatic cleanup process.

## Improve Agent Instructions

The installer adds `/improve-agents-md` globally, available in any project after starting a new pi session or running `/reload`:

```text
/improve-agents-md
/improve-agents-md packages/api/AGENTS.md
/improve-agents-md "/path/to/another project/AGENTS.md" audit-only
```

The prompt checks clarity, duplication, and project-specific constraints. It reports findings and proposes a minimal patch without editing until approved; `audit-only` reports findings without proposing a patch. It defaults to `AGENTS.md` in cwd. The prompt is installed by `install.mjs`, not by `pi install` alone.

## Show Me

The installer also adds `/show-me` globally. Run `/reload` after installation:

```text
/show-me
/show-me installer control flow
```

With no arguments, it explains the current discussion point. It chooses a focused visual such as pseudocode, a call or file tree, Mermaid, or a diff. Dense concepts or visual comparisons can use an HTML artifact. Like `/improve-agents-md`, it is installed by `install.mjs`, not by `pi install` alone.

## Background tasks

The user context template directs the agent to load `background-tasks` for prolonged waits or ongoing polling, even if discovered midway through a task. Waits over roughly 30 minutes call for particular consideration of background execution or scheduled checks; shorter waits can also benefit. Duration, uncertainty, keeping the parent available, and setup cost guide the choice, while explicit foreground or background requests take precedence. Existing users must manually merge the wanted rules from `setup/AGENTS.md`; the installer preserves existing context files.

## PR Sitting

The package includes the `pr-sitting` skill. Pi can load it from a natural-language request; no prompt command is required:

```text
Keep reviewing PR #123 as it changes until the findings are addressed.
Maintain my PR #123: address review feedback and reply after verifying fixes.
Watch PR #123 every 10 minutes for 24 hours and notify me when action is needed.
```

`review` follows new revisions and rechecks earlier findings until the agreed review criteria are met. `maintain` handles review feedback as the PR author, including focused fixes, tests, normal pushes, and replies. `watch` only reports material changes. Merging, force-pushing, and changing protections need separate authorization; posting formal reviews also needs permission.

All modes use bounded reminder schedules through the `background-tasks` skill. The same parent session performs the work and persists a PR ledger for recovery after compaction, rather than launching a fresh reviewer on each check. Future checks require the owning Pi process and session to stay alive. Loading the skill does not authorize mutations; confirm the mode and its permissions first. It is distributed through `pi.skills`, so `pi install` includes it without a separate prompt copy. If you installed the former `/pr-sitter` prompt, remove `prompts/pr-sitter.md` from your agent directory yourself; updates do not delete existing user files.

## Skill Creation and Evaluation

Use `/skill:pi-skill-creator` or ask Pi to create, evaluate, or improve a skill. It compares a skill against a baseline using fresh child sessions, a frozen private skill snapshot, and independent copies of input fixtures. It separates forced-use effectiveness tests from natural description-trigger tests.

The bundled Node.js helpers prepare pairs and produce JSON and Markdown benchmarks; they do not launch paid model calls themselves. Evaluations use the operator's chosen model through pi-subagents. Missing telemetry stays unknown, and incomplete or invalid pairs are excluded with reasons. Child agents still have ordinary file access, so this isolates conversation and working state without providing an OS sandbox. See the skill's [evaluation guide](../skills/pi-skill-creator/references/evaluation.md) and [source/version notes](../skills/pi-skill-creator/references/sources.md).

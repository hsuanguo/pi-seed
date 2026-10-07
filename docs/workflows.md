# Prompts and skill workflows

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

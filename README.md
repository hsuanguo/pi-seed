<p align="center">
  <img src="assets/pi-seed-logo.png" alt="pi-seed — a pixel-art seed sprouting a π-shaped stem" width="256" />
</p>

<p align="center">
  <strong>A minimal <a href="https://pi.dev">pi</a> setup you can make your own.</strong><br />
  Extensions, skills, packages, reusable prompts, settings, and agent instructions.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#what-it-does">What's included</a> ·
  <a href="#make-it-your-own">Make it your own</a>
</p>

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
| Prompt | [setup/prompts/show-me.md](setup/prompts/show-me.md) | Copied to `~/.pi/agent/prompts/show-me.md`, with the same protection for existing content. Adds `/show-me` for focused visual explanations. |
| Extensions | `extensions/` | Loaded from this package, see [Extensions](#extensions). |
| Skills | `skills/` | Includes [background-tasks](skills/background-tasks/SKILL.md) for background waits and scheduling, [pr-sitting](skills/pr-sitting/SKILL.md) for PR work, and [pi-skill-creator](skills/pi-skill-creator/SKILL.md) for creating and evaluating skills. See [skills/README.md](skills/README.md). |

Rerunning is safe: anything already in place is skipped.

The user context template directs the agent to load `background-tasks` for prolonged waits or ongoing polling, even if discovered midway through a task. Waits over roughly 30 minutes call for particular consideration of background execution or scheduled checks; shorter waits can also benefit. Duration, uncertainty, keeping the parent available, and setup cost guide the choice, while explicit foreground or background requests take precedence. Existing users must manually merge the wanted rules from `setup/AGENTS.md`; the installer preserves existing context files.

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

## Show Me

The installer also adds `/show-me` globally. Run `/reload` after installation:

```text
/show-me
/show-me installer control flow
```

With no arguments, it explains the current discussion point. It chooses a focused
visual such as pseudocode, a call or file tree, Mermaid, or a diff. Dense concepts
or visual comparisons can use an HTML artifact. Like `/improve-agents-md`, it is
installed by `install.mjs`, not by `pi install` alone.

## PR Sitting

The package includes the `pr-sitting` skill. Pi can load it from a natural-language
request; no prompt command is required:

```text
Keep reviewing PR #123 as it changes until the findings are addressed.
Maintain my PR #123: address review feedback and reply after verifying fixes.
Watch PR #123 every 10 minutes for 24 hours and notify me when action is needed.
```

`review` follows new revisions and rechecks earlier findings until the agreed
review criteria are met. `maintain` handles review feedback as the PR author,
including focused fixes, tests, normal pushes, and replies. `watch` only reports
material changes. Merging, force-pushing, and changing protections need separate
authorization; posting formal reviews also needs permission.

All modes use bounded reminder schedules through the `background-tasks` skill.
The same parent session performs the work and persists a PR ledger for recovery
after compaction, rather than launching a fresh reviewer on each check. Future
checks require the owning Pi process and session to stay alive. Loading the skill
does not authorize mutations; confirm the mode and its permissions first.
It is distributed through `pi.skills`, so `pi install` includes it without a
separate prompt copy. If you installed the former `/pr-sitter` prompt, remove
`prompts/pr-sitter.md` from your agent directory yourself; updates do not delete
existing user files.

## Skill Creation and Evaluation

Use `/skill:pi-skill-creator` or ask Pi to create, evaluate, or improve a skill.
The skill adapts [S1M0N38/pi-skill-creator](https://github.com/S1M0N38/pi-skill-creator)
to the `pi-subagents` package already installed by setup. It compares a skill
against a baseline using fresh child sessions, a frozen private skill snapshot,
and independent copies of input fixtures. It separates forced-use effectiveness
tests from natural description-trigger tests.

The bundled Node.js helpers prepare pairs and produce JSON and Markdown benchmarks;
they do not launch paid model calls themselves. Evaluations use the operator's
chosen model through pi-subagents. Missing telemetry stays unknown, and incomplete
or invalid pairs are excluded with reasons. Child agents still have ordinary file
access, so this isolates conversation and working state without providing an OS
sandbox. See the skill's [evaluation guide](skills/pi-skill-creator/references/evaluation.md)
and [source/version notes](skills/pi-skill-creator/references/sources.md).

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
| `ask-user-question/` | Adds `ask_user_question`: 1–4 questions with single/multiple choices, custom answers, previews, notes, and editable review. Tabbed TUI in the terminal; native pi-web/RPC dialogs with Continue/Back after choices and editable review. Optional no-response timeout for unattended runs: `askUserQuestion.timeoutSeconds`. | Model tool |

Details are in the comment at the top of each file.

All extensions use the same optional configuration file: `~/.pi/agent/pi-seed-config.json`
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
  },
  "askUserQuestion": {
    "timeoutSeconds": 0
  }
}
```

| Field | Values | Default | Effect |
|---|---|---|---|
| `claudeSkills.mode` | `"ancestors"`, `"eager"` | `"ancestors"` | `ancestors` searches cwd and its ancestors up to the Git root. `eager` also searches nested directories below the Git root (or cwd outside Git). This controls skill discovery, not insertion of full skill instructions into the prompt. |
| `claudeSkills.ignoreUserSkills` | `true`, `false` | `false` | `true` skips user skills in `~/.claude/skills/`; `false` includes them. |
| `claudeSkills.ignoreProjectSkills` | `true`, `false` | `false` | `true` skips project `.claude/skills/` directories; `false` includes them when the project is trusted. |
| `scopedContext.mode` | `"lazy"`, `"eager"` | `"lazy"` | `lazy` appends relevant subdirectory instructions to tool results when a path in that scope is touched. `eager` adds all discovered subdirectory instructions to the system prompt. |
| `askUserQuestion.timeoutSeconds` | Integer `0`–`86400` | `0` | `0` waits indefinitely. A positive value is how long a questionnaire waits for a first response; any response turns the timer off. |

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

### Structured questions

The model calls `ask_user_question` when it needs a decision. Each question has a
header (up to 16 characters) and 2–4 options with labels (up to 60 characters) and
descriptions. The tool automatically adds a custom-answer control. Only **Submit
answers** sends the answers and notes to the model. All questions must be answered;
an explicitly empty multi-selection is valid. Cancelling or interrupting discards
unsubmitted drafts instead of treating them as decisions.

- **Terminal:** Tab / Shift+Tab or ← / → switches question and Review tabs.
  ↑ / ↓ moves between options. Enter selects; Space toggles multiple choices.
  The custom-answer row opens a multiline editor: Enter saves, Shift+Enter adds a
  line, Ctrl+U clears, and Esc returns without changing the committed answer.
  Text drafts survive tab switches. `n` edits a question note, or a global note on
  Review. PgUp / PgDn scrolls question details and Markdown previews; wide screens
  show them beside the options. Ctrl+] hides/shows the overlay to read the transcript.
  Esc outside the editor cancels the entire questionnaire.
- **Unmodified pi-web / RPC:** Keeps the host's ordinary mouse-friendly
  `select()` / `editor()` dialogs, even when it offers `custom()`. No host fork,
  private API, extra server, port, or frontend patch is required.
  Questions appear at the top, then the answer choices and secondary actions.
  Available navigation comes at the end: **Continue**, then **Back**.
  The first question has no Back. A fresh single-select question has no
  Continue until it has an answer.
  Back returns to the previous question without clearing any answers. Review
  also offers Back to return to the last question.
  These controls are normal option-list buttons, not additions to the host's
  fixed Cancel footer. The host controls their styling and one-column layout.
  Multi-select uses clickable `[ ]` / `[x]` rows. Single choices advance
  automatically; multi-selection stays until Continue.
  **More actions** contains full question/option details, previews, question notes,
  and a shortcut to review. Custom answers use an editor with the previous text
  prefilled. Review has a short title and compact answer summaries in the Edit
  rows (multiple choices show the first choice plus a count); it does not repeat
  every full question. Global notes remain editable there. To inspect a full
  answer or note, open its Edit row, then Details & previews or the text editor.
  Only display text is shortened; submitted data stays complete. The host owns
  the Cancel button: dismissing a main question/review cancels the questionnaire;
  dismissing an editor, More actions, or details returns to the parent question.
  Button styles and layout still come from the host; this is not a custom Web form.
- **Print / JSON:** The tool reports that no UI is available and tells the model
  to ask in plain chat. It does not claim the user declined.
- The tool is model-only and sequential: codemode cannot invoke it, and sibling
  tool calls cannot open overlapping questionnaires. Submitted data is stored in
  the tool result, so it follows the active session branch.

#### Optional no-response timeout

Set `askUserQuestion.timeoutSeconds` in the shared `pi-seed-config.json`, for example:

```json
{
  "askUserQuestion": {
    "timeoutSeconds": 120
  }
}
```

The default is `0` (disabled). User configuration applies everywhere; a trusted
project can override it, including setting `0`. Invalid values warn and do not
replace an earlier valid value. The tool reads this configuration for each call;
it does not change your settings, context files, or configuration on disk.

It is meant for **unattended runs**, not to hurry a present user:

- The countdown starts when the questionnaire opens. The host shows its ordinary
  expiry countdown on the first dialog; the TUI shows it in its status line.
- The **first user response** turns the timer off for the rest of that
  questionnaire: any native dialog choice (an answer, Back, Continue, a menu, or
  opening an editor) or any key in the TUI. From then on the questionnaire waits
  indefinitely, as when the timeout is disabled.
- There is no UI switch to disable it; answering is enough.
- The native extension API cannot report mouse movement, hovering, or scrolling.
  Those do not count as a response. Stop/reload still use normal host cancellation.

Expiry closes the waiting selector/TUI and returns `status: "timed_out"` with no
submitted answers or notes. Manual Cancel stays `cancelled`; Stop stays `aborted`.
The compatibility `cancelled` flag means "not submitted"; use `status` for the reason.
Timer cleanup prevents old expiry callbacks or late responses from affecting a
later questionnaire.

The Agent receives a normal tool result: it may state reasonable assumptions and
continue **already-authorized, low-risk work**. No extra model call is launched by
the extension. Timeout is not consent, not a user selection, and not permission
to perform approval-gated actions. If approval or essential data is still needed,
the result tells the Agent to leave that action blocked rather than infer consent.
Unsubmitted drafts are never promoted to answers by timeout.

This is an independent implementation inspired by
[`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)
(MIT). It keeps the question parameter shape and core questionnaire workflow, not
the upstream localization, notification events, external editor integration, or
configuration system.

**Existing installations:** Disable or remove the old package before loading this
extension. Both tools use the name `ask_user_question`; they must not load together.

```bash
pi remove npm:@juicesharp/rpiv-ask-user-question
```

Also check project-scoped package declarations, pinned versions, and explicit
extension paths. Remove or disable the old extension there too. Then update this
pi-seed package and start a new session or run `/reload`. The installer no longer
adds the old package, but it never removes existing packages or edits your user
instructions automatically. Merge any wanted guidance manually.

#### Trying the personal extension

Update **one** active extension copy, then run `/reload`; keep using the normal
`pi-web` command. If you use a personal copy, back it up outside the autoloaded
`extensions/` directory before copying the complete extension files (including
`config.ts` and `response-timeout.ts`):

```bash
agentDir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
backup="$agentDir/backups/questionnaire-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a "$agentDir/extensions/ask-user-question" "$backup/"
cp extensions/ask-user-question/*.ts "$agentDir/extensions/ask-user-question/"
```

Do not load a packaged copy alongside this personal copy: both register the
same tool name. The extension works with the normal, unmodified pi-web host.

#### Optional browser verification

The credential-free suite tests state and real pi sessions with `npm run check`.
The optional browser suite uses an **unmodified installed npm pi-web build** on a
free loopback port, with temporary HOME and agent directories and no inherited
model credentials. It does not build or edit the host, access your real sessions,
or call a paid model.

```bash
npx playwright install chromium
PI_WEB_PACKAGE_ROOT=/path/to/node_modules/@agegr/pi-web npm run test:questionnaire-web
```

You can set `E2E_CHROMIUM_EXECUTABLE` to an existing Chromium executable instead.
The test covers 1280px and 390px native dialogs, Continue/Back order, returning
and changing answers, multi-selection, both note scopes, custom text, active-request
refresh, review, Submit, Cancel, unattended expiry, and a response stopping the
timer. Results go to the ignored
`test-results/questionnaire-web/` directory.
These viewport checks do not claim real Safari/iOS coverage. See
[`assets/questionnaire-back.png`](assets/questionnaire-back.png) for an actual
unmodified-host screenshot.

## Contributing

Keep contributions small and focused on making this shared starting point simpler or more reliable.
The root [AGENTS.md](AGENTS.md) covers development conventions and installer compatibility.
Run `npm ci --ignore-scripts && npm run check` before submitting: tests run in disposable directories and never
touch your pi settings or sessions. Use `pi -e ./` to try this checkout for one run.

## Updating

- Extensions and skills: `pi update git:github.com/hsuanguo/pi-seed` (or `pi update --extensions`).
- Settings / new packages: `git pull && node install.mjs`.
- Prompts: rerun the installer; existing content is kept. To take updated templates, use `--force` (also replaces differing settings; both are backed up).
- User context: manually merge any wanted changes from `setup/AGENTS.md`. Existing files, including those installed by older versions, are left untouched.

## Notes

- No credentials are included: `auth.json`, `models.json`, and `mcp.json` are not part of this setup.

## Uninstall

```bash
pi remove git:github.com/hsuanguo/pi-seed   # and any package you don't want: pi remove npm:<name>
```

Remove the copied instructions from your user context file manually, keeping any custom content. Restore `settings.json.bak-<time>` if you want your old settings back.
Remove `prompts/improve-agents-md.md` and `prompts/show-me.md` from your pi agent directory to uninstall the prompts.

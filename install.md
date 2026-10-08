# Install pi-seed with an AI assistant

You are helping a user install pi-seed in an existing pi session. Follow this guide as a procedure, not as permission to make changes without approval. If you cannot run commands or fetch files, explain the limitation and offer the manual instructions in `docs/installation.md`.

## 1. Inspect prerequisites and current setup

- Run `node --version` and `pi --version`. Require Node.js 22.19+ and a working pi command. If either prerequisite is missing, stop and direct the user to https://pi.dev/. Do not install or upgrade pi yourself.
- Resolve the user agent directory from `PI_CODING_AGENT_DIR`, or use `~/.pi/agent` when unset. Expand a leading `~`. Use this same directory for all commands and file operations below. This guide installs globally, not with `--local`.
- Ask whether the user runs pi in the CLI or through pi-web. For pi-web, check the [subagent startup workaround](https://github.com/hsuanguo/pi-seed/blob/main/docs/installation.md#pi-web-subagent-startup-workaround). If SDK resolution fails, explain `PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT`: it must point to the SDK bundled with the running pi-web installation and be set in the server's startup environment. Do not assume a global npm path, install a second SDK as a shortcut, overwrite an existing override, edit service configuration, or restart the server without separate approval.
- Run `pi list`. Read existing `settings.json` if present. If it is invalid JSON, stop and ask the user to resolve it; do not replace it.
- Check for existing context files: `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, and `CLAUDE.MD`. Check the two prompt destinations below. Do not read credentials, `auth.json`, `models.json`, or private provider files.
- Fetch the public templates from https://raw.githubusercontent.com/hsuanguo/pi-seed/main/: `setup/settings.json`, `setup/AGENTS.md`, `setup/prompts/improve-agents-md.md`, and `setup/prompts/show-me.md`. Use available fetch tools or download these text files with a shell command. Do not pipe downloaded content into a shell. If fetching fails, stop rather than invent template contents.

## 2. Ask about optional setup

Explain that the recommended setup requires pi-seed and all five third-party packages below. They provide web access, cache optimization, task tracking, delegation/background work, and code intelligence. Packages contain executable extensions; show their sources before asking for approval. They are essential to this setup, not requirements of pi itself.

Ask the user which optional parts they want. Use structured questions if available; otherwise ask in plain text. Do not require pi-seed's questionnaire extension to be installed first.

- **Settings:** adopt the shareable defaults (`enableSkillCommands: true` and codemode enabled), or keep existing settings. Recommend the defaults only where they do not conflict with user choices.
- **Prompts:** install both `/improve-agents-md` and `/show-me`, select one, or skip them.
- **Instructions:** if no supported context file exists, offer to copy `setup/AGENTS.md` as the initial template, or skip it. If one exists, explain that it stays untouched and offer to show suggested changes for the user to merge manually. Never overwrite or append to an existing context file.

Do not add theme, model, enabled-model, provider, or credential configuration. Do not silently enable paid services or collect API keys. Package-specific credentials and advanced configuration are separate tasks.

## 3. Show the plan and wait for approval

Show the resolved agent directory, package sources, selected file changes, existing values that will be preserved, and backup paths. Include these six essential package commands, marking already configured packages as skipped:

```bash
pi install git:github.com/hsuanguo/pi-seed
pi install npm:pi-web-access
pi install npm:pi-cache-optimizer
pi install npm:@juicesharp/rpiv-todo
pi install npm:pi-subagents
pi install npm:pi-lens
```

Detect existing packages by identity, not only exact source text: npm name, git repository ignoring its ref, or resolved local path. Preserve existing pins and resource filters. Do not install a second local or git copy of pi-seed. If identity is uncertain, ask rather than duplicating it.

Wait for explicit approval before installing packages or writing user files. Cancellation, a timeout, or silence is not approval. If the user declines an essential package, stop the recommended installation and explain that `pi install git:github.com/hsuanguo/pi-seed` alone is available as a limited, package-only alternative. Do not report that alternative as the complete setup.

## 4. Apply only approved changes

- Back up existing `settings.json` to a unique `settings.json.bak-<time>` before the first package command or settings edit. Back up any prompt before an approved replacement. Never overwrite a backup.
- Install only missing essential packages with `pi install`, preserving the user's agent directory environment. Check each exit status. If a command fails, stop and report the failure and partial state; do not remove existing packages or restore the entire settings file automatically.
- Re-read settings after package commands so you retain pi's package entries. Merge only approved defaults. Preserve existing scalar values and unrelated keys. Union arrays without removing entries. Respect an explicit `-codemode`. If `defaultTools` is an allowlist of plain names, add the plain name `codemode`, not `+codemode`; never mix allowlist names with signed entries. Ask before changing a conflicting value or malformed tool selection.
- Copy selected prompts to `<agent-dir>/prompts/improve-agents-md.md` and `<agent-dir>/prompts/show-me.md`. Skip identical content. Keep differing existing content unless its replacement was explicitly approved.
- Copy the instruction template to `<agent-dir>/AGENTS.md` only if no supported context file exists. Re-check immediately before writing. Never overwrite or append to an existing context file, even if the user asks for `--force` during this installation.
- Re-check existing files before each write. If they changed since the approved preview, stop and show a revised plan. Preserve user data and avoid unrelated changes. Do not use `sudo`, edit shell startup files, or run `install.mjs --force` as a shortcut.

You may use the existing `install.mjs` only after inspecting it and confirming that every change it would make matches the approved plan. It always applies settings; `--no-packages`, `--no-agents`, and `--no-prompts` do not disable that step. Direct, narrow file edits are preferable when the user selects only some optional parts.

## 5. Verify and report

1. Run `pi list` and confirm pi-seed and all five essential packages are configured. Report pre-existing filters that limit resources.
2. Verify settings parse as JSON and contain only approved changes. Verify selected prompt contents and any new instruction file against the fetched templates. Confirm existing context files stayed untouched.
3. Report installed, already configured, skipped, and failed items separately. List backup paths. Do not claim success if any essential package failed.
4. Ask the user to start a new pi session or run `/reload`. Explain that package registration does not prove extension loading; ask them to report startup or reload errors before claiming runtime verification. For pi-web users applying the package-root workaround, explain that the server needs a full restart with the variable set; `/reload` is not enough. Offer a small subagent launch check after restart, with user approval. Do not claim the activation fix in pi-subagents PR #2531 also fixed child launch resolution.

Rerunning this guide should skip unchanged files and already configured packages. For later updates and removal, use https://github.com/hsuanguo/pi-seed/blob/main/docs/installation.md.

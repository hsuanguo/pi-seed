# Installation and updates

Requires pi and Node.js 22.19+.

## Recommended: install with your AI assistant

1. [Install pi](https://pi.dev/) and start a session with a working model.
2. Paste this prompt:

```text
Fetch https://raw.githubusercontent.com/hsuanguo/pi-seed/main/install.md and follow it. Ask me about optional setup and wait for my approval before installing packages or changing my files.
```

The [agent installation guide](../install.md) checks the current setup, asks about settings, prompts, and initial instructions, then waits for approval. It installs pi-seed and all five essential third-party packages listed in `setup/settings.json`. Existing context files stay untouched. It verifies the result and reports partial failures and backups. You then start a new session or run `/reload` to load the resources.

These packages are essential to the recommended pi-seed setup, not requirements of pi itself. If you decline an essential package, the agent stops that setup and offers the limited package-only alternative below. The agent can fetch the guide with shell tools before any web extension is installed.

Review the plan carefully. Results can vary by model; the manual installer remains available for predictable behavior.

## Manual installation

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

## pi-web: subagent startup workaround

If pi-subagents cannot find the Pi SDK or launches a child through Next's CLI under pi-web, point it at the SDK bundled with the running pi-web installation. pi-web runs Pi sessions inside its server process, so the process entry point may identify Next rather than Pi.

[pi-web issue #952](https://github.com/agegr/pi-web/issues/952) documents this package-root problem and the environment-variable workaround. [pi-subagents PR #2531](https://github.com/nicobailon/pi-subagents/pull/2531) fixes dynamic tool activation on in-process hosts, but explicitly leaves child launch resolution unchanged. A closed activation issue does not establish that subagent startup is fixed. Use this workaround when your installed versions still have the SDK-resolution problem; check upstream guidance when upgrading.

For a global npm installation, in the same Node/npm environment used to launch pi-web:

1. Locate the bundled SDK and check that its package manifest exists:

   ```bash
   SDK_ROOT="$(npm root -g)/@agegr/pi-web/node_modules/@earendil-works/pi-coding-agent"
   node -p 'require(process.argv[1]).version' "$SDK_ROOT/package.json"
   ```

   If that fails, stop and find the actual pi-web installation path. For example, a custom npm prefix might place the SDK at `$HOME/.local/lib/node_modules/@agegr/pi-web/node_modules/@earendil-works/pi-coding-agent`. For local installs, containers, other package managers, or Windows, use the equivalent absolute path inside the environment that runs the server. Do not assume your shell's global npm directory matches the server's installation.

2. Stop the existing pi-web server. Then set the override and restart it with your usual arguments:

   ```bash
   export PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT="$SDK_ROOT"
   pi-web
   ```

   The variable must reach the pi-web server at startup. `/reload` or setting it in an agent's shell command does not change an already running server's environment. For a managed service or container, set it in that service's environment and restart the service. Keep existing launcher arguments; this workaround does not require exposing the server on `0.0.0.0`.

3. Run a small subagent task and check the server logs. If launch still fails, record the pi-web, bundled SDK, and pi-subagents versions with the error. Do not treat disappearance of the activation warning as proof that child launch works.

Use pi-web's bundled SDK, not an arbitrary global Pi installation or a second SDK installed into `~/.pi/agent/npm`. That keeps the host and child on the same SDK version. Do not replace an existing package-root override without checking why it is set.

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

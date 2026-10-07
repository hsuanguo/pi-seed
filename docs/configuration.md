# Extension configuration

## File and defaults

All extensions use the same optional configuration file: `~/.pi/agent/pi-seed-config.json` (or `$PI_CODING_AGENT_DIR/pi-seed-config.json`), with project overrides in `<cwd>/.pi/pi-seed-config.json`. Project configuration is read only when the project is trusted; valid project values override user values field by field. Missing sections use defaults.

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

## Options

| Field | Values | Default | Effect |
| --- | --- | --- | --- |
| `claudeSkills.mode` | `"ancestors"`, `"eager"` | `"ancestors"` | `ancestors` searches cwd and its ancestors up to the Git root. `eager` also searches nested directories below the Git root (or cwd outside Git). This controls skill discovery, not insertion of full skill instructions into the prompt. |
| `claudeSkills.ignoreUserSkills` | `true`, `false` | `false` | `true` skips user skills in `~/.claude/skills/`; `false` includes them. |
| `claudeSkills.ignoreProjectSkills` | `true`, `false` | `false` | `true` skips project `.claude/skills/` directories; `false` includes them when the project is trusted. |
| `scopedContext.mode` | `"lazy"`, `"eager"` | `"lazy"` | `lazy` appends relevant subdirectory instructions to tool results when a path in that scope is touched. `eager` adds all discovered subdirectory instructions to the system prompt. |
| `askUserQuestion.timeoutSeconds` | Integer `0`–`86400` | `0` | `0` waits indefinitely. A positive value is how long a questionnaire waits for a first response; any response turns the timer off. |

The ignore flags apply only to Claude skill directories, not pi's native or packaged skills.

For questionnaire controls and timeout behavior, see [Structured questions](ask-user-question.md).

## Skill discovery

Set `claudeSkills.mode` to `"eager"` to discover directories such as `<repo-root>/A/.claude/skills/`, even when starting pi in another repository subdirectory. Outside Git, the downward scan starts at cwd. Hidden directories (except the `.claude/skills` candidate at each visited directory), `node_modules`, and directory symlinks are skipped. Nested repositories containing a `.git` directory or file are also skipped entirely, including their own `.claude/skills/`. Start pi inside a nested repository to load its skills. The downward scan only runs for trusted projects with project skills enabled. User skills and existing ancestor skill directories retain priority over newly discovered directories. This registers skills at startup or `/reload`; it does not eagerly insert every skill's full instructions into the system prompt.

## Validation and migration

Invalid JSON, invalid section types, unknown sections or fields, and invalid values produce warnings; invalid values do not replace valid user values. Run `/reload` after editing. The installer does not create or migrate this optional file. To migrate existing configuration, move values from `claude-skills.json` into `claudeSkills` and from `scoped-context.json` into `scopedContext`, at the same user or project scope. The old files are no longer read.

## Selecting extensions

To load only some extensions, use the object form of the package in `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    {
      "source": "git:github.com/hsuanguo/pi-seed",
      "extensions": ["!extensions/claude-skills.ts"]
    }
  ]
}
```

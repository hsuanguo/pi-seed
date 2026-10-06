# Skills

This directory holds skills distributed with the pi-seed package.

| Skill | Use it for |
|---|---|
| [background-tasks](./background-tasks/SKILL.md) | Background execution, bounded scheduled checks, reminders, and recurring work with pi-subagents. |
| [pr-sitting](./pr-sitting/SKILL.md) | Continuous PR review, author maintenance, or read-only monitoring with scheduled checks and preserved review history. |

Add each skill in its own kebab-case directory with a `SKILL.md` file containing
`name` and `description` frontmatter, followed by the instructions. Supporting scripts,
references, and assets can live alongside it.

`package.json` declares this directory in `pi.skills`, so pi discovers skills added here
when the package is loaded. This README is documentation, not a skill.
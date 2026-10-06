---
description: Review and simplify AGENTS.md without weakening project constraints
argument-hint: "[path] [audit-only]"
---
Review the agent instructions at ${1:-AGENTS.md}.
Additional request: ${@:2}

Read the target and applicable parent instructions. Inspect nearby code,
scripts, and configuration only as needed to verify concrete claims.

Make instructions concise, actionable, and specific to this project:
- Remove duplication, vague advice, and unnecessary explanations.
- Preserve safety boundaries, project contracts, prerequisites, and required checks.
- Remove tooling-enforced rules only after confirming enforcement exists.
- Verify commands and referenced paths; flag uncertainty instead of guessing.
- State when conditional rules apply. Do not introduce model-specific XML tags.
- Replace lengthy examples with useful existing references when appropriate.
- Do not split files unless their scope or size justifies it.

Report findings first and propose a minimal patch. Do not edit until approved.
If audit-only is requested, report findings without proposing a patch.
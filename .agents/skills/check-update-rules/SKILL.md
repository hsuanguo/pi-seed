---
name: check-update-rules
description: "Check and update agent rules against version-matched source code and official documentation. Use when auditing AGENTS.md, verifying tool or extension behavior, or checking whether rules and mechanisms have fallen behind dependency updates."
argument-hint: "[rule files or mechanism to check]"
---

# Check and Update Rules

Verify that the requested rules still match the actual implementation, then update only evidence-backed claims. If no scope is supplied, check `setup/AGENTS.md`.

## 1. Establish Scope and Versions

- Read the applicable repository instructions and requested rule files. Treat the rules as claims to verify, not as evidence of how a tool works.
- On every invocation, inspect the relevant source code and official documentation again. Do not rely on previous conversations, remembered behavior, or the existing rules.
- Identify the host and extension versions actually in use, along with the repository's pinned or declared versions. Prefer installed source or the matching release/tag. Compare upstream changes when relevant, but never assume unreleased behavior is available locally. If the installed version cannot be determined, state which version was checked.

## 2. Verify Each Claim

- Follow each factual claim from the entry point to the code that controls the behavior. Verify parameter validation, defaults, configuration gates, ownership, persistence, timeouts, and error handling where relevant. Documentation alone is insufficient when source is available; report any disagreement.
- For background work, explicitly distinguish parent and child agents, interactive/RPC and headless hosts, blocking and non-blocking waits, completion delivery, session shutdown/reload, fresh context, and who owns scheduling or cleanup. Verify that state needed after compaction or restart is actually persisted and read.
- Separate verified API behavior from suggested policy, such as a one-hour threshold or a maximum check count. Do not present policy as a built-in guarantee or invent unsupported parameters.
- Use a focused existing test or an isolated executable probe to resolve uncertain behavior when practical. Never launch real training, create live schedules, access credentials, or alter user sessions just to validate a rule.

## 3. Update Conservatively

- Correct only claims supported by evidence. Keep rules concise, actionable, and consistent with the versions in scope; preserve unrelated instructions and user changes.
- Include relevant limits or prerequisites instead of promising unconditional notifications, recovery, cancellation, or durability. If a fact cannot be verified, identify it as unresolved rather than silently rewriting it as certain.
- Updating rules does not authorize upgrading dependencies, changing live configuration, or redesigning the mechanism. Report any required upgrade or implementation change separately.
- If the user requested an audit only, report findings without editing. If everything is current, do not make cosmetic edits.

## 4. Validate and Report

- Run the repository's focused checks for the changed files. If no executable check applies, validate the rule format and review the diff; state what remains untested.
- Summarize the versions checked, corrected or unchanged claims, and the verification performed. Link each material correction to the controlling source location and relevant official documentation.
- List unresolved facts or version mismatches separately. Completion requires fresh source inspection, evidence for material claims, and validation of any edits; lack of evidence must remain visible.
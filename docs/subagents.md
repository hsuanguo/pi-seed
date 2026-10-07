# Subagent examples

Setup installs [pi-subagents](https://github.com/nicobailon/pi-subagents), which lets Pi delegate focused tasks to child agents and bring their results back. These examples adapt the upstream [getting-started examples](https://github.com/nicobailon/pi-subagents#try-this-first) and [workflow patterns](https://github.com/nicobailon/pi-subagents/blob/main/docs/workflows.md). Change the task and scope to fit your project.

Ask in plain language. For version-specific help, use `/subagents-guide workflows`; setup does not pin the plugin version.

## Explore before planning

Use `scout` to gather local context before choosing an implementation:

```text
Have scout trace how settings reach the installer. Summarize the relevant files,
data flow, and open questions before we plan a change. Do not edit files yet.
```

## Challenge a decision

Use `oracle` for a second opinion:

```text
Ask oracle to challenge this design. Identify hidden assumptions, likely failure
modes, and simpler alternatives without editing files.
```

## Review from multiple angles

Give independent reviewers different concerns, then synthesize their results:

```text
Ask three reviewer subagents to inspect this diff independently: one for
correctness, one for missing tests, and one for maintainability. Combine
overlapping findings and explain which fixes matter. Keep this pass read-only.
```

## Implement, then verify

Use a worker for the approved change and fresh reviewers to check it:

```text
Have worker implement the approved plan and run the relevant checks. Then ask
fresh reviewers to inspect the result and have worker address confirmed findings.
Stop after at most three review rounds and report anything unresolved.
```

Use one writer for a shared checkout. Parallel implementation needs separate worktrees and a clean starting tree; see upstream [worktree isolation](https://github.com/nicobailon/pi-subagents/blob/main/docs/workflows.md#worktree-isolation).

## Research and check the evidence

Combine external research, local context, and an independent source check:

```text
Have researcher compare SQLite and PostgreSQL for this application's workload,
while scout checks the current persistence code. Then have evidence-auditor
verify the claims that drive the recommendation against the cited sources.
```

The research agents require `pi-web-access` tools in the child. Setup installs that package, but child extension loading must also be configured; follow the upstream [web research prerequisites](https://github.com/nicobailon/pi-subagents/blob/main/docs/agents.md#web-research-prerequisites).

## Run a bounded task in the background

```text
Delegate a read-only investigation of the test suite's slowest areas to scout
in the background. Save a report with evidence and proposed improvements.
Use a 30-minute deadline, return control to me, and notify me when it finishes
or needs my input.
```

You can continue chatting while it runs. Ask Pi to show active runs when you want progress. Keep the owning Pi process running for completion notifications; see upstream [observability](https://github.com/nicobailon/pi-subagents/blob/main/docs/observability.md).

## Schedule checks for external work

Use the bundled [background-tasks skill](../skills/background-tasks/SKILL.md) to arrange later checks instead of keeping a child waiting:

```text
Check CI run #456 every 10 minutes for up to two hours. Notify me when it
succeeds, fails, or reaches the deadline; stay quiet while nothing changes.
Do not restart the run or modify the branch.
```

Schedules need a running Pi host. See upstream [missions and schedules](https://github.com/nicobailon/pi-subagents/blob/main/docs/missions.md#schedules). [PR sitting](workflows.md#pr-sitting) is another example of this pattern; adapt it to builds, experiments, or other long-running jobs.

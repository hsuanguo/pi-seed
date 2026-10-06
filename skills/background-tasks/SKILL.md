---
name: background-tasks
description: "Manage authorized background work, delayed checks, reminders, and recurring tasks with pi-subagents. Use to choose how to handle prolonged waits or ongoing polling, including waits discovered midway through an ordinary task, or when background execution is requested. Shorter waits can also benefit when the parent should stay available. Also use for daily or weekly briefings. Not for immediate one-off status queries or routine short commands."
---

# Background Tasks

Use pi-subagents to return control while authorized work runs or to check external work later. A notification is not proof that the real task succeeded.

## 1. Confirm the Contract

- Follow the owning context's delegation policy. This skill does not independently authorize child agents, external launchers, job mutation, or destructive cleanup.
- Record the objective, required tools, job IDs, paths, status query, success/failure criteria, and reporting expectations. For scheduled checks, agree on the interval and maximum check count or deadline first. For recurring work, confirm cadence, timezone, and how to stop it.
- Check the locally installed pi-subagents version and tool guide before using these mechanisms. The upstream references track `main` and may describe newer or unreleased behavior; verify compatibility with the local version before applying them. After a package version change, fully restart pi: `/reload` cannot replace already cached extension modules.
- Keep the owning pi process alive for native notifications. A reopened session in a new process must inspect retained status; do not promise a native wake there. Schedules need a running pi host or a separately authorized external launcher calling `schedule.run-due`; they are not a daemon or a sleeping child agent.

## 2. Choose Execution and Mode

- Choose foreground `sleep` or bounded polling, background execution, or scheduled checks based on the expected remaining wait, uncertainty, the value of keeping the parent available, and setup cost. For waits over roughly 30 minutes, give background execution or scheduled checks particular consideration. Shorter waits can also benefit from background work; 30 minutes is a reminder to reassess, not a cutoff or runtime limit. Respect explicit foreground or background requests.
- Estimate the whole remaining wait from job progress, throughput, or other available evidence, not from each polling interval or the bash timeout. Reassess when a status check changes the estimate or the wait exceeds it, including midway through an ordinary task. If choosing background work, arrange bounded execution or scheduled checks and return control in an interactive parent; a larger bash timeout does not make a foreground loop background work.
- Use a background child for bounded execution that can await the real result. Prefer scheduled checks for prolonged or unknown external waits.
- Choose explicitly between reminder-only and delegated execution. If it is unclear whether the parent should act later or a child should do the work at the due time, ask before creating the schedule.
- Reminder-only: return an actionable reminder and all inputs without launching a child. The parent performs the actual work after notification. The script itself spends no child-model tokens; parent turns still consume tokens.
- Delegated: await `runs.run(...)` or `runs.all(...)` children with the required tools, then return their final results for the parent to evaluate. Omit explicit child `async: true`: with it, even an awaited call can return only a launch receipt. Dispatch is not completion.
- At the due time, the scheduler starts the workflow. It does not start a child merely to wake the parent before every task.

## 3. Prepare a Self-Contained Workflow

- Raw inline and file-backed workflows are JavaScript statement bodies executed without an LLM. Their sandbox provides `args`, `runs`, `emit`, `console`, ordinary JavaScript, and mission `state` when bound; it has no filesystem, shell, network globals, or arbitrary pi tools. Delegate external work to an authorized child or the parent. Named resources can separately grant constrained `runs.host` authority; raw scripts cannot grant it themselves.
- Ordinary workflows can create a mission automatically. Scheduled workflows do not: attach an existing `missionId` to use durable `state`, or pass all required inputs in `args`. Read these inputs explicitly rather than relying on conversation memory. Do not put secrets in persisted arguments.
- `workflow: true` reads the ```` ```js workflow ```` block only from the same assistant reply that issues the call. When retrying a failed `workflow: true` call, repeat the block in the retrying reply or switch to a script file path.
- Prefer a script file for reusable workflows and durable schedules: it is reviewable, reusable, and avoids the retry pitfall above. Store scripts under `./.pi/workflows/<name>.js`, not in the project root; relative paths resolve against the request `cwd`. Wait for the file write to complete before calling `validate` or `schedule.create`; do not issue them in the same parallel tool batch. Validate with `subagent({ action: "validate", workflow: "./.pi/workflows/check.js" })` before scheduling. Validation checks the script, not credentials, external connectivity, or actual job success.
- Schedules snapshot the script text at creation; later edits or deletion of the source script file do not affect existing schedules. Recreate the schedule to change its script, retiring the old schedule to avoid duplicate runs.
- Return actionable data explicitly. Do not fire and forget child launches or treat a detached process ID as a finished result.

Reminder-only script:

```js
return { mode: "reminder-only", reminder: args.reminder, check: args.check };
```

Delegated script:

```js
const result = await runs.run("check", { agent: args.agent, task: args.task });
return { mode: "delegated", ok: result.ok, output: result.output, runId: result.runId };
```

## 4. Schedule Checks or Recurring Work

### Scheduled Checks

1. Create exactly one one-shot `schedule.create` with `at: "+<interval>"` and the chosen workflow. Use `sessionOnly: true` for same-project checks when the current session is persisted. Keep `quiet: false` when successful completion must trigger parent processing.
2. Supply the job ID, paths, query, success/failure criteria, check number, and limit through `args` or the attached mission's state.
3. On notification, perform the real check in reminder-only mode or evaluate the delegated result. Report success, failure, or a reached limit. A reminder alone is not a completed check.
4. If still pending and within the limit, create exactly one next check with the updated count. Never restart or modify the external job without authorization.
5. Fired one-shot schedules retain their records. After terminal settlement, preserve any needed history and explicitly delete obsolete schedules as cleanup; deletion is not necessary to stop a one-shot from firing again.

### Recurring Tasks

1. Create one recurring schedule, not a new schedule after every run. Choose reminder-only or delegated execution explicitly.
2. For local calendar time, use `every: "day"` or `"week"`, `at: "HH:mm"`, and an explicit IANA `timezone`. Weekly schedules also require `on` with the weekday selection. Verify the displayed next occurrence against the intended timezone and day.
3. For elapsed-time recurrence, use a fixed `every` interval without `at`, `on`, or `timezone`.
4. Each scheduled fire starts with fresh context. Carry all inputs explicitly; the parent performs the reminded task or evaluates and reports the delegated result. Neither mode requires recreating the recurring schedule.
5. Keep `quiet: false` for recurring reminders or whenever successful completion should trigger a parent turn. Pause or delete the schedule when the user wants recurrence stopped.

## 5. Handle Notifications and Results

- Child success does not mean the enclosing workflow completed. Use workflow terminal status for the overall result, but promptly handle child failures, pauses, and requests for decisions instead of ignoring them until workflow completion.
- Completion notices can contain truncated return-value previews. Inspect the referenced run status and `status.json` for the full `workflow.value`, errors, and retained evidence when needed.
- `quiet: true` suppresses a new parent turn for successful recurring completion, not necessarily message delivery or display. The parent can read the notice on a later turn; failures and other non-success outcomes can still wake it. Use `schedule.history` to inspect scheduled execution history.
- In an interactive parent, return control and use native async completion notifications; do not call `bg_wait` merely to wait for an ordinary async subagent. Headless runs auto-drain at `agent_end`, subject to their own deadline. A `bg_wait` window elapsing does not terminate the underlying run.

## 6. Bound Long-Running Execution

- Launch the background child with `async: true` and an explicit `timeoutMs` covering expected duration plus margin. Ensure applicable tool and model-request timeouts allow legitimate waits.
- Plain single-agent async runs have a built-in 30-minute fallback, overridden by call, agent, or configured defaults. Composite async workflows have no default top-level deadline; set one explicitly when the contract requires a bound.
- The child must block or poll until the real task finishes and inspect its result, not merely launch a detached process. Define timeout behavior and which local or remote processes it owns before starting.
- Run-level timeout is terminal and attempts to stop managed work. Process-tree cleanup can fail or remain unknown; detached/unowned processes and remote jobs are not guaranteed to stop. Inspect cleanup evidence and report unresolved work; do not claim successful cleanup without proof or perform unauthorized destructive cleanup.
- Optional `checkpointBeforeDeadlineMs` is a best-effort checkpoint/stop request delivered at a tool boundary, not a guaranteed interruption.

## Completion Check

Report the chosen mode, run or schedule ID, next occurrence or deadline, required host/session lifetime, and stop condition. For finished work, verify the real result and any required cleanup. For scheduled checks, confirm there is at most one pending next check. For recurrence, confirm that the single schedule remains active or was intentionally paused/deleted. Surface failures and uncertainty rather than treating dispatch or a reminder as success.

## References

- [Workflow semantics and sandbox](https://github.com/nicobailon/pi-subagents/blob/main/docs/workflows.md)
- [Schedules and mission state](https://github.com/nicobailon/pi-subagents/blob/main/docs/missions.md#schedules)
- [Timeouts and notification configuration](https://github.com/nicobailon/pi-subagents/blob/main/docs/configuration.md)

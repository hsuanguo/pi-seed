# Evaluation with pi-subagents

Evaluations require Pi with pi-subagents. The bundled helpers require Node.js 22.19+ and Pi's installed `@earendil-works/pi-coding-agent` SDK.

## Cases and artifacts

Use this small case format; fixture paths resolve relative to the evals file:

```json
{
  "skill_name": "release-notes",
  "evals": [
    {
      "id": 1,
      "prompt": "Write release notes from changes.json, grouped by impact.",
      "fixtures": "fixtures/release-notes",
      "expected_output": "Accurate user-facing notes with no internal-only changes.",
      "assertions": [
        "Every public change is represented.",
        "Internal-only changes are omitted."
      ]
    }
  ]
}
```

Prepare each case and repetition separately. For example, pass `iteration-1/eval-1/pair-1` as the new pair directory. The helper creates:

```text
pair-1/
  plan.json
  skill-snapshot/<declared-name>/SKILL.md
  with_skill/workspace/       # Independent copies of the same input fixtures
  with_skill/outputs/
  without_skill/workspace/
  without_skill/outputs/
```

The snapshot includes supporting files but omits root `evals`, `.git`, `node_modules`, and Python caches. Prepare runtime dependencies separately and identically if needed. Symlinks are rejected: provide self-contained fixtures and skill files. The helper refuses an existing pair directory, overlapping inputs, malformed skills, and skills hidden with `disable-model-invocation: true` (pi-subagents filters those from the advertised list). It does not modify the source skill.

## Create a private profile

If needed, call `subagents_enable({})`, then read `subagent({ action: "guide", topic: "agents" })` and the installed tool reference. Do not invent flags from the latest upstream docs. The generated `plan.profile` is a management config:

```js
// Copy the actual profile object from plan.json.
subagent({ action: "create", config: plan.profile });
```

`scope: "project"` creates a temporary profile in the parent project's agent directory. The profile has a unique name; never overwrite a pre-existing profile. Check the create result and inspect `action: "get"` before dispatch. It uses an append system prompt, explicit builtin tools, no context-file or skill inheritance, no memory, no ambient extensions, and an absolute private `skillPath` pointing to the frozen snapshot.

The plugin's private resolver identifies `SKILL.md` by its directory name. The helper names the snapshot directory after the declared skill name, even when the original folder differs. `skillPath` discovers candidates; runtime `skill` selects names. Unresolved skills normally produce a warning rather than failing the run, so treat that warning as an invalid trial. Do not fall back to a same-named skill from another location.

## Dispatch conditions

Call `action: "models"` and choose one exact `provider/id` and supported thinking suffix, such as `provider/id:high`, for both conditions. Keep required provider configuration; disabling child extensions can remove custom providers in background execution. The foreground recipe below can inherit providers registered by the parent without loading ambient extensions.

For **discovery**, compose one task for both conditions:

```text
<case prompt, using relative paths inside workspace>

Save deliverables under ../outputs/. Return a concise account of what you produced and any blockers.
```

For **effectiveness**, prepend only the experimental task with:

```text
First read and follow the configured skill at <plan.skillFile> for this task.
```

That intentional prompt difference forces use; it does not measure natural triggering. Both groups still have identical output instructions. Executors receive neither assertions nor grading files; graders read those after execution.

Copy the generated request defaults, add the task, model, and a suitable explicit deadline, and dispatch:

```js
subagent({
  ...plan.conditions.with_skill,
  task: experimentalTask,
  model: selectedModel,
  timeoutMs: deadlineMs,
});
subagent({
  ...plan.conditions.without_skill,
  task: baselineTask,
  model: selectedModel,
  timeoutMs: deadlineMs,
});
```

The plan sets `context: "fresh"`, `async: false`, `share: false`, and separate cwd/session directories. Experimental `skill` is the declared name; baseline `skill` is `false`. Foreground calls block until completion. Sequential dispatch is sufficient; alternate order across repetitions. If using a workflow, await every child and explicitly preserve fresh context and the same launch settings. Background dispatch needs compatible providers and terminal status inspection before grading.

`fresh` only isolates conversation history. Separate cwd directories prevent ordinary file contamination, but the plugin is not a filesystem sandbox: `read` and `bash` can still access other paths. Use fixtures without links to the source repository, sibling outputs, or parent instructions. Check transcripts for unintended access; label contaminated runs invalid. For skills requiring project rules or other integrations, configure those identically for both groups and report the broader evaluation scope.

## Preserve and grade results

For each condition, write `result.json` **after inspecting terminal status**:

```json
{
  "status": "completed",
  "runId": "actual-plugin-run-id",
  "model": "provider/id:high",
  "mode": "effectiveness",
  "total_tokens": null,
  "duration_seconds": null
}
```

`completed` means the trial executed and can be judged; a task may still fail its assertions. Use `invalid` for model/provider failures, missing skills, timeout, incomplete results, or contamination, and include the reason. Use actual plugin telemetry for tokens and executor duration; record `null` when unavailable. Save the transcript or its retained path, launch request, and final response. For text-only outputs the parent can save the final response as `outputs/answer.md` after the child finishes.

Write `eval_metadata.json` in the pair directory with `eval_id`, `prompt`, `assertions`, and review criteria. Grade each condition independently and save beside `result.json`:

```json
{
  "expectations": [
    {
      "text": "Every public change is represented.",
      "passed": true,
      "evidence": "notes.md covers changes 1, 3, and 4."
    },
    {
      "text": "Internal-only changes are omitted.",
      "passed": false,
      "evidence": "notes.md includes the internal migration."
    }
  ]
}
```

The summarizer requires both conditions to be completed, the same model and mode, and matching nonempty assertion lists. It computes pass rates from verdicts, not self-reported totals. Incomplete or invalid pairs are listed as excluded; no missing verdict is silently scored as a failure or success. Unknown metrics stay `null`. Subjective cases without assertions need human comparison; they are excluded from numerical pass-rate summaries.

Keep old/new-version comparisons and description-trigger counts in separately labeled reports. The bundled summarizer deliberately handles only the two `with_skill` / `without_skill` conditions. After evaluation, delete the exact temporary profile with `action: "delete"`, its generated name, and `agentScope: "project"`; do not remove snapshots or results until their review is complete.

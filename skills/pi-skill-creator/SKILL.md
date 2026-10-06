---
name: pi-skill-creator
description: "Create, evaluate, and improve reusable pi skills. Use for writing SKILL.md, comparing a skill against a baseline or an older version, and testing description triggering. Run paired evaluations in fresh pi-subagents sessions with private skill selection."
license: Apache-2.0
---

# Pi Skill Creator

Adapted from [S1M0N38/pi-skill-creator](https://github.com/S1M0N38/pi-skill-creator/tree/a28b3b4a2f24218231725cb013e2aa68309361d8). Modified for pi-seed: replace inline evaluations with fresh pi-subagents sessions and use small Node.js helpers for fixture preparation and reporting. See [source notes](references/sources.md) for the versions and interfaces checked.

Evaluations require Pi with pi-subagents. The bundled helpers require Node.js 22.19+ and Pi's installed `@earendil-works/pi-coding-agent` SDK.

## Create or revise

1. Establish the intended task, when the skill should trigger, and what a successful result looks like. Use the conversation and existing examples; ask only for missing decisions. Respect a location already chosen by the user. In this package, shared skills belong in `skills/<name>/`; ordinary project skills can use `.pi/skills/<name>/`.
2. Write `SKILL.md` with `name` and a specific `description`. Prefer a matching kebab-case directory name for portability. Pi advertises metadata first; the agent reads the body on demand. Keep the body focused on decisions the skill changes. Add scripts or references only for recurring needs.
3. Start with a few realistic tasks, including edge cases. Save prompts, expected outcomes, input fixtures, and verifiable assertions in `evals/evals.json`. See [evaluation instructions](references/evaluation.md) for the format. For subjective outputs, include human review criteria instead of inventing numerical assertions.
4. Validate discovery and the behavior of any helper scripts. Skill discovery diagnostics check format, not whether the skill improves results.

## Evaluate in independent sessions

Read [evaluation instructions](references/evaluation.md) before dispatching. Use the locally installed pi-subagents guide and verify compatibility with its version; setup installs the plugin without pinning its version.

- Follow the owning context's delegation policy. A request to run subagent evaluations authorizes the children needed for those evaluations; loading this skill alone does not authorize delegation or external mutations.
- Keep the parent as coordinator. Each task, condition, and repetition gets a new child with explicit `context: "fresh"`. Do not fork, resume, steer, or reuse an executor for the opposing condition.
- Use the same model, thinking level, tools, prompt policy, task, and initial fixtures. Set `inheritSkills`, `inheritProjectContext`, and `inheritGlobalContext` to `false` on a dedicated evaluation profile. Disable ambient extensions and agent memory. Run in separate fixture directories.
- Select the tested skill by name with runtime `skill`, resolved through that profile's private `skillPath`. Set `skill: false` for the baseline. A path is not a runtime skill name, and merely making a skill available does not force the child to read it.
- Distinguish **effectiveness** (explicitly ask the experimental child to read and use its skill) from **discovery** (give both children the same natural task and observe whether the experimental child reads the skill). Report which mode was used.
- Preserve launch configuration, run IDs, terminal status, transcripts, output files, actual usage, and duration. A launch receipt or self-reported success is not a completed evaluation. Missing skills and execution errors invalidate the trial; they are not evidence of skill quality.

Use the bundled preparation helper for a frozen skill snapshot and identical independent fixtures. It writes a plan for pi-subagents; it does not launch models or change live agent configuration:

```sh
node <this-skill-dir>/scripts/prepare-eval.mjs <tested-skill-dir> <fixtures-dir> <new-pair-dir>
```

An empty fixtures directory is valid for text-only tasks. Keep evaluation artifacts outside the tested skill and fixtures. Read the generated `plan.json`, create its unique temporary profile through pi-subagents, and dispatch its conditions as described in the evaluation reference.

## Grade and improve

1. Judge each run against the same assertions, using actual outputs and transcript evidence. Check deterministic outcomes with scripts where possible. For model judging, give a fresh grader the task, assertions, anonymized outputs, and needed evidence, without the tested skill or the author's preferred conclusion. Read [grading guidance](references/grading.md).
2. Save `grading.json` for each run. Record unmeasured usage and time as `null`, not zero or an estimate from output characters. Keep infrastructure failures separate from completed task failures.
3. Aggregate completed, matched pairs:

   ```sh
   node <this-skill-dir>/scripts/summarize-evals.mjs <iteration-dir>
   ```

   This writes `benchmark.json` and `benchmark.md`, comparing `with_skill - without_skill`. Review the outputs and evidence with the user, not just the score. A single pair is exploratory; repeat uncertain cases before drawing conclusions.
4. Generalize improvements from failures. Remove instructions that consume effort without changing outcomes. Freeze a new snapshot and rerun in new directories. Compare old and new versions using separate private profiles and fresh children; never edit a snapshot during a run.
5. For description optimization, use positive queries, near-miss negatives, and a held-out set in **discovery** mode. Do not mention the skill in the task or force a read. Count successful reads of the exact snapshot `SKILL.md` from tool evidence; listing it in the prompt is not a trigger. Keep infrastructure errors out of trigger accuracy.

Stop when the user's acceptance criteria are met or the agreed evaluation limit is reached. Report remaining uncertainty and retain the evidence. Remove only the temporary profiles created for this evaluation after their children finish; keep result directories for review. A finished skill in this package is already distributed through `pi.skills`; update the skills table and README when adding user-facing behavior.

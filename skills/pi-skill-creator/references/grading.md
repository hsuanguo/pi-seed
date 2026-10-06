# Grade a skill evaluation

Adapted from S1M0N38/pi-skill-creator's grader, comparator, and analyzer instructions. Modified for pi-seed: use one concise evidence-based procedure and keep executor telemetry separate from grading.

Give a fresh grader the original task, frozen assertions, output files, and execution evidence. Do not give it the tested skill, condition label, author notes about the desired winner, or another run's verdicts. Use neutral labels for blind comparisons. Executors and graders must be different sessions.

1. Inspect the actual files. A claimed output, correct filename, or successful exit is insufficient if the content is wrong or empty.
2. Evaluate every assertion using the same interpretation for both conditions. Return `text`, a boolean `passed`, and specific `evidence`. An unverified assertion cannot pass; explain missing evidence. Infrastructure failures invalidate a trial before grading.
3. Prefer executable checks for deterministic content and behavior. For subjective quality, apply the agreed rubric and preserve the human judgment rather than forcing a pass rate.
4. Flag weak assertions when they would also accept an incorrect result or omit a material success criterion. Freeze revised assertions and regrade both conditions; do not quietly favor the improved skill.
5. Compare matched runs. Inspect why a result improved or regressed and whether the skill caused needless tool calls, assumptions, or output omissions. Token usage and duration must come from executor telemetry, never the grader's estimates or output-character counts.
6. Recommend the smallest generalizable change supported by evidence. Distinguish reproducible failures from stochastic variation. A description-only change belongs in discovery testing; an instruction change belongs in effectiveness testing.

Return grading JSON to the parent, which writes `grading.json` outside executor outputs. Keep explanations grounded in file paths, checked values, and relevant transcript/tool events.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { formatSkillsForPrompt, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { createSandbox, createTestSession, REPO_DIR, skillMd } from "./helpers.ts";

const SKILL_DIR = join(REPO_DIR, "skills", "pi-skill-creator");
const prepareScript = join(SKILL_DIR, "scripts", "prepare-eval.mjs");
const summaryScript = join(SKILL_DIR, "scripts", "summarize-evals.mjs");

function prepareFixture() {
	const sandbox = createSandbox();
	const skillDir = dirname(sandbox.write("authored-folder/SKILL.md", `${skillMd("example-skill")}Snapshot-only instruction.\n`));
	sandbox.write("authored-folder/scripts/helper.mjs", "export const version = 1;\n");
	sandbox.write("authored-folder/evals/cases.json", "{}\n");
	const fixtures = dirname(sandbox.write("fixtures/input.json", "{\"value\":1}\n"));
	const pairDir = join(sandbox.root, "iteration-1", "eval-1", "pair-1");
	execFileSync(process.execPath, [prepareScript, skillDir, fixtures, pairDir]);
	const plan = JSON.parse(readFileSync(join(pairDir, "plan.json"), "utf8"));
	return { sandbox, skillDir, fixtures, pairDir, plan };
}

test("evaluation preparation freezes helpers and makes independent identical fixtures without overwriting", () => {
	const { sandbox, skillDir, fixtures, pairDir, plan } = prepareFixture();
	assert.equal(basename(dirname(plan.skillFile)), "example-skill");
	assert.equal(readFileSync(plan.skillFile, "utf8"), readFileSync(join(skillDir, "SKILL.md"), "utf8"));
	assert.ok(existsSync(join(dirname(plan.skillFile), "scripts", "helper.mjs")));
	assert.ok(!existsSync(join(dirname(plan.skillFile), "evals")));
	const a = join(plan.conditions.with_skill.cwd, "input.json");
	const b = join(plan.conditions.without_skill.cwd, "input.json");
	assert.equal(readFileSync(a, "utf8"), readFileSync(b, "utf8"));
	sandbox.write(a, "changed\n");
	sandbox.write(join(skillDir, "SKILL.md"), skillMd("example-skill", "revised description"));
	assert.equal(readFileSync(b, "utf8"), "{\"value\":1}\n");
	assert.match(readFileSync(plan.skillFile, "utf8"), /Snapshot-only instruction/);
	const retry = spawnSync(process.execPath, [prepareScript, skillDir, fixtures, pairDir], { encoding: "utf8" });
	assert.equal(retry.status, 1);
	assert.match(retry.stderr, /already exists/);
	assert.equal(readFileSync(a, "utf8"), "changed\n");
});

test("preparation rejects hidden skills, overlapping output, and linked fixtures without modifying sources", () => {
	const { sandbox, skillDir, fixtures } = prepareFixture();
	const hiddenSkill = sandbox.write("hidden/SKILL.md", skillMd("hidden").replace("\n---\n\n", "\ndisable-model-invocation: true\n---\n\n"));
	for (const [skill, inputs, destination, expected] of [
		[dirname(hiddenSkill), fixtures, join(sandbox.root, "hidden-pair"), /disable-model-invocation/],
		[skillDir, fixtures, join(skillDir, "pair-2"), /overlap/],
	] as const) {
		const result = spawnSync(process.execPath, [prepareScript, skill, inputs, destination], { encoding: "utf8" });
		assert.equal(result.status, 1);
		assert.match(result.stderr, expected);
		assert.ok(!existsSync(destination));
	}
	symlinkSync(join(fixtures, "input.json"), join(fixtures, "linked.json"));
	const destination = join(sandbox.root, "linked-pair");
	const result = spawnSync(process.execPath, [prepareScript, skillDir, fixtures, destination], { encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Symlink/);
	assert.ok(!existsSync(destination));
	assert.ok(existsSync(join(fixtures, "input.json")));
});

test("pi discovers this packaged skill and loads its private snapshot in a fresh session with no baseline leakage", async () => {
	const { sandbox, skillDir, plan } = prepareFixture();
	const packageSkills = loadSkillsFromDir({ dir: join(REPO_DIR, "skills"), source: "path" });
	assert.ok(packageSkills.skills.some((skill) => skill.name === "pi-skill-creator"));
	assert.deepEqual(packageSkills.diagnostics, []);
	sandbox.write("agent/skills/ambient/SKILL.md", skillMd("ambient"));
	sandbox.write("workspace/AGENTS.md", "PARENT_CONTEXT_SECRET_SENTINEL\n");
	const parent = await createTestSession(sandbox, { trusted: true, resources: { additionalSkillPaths: [skillDir] } });
	await parent.turnWithTools([{ name: "read", args: { path: join(skillDir, "SKILL.md") } }], "PARENT_CONVERSATION_SECRET_SENTINEL");
	const privateSkills = loadSkillsFromDir({ dir: dirname(plan.skillFile), source: "path" });
	assert.deepEqual(privateSkills.skills.map((skill) => skill.name), ["example-skill"]);
	const withSkill = await createTestSession(sandbox, {
		cwd: plan.conditions.with_skill.cwd,
		resources: {
			noSkills: true,
			additionalSkillPaths: [dirname(plan.skillFile)],
			noContextFiles: true,
		},
	});
	assert.match(withSkill.session.systemPrompt, /example-skill/);
	assert.doesNotMatch(withSkill.session.systemPrompt, /ambient|PARENT_CONTEXT_SECRET_SENTINEL/);
	await withSkill.turnWithTools([{ name: "read", args: { path: plan.skillFile } }]);
	assert.match(withSkill.toolResults("read").join("\n"), /Snapshot-only instruction/);
	// Match pi-subagents' inspected child-loader policy: selected metadata is injected
	// separately and skillsOverride clears even skills contributed by extensions.
	for (const selected of [true, false]) {
		const child = await createTestSession(sandbox, {
			cwd: plan.conditions[selected ? "with_skill" : "without_skill"].cwd,
			resources: {
				noSkills: true,
				additionalSkillPaths: [skillDir],
				skillsOverride: (base) => ({ ...base, skills: [] }),
				noContextFiles: true,
				appendSystemPrompt: selected ? [formatSkillsForPrompt(privateSkills.skills)] : [],
			},
		});
		assert.equal(child.session.messages.length, 0);
		assert.doesNotMatch(child.session.systemPrompt, /ambient|PARENT_CONTEXT_SECRET_SENTINEL|PARENT_CONVERSATION_SECRET_SENTINEL/);
		if (selected) assert.match(child.session.systemPrompt, /example-skill/);
		else assert.doesNotMatch(child.session.systemPrompt, /example-skill|Snapshot-only instruction/);
	}
});

test("benchmark uses matched verdicts, signed paired deltas, and measured telemetry only", () => {
	const sandbox = createSandbox();
	const iteration = join(sandbox.root, "iteration-1");
	function pair(name: string, options: { invalid?: boolean; mismatched?: boolean; zeroTokens?: boolean } = {}) {
		const pairDir = join(iteration, "eval-1", name);
		sandbox.write(join(pairDir, "eval_metadata.json"), JSON.stringify({ eval_id: 1, assertions: ["correct", "complete"] }));
		for (const condition of ["with_skill", "without_skill"]) {
			const withSkill = condition === "with_skill";
			sandbox.write(join(pairDir, condition, "result.json"), JSON.stringify({
				status: options.invalid && withSkill ? "invalid" : "completed",
				runId: `${name}-${condition}`,
				model: "faux/model",
				mode: "effectiveness",
				total_tokens: options.zeroTokens ? 0 : null,
				duration_seconds: withSkill ? 10 : 6,
			}));
			sandbox.write(join(pairDir, condition, "grading.json"), JSON.stringify({
				summary: { pass_rate: 999 },
				execution_metrics: { output_chars: 5000 },
				expectations: [
					{ text: "correct", passed: true, evidence: "checked content" },
					{ text: options.mismatched && withSkill ? "different assertion" : "complete", passed: withSkill, evidence: "checked all required entries" },
				],
			}));
		}
	}
	pair("pair-1");
	pair("pair-2", { zeroTokens: true });
	pair("pair-3", { invalid: true });
	pair("pair-4", { mismatched: true });
	execFileSync(process.execPath, [summaryScript, iteration]);
	const benchmark = JSON.parse(readFileSync(join(iteration, "benchmark.json"), "utf8"));
	assert.equal(benchmark.pairs.length, 2);
	assert.equal(benchmark.excluded.length, 2);
	assert.equal(benchmark.summary.with_skill.pass_rate.mean, 1);
	assert.equal(benchmark.summary.without_skill.pass_rate.mean, 0.5);
	assert.equal(benchmark.delta.pass_rate.mean, 0.5);
	assert.equal(benchmark.delta.time_seconds.mean, 4);
	assert.equal(benchmark.pairs[0].with_skill.tokens, null);
	assert.equal(benchmark.summary.with_skill.tokens.n, 1);
	assert.equal(benchmark.delta.tokens.mean, 0);
	assert.match(readFileSync(join(iteration, "benchmark.md"), "utf8"), /with_skill - without_skill/);
});

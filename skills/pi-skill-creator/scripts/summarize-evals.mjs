/** Summarize matched completed trials; missing telemetry stays unknown. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CONDITIONS = ["with_skill", "without_skill"];

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function metric(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function stats(values) {
	const measured = values.filter((value) => value !== null);
	if (!measured.length) return { n: 0, mean: null, stddev: null };
	const mean = measured.reduce((sum, value) => sum + value, 0) / measured.length;
	const variance = measured.length > 1
		? measured.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (measured.length - 1)
		: 0;
	return { n: measured.length, mean, stddev: Math.sqrt(variance) };
}

function findPairs(directory) {
	const pairs = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
		const path = join(directory, entry.name);
		// Only explicit case/repetition directories are searched, never outputs or snapshots.
		if (/^pair-/.test(entry.name)) pairs.push(path);
		else if (/^eval-/.test(entry.name)) pairs.push(...findPairs(path));
	}
	return pairs.sort();
}

export function summarizePairs(iterationDirectory) {
	const directory = resolve(iterationDirectory);
	const pairs = [];
	const excluded = [];
	for (const path of findPairs(directory)) {
		try {
			const metadata = readJson(join(path, "eval_metadata.json"));
			if (!Array.isArray(metadata.assertions) || !metadata.assertions.length ||
				!metadata.assertions.every((item) => typeof item === "string" && item.trim()) ||
				new Set(metadata.assertions).size !== metadata.assertions.length) {
				throw new Error("A nonempty list of unique assertions is required for numerical grading.");
			}
			const runs = {};
			for (const condition of CONDITIONS) {
				const runDir = join(path, condition);
				const result = readJson(join(runDir, "result.json"));
				if (result.status !== "completed" || !result.runId || !result.model ||
					!["effectiveness", "discovery"].includes(result.mode)) throw new Error(`${condition}: trial incomplete or invalid.`);
				const grading = readJson(join(runDir, "grading.json"));
				const expectations = grading.expectations;
				if (!Array.isArray(expectations) || expectations.length !== metadata.assertions.length ||
					!metadata.assertions.every((text, index) => expectations[index]?.text === text) ||
					!expectations.every((item) => typeof item.passed === "boolean" && typeof item.evidence === "string" && item.evidence.trim())) {
					throw new Error(`${condition}: verdicts must match every frozen assertion and include evidence.`);
				}
				runs[condition] = {
					runId: result.runId,
					model: result.model,
					mode: result.mode,
					pass_rate: expectations.filter((item) => item.passed).length / expectations.length,
					tokens: metric(result.total_tokens),
					time_seconds: metric(result.duration_seconds),
					expectations,
				};
			}
			if (runs.with_skill.model !== runs.without_skill.model || runs.with_skill.mode !== runs.without_skill.mode) {
				throw new Error("Conditions must use the same model and evaluation mode.");
			}
			if (runs.with_skill.runId === runs.without_skill.runId) throw new Error("Conditions must use independent runs.");
			if (pairs.length && (pairs[0].with_skill.model !== runs.with_skill.model || pairs[0].with_skill.mode !== runs.with_skill.mode)) {
				throw new Error("Use separate reports for different models or evaluation modes.");
			}
			pairs.push({ path, eval_id: metadata.eval_id, ...runs });
		} catch (error) {
			excluded.push({ path, reason: error.message });
		}
	}
	const summary = {};
	for (const condition of CONDITIONS) {
		summary[condition] = Object.fromEntries(["pass_rate", "tokens", "time_seconds"].map((key) => [key, stats(pairs.map((pair) => pair[condition][key]))]));
	}
	// Costs/duration compare only pairs where both conditions have measurements.
	const delta = Object.fromEntries(["pass_rate", "tokens", "time_seconds"].map((key) => [key, stats(pairs.map((pair) => {
		const a = pair.with_skill[key];
		const b = pair.without_skill[key];
		return a === null || b === null ? null : a - b;
	}))]));
	return { pairs, excluded, summary, delta };
}

export function formatBenchmark(benchmark) {
	const format = ({ n, mean, stddev }) => n ? `${mean.toFixed(3)} ± ${stddev.toFixed(3)} (n=${n})` : "unmeasured";
	const lines = [
		"# Skill benchmark",
		"",
		`Completed pairs: ${benchmark.pairs.length}. Excluded pairs: ${benchmark.excluded.length}.`,
		"",
		"Delta is with_skill - without_skill. Pass rate is a fraction; variation is sample standard deviation.",
		"",
		"| Metric | With skill | Without skill | Paired delta |",
		"|---|---|---|---|",
	];
	for (const key of ["pass_rate", "tokens", "time_seconds"]) {
		lines.push(`| ${key} | ${format(benchmark.summary.with_skill[key])} | ${format(benchmark.summary.without_skill[key])} | ${format(benchmark.delta[key])} |`);
	}
	if (benchmark.excluded.length) {
		lines.push("", "Excluded pairs:", "");
		for (const item of benchmark.excluded) lines.push(`- ${item.path}: ${item.reason.replaceAll("\n", " ")}`);
	}
	return `${lines.join("\n")}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		if (process.argv.length !== 3) throw new Error("Usage: node summarize-evals.mjs <iteration-dir>");
		const directory = resolve(process.argv[2]);
		const benchmark = summarizePairs(directory);
		writeFileSync(join(directory, "benchmark.json"), `${JSON.stringify(benchmark, null, 2)}\n`);
		writeFileSync(join(directory, "benchmark.md"), formatBenchmark(benchmark));
		console.log(`Summarized ${benchmark.pairs.length} pairs; excluded ${benchmark.excluded.length}.`);
		if (!benchmark.pairs.length) process.exitCode = 1;
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

/** Prepare a paired pi-subagents evaluation without launching models or installing agents. */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSkillsFromDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "__pycache__"]);

function isWithin(candidate, parent) {
	const path = relative(parent, candidate);
	return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function canonicalPath(path) {
	if (existsSync(path)) return realpathSync(path);
	const parent = dirname(path);
	return join(canonicalPath(parent), basename(path));
}

function copyTree(source, destination, skip) {
	cpSync(source, destination, {
		recursive: true,
		filter(path) {
			if (skip(path)) return false;
			if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink is not a self-contained input: ${path}`);
			return true;
		},
	});
}

export function preparePair(skillDirectory, fixturesDirectory, pairDirectory) {
	const skillDir = realpathSync(resolve(skillDirectory));
	const fixturesDir = realpathSync(resolve(fixturesDirectory));
	const pairDir = canonicalPath(resolve(pairDirectory));
	if (!lstatSync(skillDir).isDirectory() || !lstatSync(fixturesDir).isDirectory()) {
		throw new Error("The skill and fixtures must be directories.");
	}
	for (const input of [skillDir, fixturesDir]) {
		if (isWithin(pairDir, input) || isWithin(input, pairDir)) throw new Error("Pair directory must not overlap the skill or fixtures.");
	}
	if (existsSync(pairDir)) throw new Error(`Pair directory already exists: ${pairDir}`);
	const { skills, diagnostics } = loadSkillsFromDir({ dir: skillDir, source: "path" });
	if (skills.length !== 1 || diagnostics.length) {
		throw new Error(`Expected one valid skill: ${diagnostics.map((item) => item.message).join("; ")}`);
	}
	const skill = skills[0];
	const { frontmatter } = parseFrontmatter(readFileSync(skill.filePath, "utf8"));
	if (frontmatter.name !== skill.name || !frontmatter.name) throw new Error("Declare a name in SKILL.md frontmatter.");
	if (skill.disableModelInvocation) throw new Error("pi-subagents does not advertise disable-model-invocation skills.");
	if (skill.name === "pi-subagents") throw new Error("pi-subagents is parent-only and cannot be selected by a child.");
	// A root SKILL.md, not a container containing unrelated skills, is required.
	if (realpathSync(dirname(skill.filePath)) !== skillDir) throw new Error("Pass the directory containing SKILL.md directly.");
	mkdirSync(dirname(pairDir), { recursive: true });
	mkdirSync(pairDir);
	try {
		const snapshot = join(pairDir, "skill-snapshot", skill.name);
		copyTree(skillDir, snapshot, (path) => {
			if (path === skillDir) return false;
			const local = relative(skillDir, path);
			return SKIPPED_DIRECTORIES.has(basename(path)) || local === "evals";
		});
		const profileName = `skill-eval-${randomUUID().slice(0, 8)}`;
		const conditions = {};
		for (const condition of ["with_skill", "without_skill"]) {
			const runDir = join(pairDir, condition);
			const workspace = join(runDir, "workspace");
			copyTree(fixturesDir, workspace, () => false);
			mkdirSync(join(runDir, "outputs"));
			conditions[condition] = {
				agent: profileName,
				context: "fresh",
				async: false,
				cwd: workspace,
				sessionDir: join(runDir, "sessions"),
				skill: condition === "with_skill" ? skill.name : false,
				share: false,
				artifacts: true,
				acceptance: { level: "none", reason: "Paired evaluation; results are graded separately." },
			};
		}
		const plan = {
			skillName: skill.name,
			skillFile: join(snapshot, "SKILL.md"),
			profile: {
				name: profileName,
				scope: "project",
				description: "Temporary executor for a paired skill evaluation.",
				systemPrompt: "Complete the assigned task using the provided tools. Report deliverables and blockers accurately.",
				systemPromptMode: "append",
				defaultContext: "fresh",
				inheritProjectContext: false,
				inheritGlobalContext: false,
				inheritSkills: false,
				skills: "",
				skillPath: [snapshot],
				tools: "read, bash, edit, write",
				extensions: "",
			},
			conditions,
		};
		writeFileSync(join(pairDir, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
		return plan;
	} catch (error) {
		rmSync(pairDir, { recursive: true, force: true });
		throw error;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		if (process.argv.length !== 5) throw new Error("Usage: node prepare-eval.mjs <skill-dir> <fixtures-dir> <new-pair-dir>");
		const plan = preparePair(...process.argv.slice(2));
		console.log(`Prepared ${plan.skillName}: ${join(dirname(dirname(plan.skillFile)), "..", "plan.json")}`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}

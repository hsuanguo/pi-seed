#!/usr/bin/env node
/**
 * Applies this pi setup to the current user's agent directory (~/.pi/agent, or $PI_CODING_AGENT_DIR).
 *
 *   1. settings  - merges setup/settings.json into settings.json. Arrays are unioned; other values
 *                  are written only where you have none yet (--force overwrites). Backed up first.
 *   2. packages  - runs `pi install` for every package in setup/settings.json that is not installed,
 *                  plus this repo itself (which ships the extensions).
 *   3. AGENTS.md - copies setup/AGENTS.md only if no user context file exists. Existing context
 *                  files are left untouched; maintain them yourself.
 *   4. prompts   - copies improve-agents-md and show-me to the global prompts directory. Existing content
 *                  is kept unless --force; changed files are backed up before replacement.
 *
 * Options:
 *   --dry-run       Print what would change, change nothing.
 *   --force         Overwrite settings and prompts with this setup's values (backed up first).
 *   --self <src>    Package source for this repo (default: SELF_SOURCE below).
 *   --no-self       Do not install this repo.
 *   --no-packages   Skip `pi install`.
 *   --no-agents     Skip AGENTS.md.
 *   --no-prompts    Skip prompt templates.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Where others install this repo from. Change it if you fork or rename the repo. */
const SELF_SOURCE = "git:github.com/hsuanguo/pi-seed";

const REPO_DIR = dirname(fileURLToPath(import.meta.url));
/** The user context file pi loads from the agent directory: the first of these that exists. */
const CONTEXT_FILES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];

function parseArgs(argv) {
	const opts = { dryRun: false, force: false, self: SELF_SOURCE, packages: true, agents: true, prompts: true };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--dry-run") opts.dryRun = true;
		else if (arg === "--force") opts.force = true;
		else if (arg === "--no-self") opts.self = undefined;
		else if (arg === "--no-packages") opts.packages = false;
		else if (arg === "--no-agents") opts.agents = false;
		else if (arg === "--no-prompts") opts.prompts = false;
		else if (arg === "--self") {
			const value = argv[++i];
			if (!value) throw new Error("--self needs a package source");
			// pi reads scp-style URLs only with a `git:` prefix; a local path is installed by absolute
			// path, so it works from any cwd.
			opts.self = /^git@/.test(value)
				? `git:${value}`
				: /^(npm:|git:|https?:|ssh:)/.test(value)
					? value
					: resolve(value);
		} else if (arg === "-h" || arg === "--help") {
			console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
			process.exit(0);
		} else throw new Error(`Unknown option: ${arg}`);
	}
	return opts;
}

function agentDir() {
	const env = process.env.PI_CODING_AGENT_DIR;
	if (!env) return join(homedir(), ".pi", "agent");
	return env.startsWith("~") ? join(homedir(), env.slice(1)) : resolve(env);
}

function readJson(path, fallback) {
	if (!existsSync(path)) return fallback;
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`Cannot parse ${path}: ${error.message}. Fix it and rerun.`);
	}
}

function backup(path, dryRun) {
	if (!existsSync(path) || dryRun) return undefined;
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const target = `${path}.bak-${stamp}`;
	copyFileSync(path, target);
	return target;
}

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** `+name`/`-name` entries of defaultTools must not undo an explicit opposite choice of the user. */
function conflictsWithOpposite(key, entry, existing) {
	if (key !== "defaultTools" || typeof entry !== "string" || !/^[+-]/.test(entry)) return false;
	const opposite = (entry[0] === "+" ? "-" : "+") + entry.slice(1);
	return existing.includes(opposite);
}

/** Merge `incoming` into `target` in place; returns human-readable change lines. */
function mergeSettings(target, incoming, force, path = "") {
	const changes = [];
	for (const [key, value] of Object.entries(incoming)) {
		const at = path ? `${path}.${key}` : key;
		const current = target[key];
		if (current === undefined) {
			target[key] = value;
			changes.push(`+ ${at} = ${JSON.stringify(value)}`);
		} else if (Array.isArray(current) && Array.isArray(value)) {
			for (const entry of value) {
				if (current.some((existing) => same(existing, entry))) continue;
				if (!force && conflictsWithOpposite(key, entry, current)) {
					changes.push(`= ${at}: kept your opposite of ${JSON.stringify(entry)}`);
					continue;
				}
				current.push(entry);
				changes.push(`+ ${at} += ${JSON.stringify(entry)}`);
			}
		} else if (isObject(current) && isObject(value)) {
			changes.push(...mergeSettings(current, value, force, at));
		} else if (!same(current, value)) {
			if (force) {
				target[key] = value;
				changes.push(`~ ${at}: ${JSON.stringify(current)} -> ${JSON.stringify(value)}`);
			} else {
				changes.push(`= ${at}: kept yours ${JSON.stringify(current)} (setup has ${JSON.stringify(value)}; --force to take it)`);
			}
		}
	}
	return changes;
}

/**
 * Identity pi uses to tell packages apart: npm name, git URL without ref, or absolute path.
 * pi stores local paths relative to the settings file, so they resolve from `baseDir`.
 */
function packageIdentity(pkg, baseDir) {
	const source = typeof pkg === "string" ? pkg : pkg?.source;
	if (typeof source !== "string") return undefined;
	if (source.startsWith("npm:")) {
		const spec = source.slice(4);
		const match = /^(@[^/]+\/[^@]+|[^@]+)/.exec(spec);
		return `npm:${match ? match[1] : spec}`;
	}
	if (/^(git:|https?:|ssh:|git@)/.test(source)) {
		let url = source.replace(/^git:/, "").replace(/^[a-z+]+:\/\//, "").replace(/^git@([^:]+):/, "$1/");
		url = url.replace(/@[^/@]*$/, "").replace(/\.git$/, "").replace(/\/+$/, "");
		return `git:${url.toLowerCase()}`;
	}
	return `local:${resolve(baseDir, source)}`;
}

function runPi(args, dryRun) {
	console.log(`  $ pi ${args.join(" ")}`);
	if (dryRun) return true;
	const result = spawnSync("pi", args, { stdio: "inherit", shell: process.platform === "win32" });
	if (result.error) throw new Error(`Cannot run pi: ${result.error.message}. Is pi on your PATH?`);
	return result.status === 0;
}

function applySettings(dir, opts) {
	console.log("\n[1/4] settings");
	const incoming = readJson(join(REPO_DIR, "setup", "settings.json"), {});
	delete incoming.packages; // installed through `pi install` in step 2
	const path = join(dir, "settings.json");
	const settings = readJson(path, {});
	const changes = mergeSettings(settings, incoming, opts.force);
	for (const line of changes) console.log(`  ${line}`);
	if (!changes.some((line) => /^[+~]/.test(line))) {
		console.log("  nothing to change");
		return;
	}
	const saved = backup(path, opts.dryRun);
	if (saved) console.log(`  backup: ${saved}`);
	if (!opts.dryRun) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
	}
}

function applyPackages(dir, opts) {
	console.log("\n[2/4] packages");
	const wanted = [...(readJson(join(REPO_DIR, "setup", "settings.json"), {}).packages ?? [])];
	if (opts.self) wanted.push(opts.self);
	const installed = new Set(
		(readJson(join(dir, "settings.json"), {}).packages ?? []).map((pkg) => packageIdentity(pkg, dir)).filter(Boolean),
	);
	const failed = [];
	for (const source of wanted) {
		if (installed.has(packageIdentity(source, REPO_DIR))) {
			console.log(`  = ${source} (already configured)`);
			continue;
		}
		if (!runPi(["install", source], opts.dryRun)) failed.push(source);
	}
	if (failed.length > 0) console.log(`  ! failed: ${failed.join(", ")} (rerun the installer to retry)`);
	return failed.length === 0;
}

function applyAgents(dir, opts) {
	console.log("\n[3/4] AGENTS.md");
	const name = CONTEXT_FILES.find((file) => existsSync(join(dir, file)));
	const source = join(REPO_DIR, "setup", "AGENTS.md");
	if (name) {
		console.log(`  = ${join(dir, name)} already exists; skipped. Maintain it yourself; merge any wanted changes from ${source} manually.`);
		return;
	}
	const path = join(dir, "AGENTS.md");
	console.log(`  copy ${source} -> ${path}`);
	if (!opts.dryRun) {
		mkdirSync(dir, { recursive: true });
		copyFileSync(source, path);
	}
}

function applyPrompts(dir, opts) {
	console.log("\n[4/4] prompts");
	for (const name of ["improve-agents-md.md", "show-me.md"]) {
		const source = join(REPO_DIR, "setup", "prompts", name);
		const path = join(dir, "prompts", name);
		if (existsSync(path)) {
			if (readFileSync(path, "utf8") === readFileSync(source, "utf8")) {
				console.log(`  = ${path} (already installed)`);
				continue;
			}
			if (!opts.force) {
				console.log(`  = ${path}: kept yours (--force to replace it)`);
				continue;
			}
		}
		console.log(`  copy ${source} -> ${path}`);
		const saved = backup(path, opts.dryRun);
		if (saved) console.log(`  backup: ${saved}`);
		if (!opts.dryRun) {
			mkdirSync(dirname(path), { recursive: true });
			copyFileSync(source, path);
		}
	}
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const dir = agentDir();
	console.log(`pi-seed -> ${dir}${opts.dryRun ? " (dry run)" : ""}`);
	applySettings(dir, opts);
	const packagesOk = opts.packages ? applyPackages(dir, opts) : (console.log("\n[2/4] packages: skipped"), true);
	if (opts.agents) applyAgents(dir, opts);
	else console.log("\n[3/4] AGENTS.md: skipped");
	if (opts.prompts) applyPrompts(dir, opts);
	else console.log("\n[4/4] prompts: skipped");
	console.log(`\nDone${opts.dryRun ? " (dry run, nothing changed)" : ""}. Start a new pi session, or /reload in a running one.`);
	if (!packagesOk) process.exitCode = 1;
}

try {
	main();
} catch (error) {
	console.error(`pi-seed: ${error.message}`);
	process.exitCode = 1;
}

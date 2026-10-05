// Installer tests. install.mjs runs as a child process against a copy of the repo with a fixed
// template, a sandbox agent directory, and a fake `pi` on PATH that records `pi install` calls and
// writes settings like pi does (local paths relative to the settings file).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createSandbox, REPO_DIR, type Sandbox } from "./helpers.ts";

const TEMPLATE = {
	enableSkillCommands: true,
	defaultTools: ["+codemode"],
	enabledModels: ["shared/*"],
	packages: ["npm:pkg-a", "npm:@scope/pkg-b"],
};

const FAKE_PI = `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const [cmd, source] = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_PI_LOG, process.argv.slice(2).join(" ") + "\\n");
if (cmd !== "install") process.exit(0);
if ((process.env.FAKE_PI_FAIL || "").split(",").includes(source)) { console.error("boom"); process.exit(1); }
const dir = process.env.PI_CODING_AGENT_DIR, file = path.join(dir, "settings.json");
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const stored = /^(npm:|git:|https?:|ssh:)/.test(source) ? source : path.relative(dir, path.resolve(source));
settings.packages = [...(settings.packages || []), stored];
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(settings, null, 2));
`;

interface Env {
	sandbox: Sandbox;
	repo: string;
	run(args?: string[], extraEnv?: Record<string, string>): { status: number | null; stdout: string; stderr: string };
	piCalls(): string[];
	settings(): Record<string, unknown>;
	read(name: string): string;
	backups(): string[];
}

function setup(template: object = TEMPLATE, agents = "## Shared rules\n- be clear"): Env {
	const sandbox = createSandbox();
	const repo = join(sandbox.root, "repo");
	sandbox.write("repo/install.mjs", readFileSync(join(REPO_DIR, "install.mjs"), "utf8"));
	sandbox.write("repo/setup/settings.json", JSON.stringify(template));
	sandbox.write("repo/setup/AGENTS.md", agents);
	const bin = sandbox.write("bin/pi", FAKE_PI);
	chmodSync(bin, 0o755);
	const log = sandbox.write("pi-calls.log", "");
	return {
		sandbox,
		repo,
		run(args = ["--no-self"], extraEnv = {}) {
			const result = spawnSync(process.execPath, [join(repo, "install.mjs"), ...args], {
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${join(sandbox.root, "bin")}:${process.env.PATH}`,
					PI_CODING_AGENT_DIR: sandbox.agentDir,
					FAKE_PI_LOG: log,
					...extraEnv,
				},
			});
			return { status: result.status, stdout: result.stdout, stderr: result.stderr };
		},
		piCalls: () => readFileSync(log, "utf8").split("\n").filter(Boolean),
		settings: () => JSON.parse(readFileSync(join(sandbox.agentDir, "settings.json"), "utf8")),
		read: (name) => readFileSync(join(sandbox.agentDir, name), "utf8"),
		backups: () => readdirSync(sandbox.agentDir).filter((name) => name.includes(".bak-")),
	};
}

test("fresh install: settings without packages, every package installed, plain AGENTS.md, no backups", () => {
	const env = setup();
	const result = env.run();
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(env.piCalls(), ["install npm:pkg-a", "install npm:@scope/pkg-b"]);
	const { packages, ...rest } = env.settings();
	assert.deepEqual(rest, { enableSkillCommands: true, defaultTools: ["+codemode"], enabledModels: ["shared/*"] });
	assert.deepEqual(packages, ["npm:pkg-a", "npm:@scope/pkg-b"]);
	assert.equal(env.read("AGENTS.md"), readFileSync(join(env.repo, "setup/AGENTS.md"), "utf8"));
	assert.deepEqual(env.backups(), []);
});

test("existing settings: own values kept, lists unioned, opposite tool choice respected, backed up", () => {
	const env = setup();
	env.sandbox.write("agent/settings.json", JSON.stringify({ enableSkillCommands: false, defaultTools: ["-codemode"], enabledModels: ["mine/*"], packages: ["npm:pkg-a@1.2.3"] }));
	const result = env.run();
	assert.equal(result.status, 0, result.stderr);
	const settings = env.settings();
	assert.equal(settings.enableSkillCommands, false);
	assert.deepEqual(settings.defaultTools, ["-codemode"]);
	assert.deepEqual(settings.enabledModels, ["mine/*", "shared/*"]);
	assert.deepEqual(env.piCalls(), ["install npm:@scope/pkg-b"], "a pinned version counts as installed");
	assert.match(result.stdout, /kept yours false/);
	assert.equal(env.backups().filter((name) => name.startsWith("settings.json")).length, 1);
});

test("--force takes the setup's values", () => {
	const env = setup();
	env.sandbox.write("agent/settings.json", JSON.stringify({ enableSkillCommands: false, defaultTools: ["-codemode"] }));
	assert.equal(env.run(["--no-self", "--force", "--no-packages"]).status, 0);
	assert.equal(env.settings().enableSkillCommands, true);
	assert.deepEqual(env.settings().defaultTools, ["-codemode", "+codemode"]);
});

test("rerun is idempotent, including a local self package stored relative to the agent dir", () => {
	const env = setup();
	assert.equal(env.run(["--self", env.repo]).status, 0);
	const before = { settings: env.read("settings.json"), agents: env.read("AGENTS.md"), backups: env.backups() };
	const calls = env.piCalls().length;
	const second = env.run(["--self", env.repo]);
	assert.equal(second.status, 0, second.stderr);
	assert.equal(env.piCalls().length, calls, "no pi install on rerun");
	assert.match(second.stdout, /already configured\)[\s\S]*already configured\)[\s\S]*already configured\)/);
	assert.deepEqual({ settings: env.read("settings.json"), agents: env.read("AGENTS.md"), backups: env.backups() }, before);
});

test("--dry-run changes nothing and calls no pi", () => {
	const env = setup();
	env.sandbox.write("agent/settings.json", "{}");
	const result = env.run(["--no-self", "--dry-run"]);
	assert.equal(result.status, 0);
	assert.match(result.stdout, /\$ pi install npm:pkg-a/);
	assert.deepEqual(env.piCalls(), []);
	assert.equal(env.read("settings.json"), "{}");
	assert.ok(!existsSync(join(env.sandbox.agentDir, "AGENTS.md")));
});

test("existing context files are untouched, even with --force or a changed template", () => {
	for (const name of ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]) {
		const env = setup();
		const original = "# Mine\n- keep me\n";
		env.sandbox.write(`agent/${name}`, original);
		for (const args of [["--no-self", "--no-packages"], ["--no-self", "--no-packages", "--force"]]) {
			writeFileSync(join(env.repo, "setup/AGENTS.md"), "## Shared rules v2");
			const result = env.run(args);
			assert.equal(result.status, 0, result.stderr);
			assert.equal(env.read(name), original);
			assert.match(result.stdout, /Maintain it yourself/);
			if (name !== "AGENTS.md") assert.ok(!existsSync(join(env.sandbox.agentDir, "AGENTS.md")));
		}
	}
});

test("copied context is never replaced when the template changes", () => {
	const env = setup({}, "Original template\n");
	assert.equal(env.run(["--no-self", "--no-packages"]).status, 0);
	writeFileSync(join(env.repo, "setup/AGENTS.md"), "Changed template\n");
	assert.equal(env.run(["--no-self", "--no-packages", "--force"]).status, 0);
	assert.equal(env.read("AGENTS.md"), "Original template\n");
});

test("--self normalizes scp-style git URLs", () => {
	const env = setup({ packages: [] });
	env.run(["--self", "git@github.com:someone/pi-seed.git", "--no-agents"]);
	assert.deepEqual(env.piCalls(), ["install git:git@github.com:someone/pi-seed.git"]);
});

test("a failed pi install exits 1 and the rest still installs", () => {
	const env = setup();
	const result = env.run(["--no-self"], { FAKE_PI_FAIL: "npm:pkg-a" });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /failed: npm:pkg-a/);
	assert.deepEqual(env.settings().packages, ["npm:@scope/pkg-b"]);
});

test("unparsable settings.json: exit 1, file untouched", () => {
	const env = setup();
	env.sandbox.write("agent/settings.json", "{ broken");
	const result = env.run();
	assert.equal(result.status, 1);
	assert.match(result.stderr, /Cannot parse/);
	assert.equal(env.read("settings.json"), "{ broken");
	assert.deepEqual(env.piCalls(), []);
});

test("the shipped template is valid and holds only shareable defaults", () => {
	const template = JSON.parse(readFileSync(join(REPO_DIR, "setup/settings.json"), "utf8"));
	for (const personal of ["theme", "defaultProvider", "defaultModel", "defaultThinkingLevel", "enabledModels", "lastChangelogVersion"]) {
		assert.ok(!(personal in template), `setup/settings.json must not set ${personal}`);
	}
	for (const pkg of template.packages ?? []) assert.match(pkg, /^(npm:|git:)/, `${pkg}: public source`);
	assert.match(readFileSync(join(REPO_DIR, "install.mjs"), "utf8"), /const SELF_SOURCE = "git:github\.com\/hsuanguo\/pi-seed";/);
});

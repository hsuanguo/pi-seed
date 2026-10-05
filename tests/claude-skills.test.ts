// Integration tests: claude-skills in a real AgentSession. HOME is the sandbox, so
// `~/.claude/skills` is a fixture, never the developer's own.
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createSandbox, createTestSession, extensionPath, type Sandbox, skillMd } from "./helpers.ts";

const EXT = extensionPath("claude-skills");

/** repo/ is a git repository; the session runs in repo/pkg. */
function fixture(sandbox: Sandbox) {
	sandbox.write("home/.claude/skills/user-skill/SKILL.md", skillMd("user-skill"));
	sandbox.write("home/.claude/skills/README.md", "# Not a skill");
	sandbox.write("home/.claude/skills/loose.md", skillMd("loose-md"));
	sandbox.write("above/.claude/skills/above-skill/SKILL.md", skillMd("above-skill"));
	mkdirSync(join(sandbox.root, "above/repo/.git"), { recursive: true });
	sandbox.write("above/repo/.claude/skills/repo-skill/SKILL.md", skillMd("repo-skill"));
	sandbox.write("above/repo/pkg/.claude/skills/pkg-skill/SKILL.md", skillMd("pkg-skill"));
	return join(sandbox.root, "above/repo/pkg");
}

async function loadedSkills(sandbox: Sandbox, cwd: string, trusted: boolean) {
	const t = await createTestSession(sandbox, { cwd, extensions: [EXT], trusted });
	const skills = t.session.resourceLoader.getSkills().skills;
	return { t, names: skills.map((skill) => skill.name).sort(), skills };
}

test("user skills load; loose .md files are not skills", async () => {
	const sandbox = createSandbox();
	const { t, names } = await loadedSkills(sandbox, fixture(sandbox), false);
	assert.deepEqual(names, ["user-skill"]);
	t.dispose();
});

test("project skills load only when trusted, from cwd up to the git root", async () => {
	const sandbox = createSandbox();
	const { t, names } = await loadedSkills(sandbox, fixture(sandbox), true);
	assert.deepEqual(names, ["pkg-skill", "repo-skill", "user-skill"]);
	t.dispose();
});

test("config ignores user or project skills; project config needs trust", async () => {
	const sandbox = createSandbox();
	const cwd = fixture(sandbox);
	sandbox.write("agent/pi-seed-config.json", JSON.stringify({ claudeSkills: { ignoreUserSkills: true } }));
	sandbox.write("above/repo/pkg/.pi/pi-seed-config.json", JSON.stringify({ claudeSkills: { ignoreUserSkills: false, ignoreProjectSkills: true } }));
	const untrusted = await loadedSkills(sandbox, cwd, false);
	assert.deepEqual(untrusted.names, []);
	untrusted.t.dispose();
	const trusted = await loadedSkills(sandbox, cwd, true);
	assert.deepEqual(trusted.names, ["user-skill"]);
	trusted.t.dispose();
});

test("a native pi skill wins a name collision", async () => {
	const sandbox = createSandbox();
	const cwd = fixture(sandbox);
	const native = sandbox.write("agent/skills/user-skill/SKILL.md", skillMd("user-skill", "native"));
	const { t, skills } = await loadedSkills(sandbox, cwd, false);
	assert.equal(skills.find((skill) => skill.name === "user-skill")?.filePath, native);
	t.dispose();
});

test("/claude-skills reports loaded, untrusted, and invalid config", async () => {
	const sandbox = createSandbox();
	const cwd = fixture(sandbox);
	sandbox.write("agent/pi-seed-config.json", JSON.stringify({ claudeSkills: { ignoreUserSkills: "yes", extra: 1 } }));
	const { t } = await loadedSkills(sandbox, cwd, false);
	await t.session.prompt("/claude-skills");
	const report = t.notices.at(-1)!;
	assert.match(report, /Claude skills: 1 loaded/);
	assert.match(report, /✓ user-skill/);
	assert.match(report, /Skipped \(project not trusted\):[\s\S]*repo\/\.claude\/skills/);
	assert.match(report, /"claudeSkills.ignoreUserSkills" must be a boolean/);
	assert.match(report, /unknown key "claudeSkills.extra"/);
	t.dispose();
});

test("eager discovers sibling and deeper skills, preserving ancestors and excluding hidden and linked directories", async () => {
	const sandbox = createSandbox();
	const cwd = fixture(sandbox);
	sandbox.write("above/repo/A/.claude/skills/sibling-skill/SKILL.md", skillMd("sibling-skill"));
	sandbox.write("above/repo/A/deep/.claude/skills/deep-skill/SKILL.md", skillMd("deep-skill"));
	sandbox.write("above/repo/A/.claude/skills/pkg-skill/SKILL.md", skillMd("pkg-skill", "shadowed"));
	sandbox.write("above/repo/.hidden/.claude/skills/hidden-skill/SKILL.md", skillMd("hidden-skill"));
	sandbox.write("above/repo/node_modules/lib/.claude/skills/dependency-skill/SKILL.md", skillMd("dependency-skill"));
	sandbox.write("external/.claude/skills/external-skill/SKILL.md", skillMd("external-skill"));
	symlinkSync(join(sandbox.root, "external"), join(sandbox.root, "above/repo/linked"), "dir");
	const defaults = await loadedSkills(sandbox, cwd, true);
	assert.deepEqual(defaults.names, ["pkg-skill", "repo-skill", "user-skill"]);
	defaults.t.dispose();
	sandbox.write("agent/pi-seed-config.json", JSON.stringify({ claudeSkills: { mode: "eager" }, scopedContext: { mode: "lazy" } }));
	const { t, names, skills } = await loadedSkills(sandbox, cwd, true);
	assert.deepEqual(names, ["deep-skill", "pkg-skill", "repo-skill", "sibling-skill", "user-skill"]);
	assert.equal(skills.find(skill => skill.name === "pkg-skill")?.filePath, join(cwd, ".claude/skills/pkg-skill/SKILL.md"));
	await t.session.prompt("/claude-skills");
	assert.match(t.notices.at(-1)!, /Mode: eager/);
	assert.ok(!t.notices.at(-1)!.includes("unknown section"));
	t.dispose();
});

test("eager skips entire nested repositories with .git directories or files; direct startup loads them", async () => {
	const sandbox = createSandbox();
	const cwd = fixture(sandbox);
	const inner = join(sandbox.root, "above/repo/sandbox");
	const nested = join(inner, "B");
	const worktree = join(sandbox.root, "above/repo/worktree");
	for (const dir of [inner, nested]) mkdirSync(join(dir, ".git"), { recursive: true });
	sandbox.write("above/repo/sandbox/.claude/skills/sandbox-skill/SKILL.md", skillMd("sandbox-skill"));
	sandbox.write("above/repo/sandbox/B/.claude/skills/nested-skill/SKILL.md", skillMd("nested-skill"));
	sandbox.write("above/repo/worktree/.git", "gitdir: /unused/test-fixture\n");
	sandbox.write("above/repo/worktree/.claude/skills/worktree-skill/SKILL.md", skillMd("worktree-skill"));
	sandbox.write("agent/pi-seed-config.json", JSON.stringify({ claudeSkills: { mode: "eager" } }));
	for (const [start, expected] of [
		[cwd, ["pkg-skill", "repo-skill", "user-skill"]],
		[inner, ["sandbox-skill", "user-skill"]],
		[nested, ["nested-skill", "user-skill"]],
		[worktree, ["user-skill", "worktree-skill"]],
	] as const) {
		const { t, names } = await loadedSkills(sandbox, start, true);
		assert.deepEqual(names, expected);
		t.dispose();
	}
});

test("eager respects trust, project ignores, valid project overrides and invalid mode fallback", async () => {
	const sandbox = createSandbox();
	const cwd = fixture(sandbox);
	sandbox.write("above/repo/A/.claude/skills/sibling-skill/SKILL.md", skillMd("sibling-skill"));
	sandbox.write("agent/pi-seed-config.json", JSON.stringify({ claudeSkills: { mode: "eager", ignoreUserSkills: true } }));
	sandbox.write("above/repo/pkg/.pi/pi-seed-config.json", JSON.stringify({ claudeSkills: { ignoreUserSkills: false, mode: "ancestors" } }));
	const untrusted = await loadedSkills(sandbox, cwd, false);
	assert.deepEqual(untrusted.names, []);
	untrusted.t.dispose();
	const ancestors = await loadedSkills(sandbox, cwd, true);
	assert.deepEqual(ancestors.names, ["pkg-skill", "repo-skill", "user-skill"]);
	ancestors.t.dispose();
	sandbox.write("above/repo/pkg/.pi/pi-seed-config.json", JSON.stringify({ claudeSkills: { mode: "wrong" } }));
	const fallback = await loadedSkills(sandbox, cwd, true);
	assert.deepEqual(fallback.names, ["pkg-skill", "repo-skill", "sibling-skill"]);
	await fallback.t.session.prompt("/claude-skills");
	assert.match(fallback.t.notices.at(-1)!, /"claudeSkills.mode" must be/);
	fallback.t.dispose();
	sandbox.write("above/repo/pkg/.pi/pi-seed-config.json", JSON.stringify({ claudeSkills: { ignoreProjectSkills: true } }));
	const ignored = await loadedSkills(sandbox, cwd, true);
	assert.deepEqual(ignored.names, []);
	ignored.t.dispose();
});

test("legacy config files are ignored; eager outside Git starts at cwd", async () => {
	const sandbox = createSandbox();
	sandbox.write("agent/claude-skills.json", JSON.stringify({ ignoreProjectSkills: true }));
	sandbox.write("workspace/.claude/skills/root-skill/SKILL.md", skillMd("root-skill"));
	sandbox.write("workspace/child/.claude/skills/child-skill/SKILL.md", skillMd("child-skill"));
	sandbox.write("outside/.claude/skills/outside-skill/SKILL.md", skillMd("outside-skill"));
	sandbox.write("agent/pi-seed-config.json", JSON.stringify({ claudeSkills: { mode: "eager" } }));
	const { t, names } = await loadedSkills(sandbox, sandbox.workspace, true);
	assert.deepEqual(names, ["child-skill", "root-skill"]);
	t.dispose();
});

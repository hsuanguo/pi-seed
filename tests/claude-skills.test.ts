// Integration tests: claude-skills in a real AgentSession. HOME is the sandbox, so
// `~/.claude/skills` is a fixture, never the developer's own.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
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
	sandbox.write("agent/claude-skills.json", JSON.stringify({ ignoreUserSkills: true }));
	sandbox.write("above/repo/pkg/.pi/claude-skills.json", JSON.stringify({ ignoreUserSkills: false, ignoreProjectSkills: true }));
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
	sandbox.write("agent/claude-skills.json", JSON.stringify({ ignoreUserSkills: "yes", extra: 1 }));
	const { t } = await loadedSkills(sandbox, cwd, false);
	await t.session.prompt("/claude-skills");
	const report = t.notices.at(-1)!;
	assert.match(report, /Claude skills: 1 loaded/);
	assert.match(report, /✓ user-skill/);
	assert.match(report, /Skipped \(project not trusted\):[\s\S]*repo\/\.claude\/skills/);
	assert.match(report, /"ignoreUserSkills" must be a boolean/);
	assert.match(report, /unknown key "extra"/);
	t.dispose();
});

// Integration tests: scoped-context in a real AgentSession (faux model, real tools, real
// compaction, real codemode sandbox). Edge cases of the matching logic live in the unit tests.
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import { createSandbox, createTestSession, extensionPath, type Sandbox } from "./helpers.ts";

const EXT = extensionPath("scoped-context");

function monorepo(sandbox: Sandbox) {
	sandbox.write("workspace/AGENTS.md", "ROOT RULES");
	sandbox.write("workspace/A/AGENTS.md", "A RULES");
	sandbox.write("workspace/A/src/CLAUDE.md", "A SRC RULES");
	sandbox.write("workspace/A/src/a.ts", "export const a = 1;\n");
	sandbox.write("workspace/B/AGENTS.md", "B RULES");
	sandbox.write("workspace/B/b.ts", "export const b = 1;\n");
	sandbox.write("workspace/big.txt", `${"filler line\n".repeat(800)}`);
}

const countBlocks = (text: string, file: string) => text.split(`<scoped_context file="${file}"`).length - 1;

test("lazy: first touch appends outer then inner files once; the record precedes its tool result", async () => {
	const sandbox = createSandbox();
	monorepo(sandbox);
	const t = await createTestSession(sandbox, { extensions: [EXT] });
	await t.turnWithTools([{ name: "read", args: { path: "A/src/a.ts" } }]);
	await t.turnWithTools([{ name: "edit", args: { path: "A/src/a.ts", edits: [{ oldText: "1", newText: "2" }] } }]);
	await t.turnWithTools([{ name: "read", args: { path: "B/b.ts" } }]);

	const [readA, readB] = t.toolResults("read");
	assert.ok(readA.indexOf("A RULES") < readA.indexOf("A SRC RULES"), "outer before inner");
	assert.ok(!readA.includes("ROOT RULES"), "pi loads the root file itself");
	assert.equal(countBlocks(t.toolResults("edit")[0], "A/AGENTS.md"), 0, "not appended twice");
	assert.match(readB, /B RULES/);
	assert.ok(!readB.includes("A RULES"));

	const kinds = t.session.sessionManager
		.getBranch()
		.map((entry) => (entry.type === "custom" ? `custom:${entry.customType}` : entry.type === "message" ? entry.message.role : entry.type));
	const first = kinds.indexOf("custom:scoped-context");
	assert.equal(kinds[first + 1], "toolResult", "compaction cut points keep a record with its result");
	t.dispose();
});

test("lazy: parallel calls into the same directory append its file once", async () => {
	const sandbox = createSandbox();
	monorepo(sandbox);
	const t = await createTestSession(sandbox, { extensions: [EXT] });
	await t.turnWithTools([
		{ name: "read", args: { path: "A/src/a.ts" } },
		{ name: "ls", args: { path: "A" } },
		{ name: "find", args: { path: "A", pattern: "*.ts" } },
	]);
	const all = [...t.toolResults("read"), ...t.toolResults("ls"), ...t.toolResults("find")].join("\n");
	assert.equal(countBlocks(all, "A/AGENTS.md"), 1);
	t.dispose();
});

test("lazy: after real compaction summarizes the result, the next touch appends again", async () => {
	const sandbox = createSandbox();
	monorepo(sandbox);
	const t = await createTestSession(sandbox, { extensions: [EXT], settings: { compaction: { enabled: false, keepRecentTokens: 1 } } });
	await t.turnWithTools([{ name: "read", args: { path: "A/src/a.ts" } }]);
	await t.textTurn();
	await t.compact();
	await t.turnWithTools([{ name: "read", args: { path: "A/src/a.ts" } }]);
	assert.equal(countBlocks(t.toolResults("read").at(-1)!, "A/AGENTS.md"), 1);
	t.dispose();
});

test("lazy: after real compaction keeps the result, the next touch appends nothing", async () => {
	const sandbox = createSandbox();
	monorepo(sandbox);
	// The large early read is summarized; the A turn after it stays within keepRecentTokens.
	const t = await createTestSession(sandbox, { extensions: [EXT], settings: { compaction: { enabled: false, keepRecentTokens: 1500 } } });
	await t.turnWithTools([{ name: "read", args: { path: "big.txt" } }]);
	await t.turnWithTools([{ name: "read", args: { path: "A/src/a.ts" } }]);
	await t.compact();
	const branch = t.session.sessionManager.getBranch();
	const compaction = branch.findLast((entry) => entry.type === "compaction");
	assert.ok(compaction && compaction.type === "compaction");
	const keptIndex = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
	const recordIndex = branch.findIndex((entry) => entry.type === "custom" && entry.customType === "scoped-context");
	assert.ok(keptIndex <= recordIndex, "fixture: the A record is in the kept part");
	await t.turnWithTools([{ name: "read", args: { path: "A/src/a.ts" } }]);
	assert.equal(countBlocks(t.toolResults("read").at(-1)!, "A/AGENTS.md"), 0);
	t.dispose();
});

test("lazy: edited, overridden, and deleted files are updated or withdrawn", async () => {
	const sandbox = createSandbox();
	monorepo(sandbox);
	const t = await createTestSession(sandbox, { extensions: [EXT] });
	const readA = async () => {
		await t.turnWithTools([{ name: "read", args: { path: "A/src/a.ts" } }]);
		return t.toolResults("read").at(-1)!;
	};
	await readA();
	writeFileSync(join(sandbox.workspace, "A/AGENTS.md"), "A RULES v2");
	assert.match(await readA(), /changed since it was loaded[\s\S]*A RULES v2/);
	sandbox.write("workspace/A/AGENTS.override.md", "A OVERRIDE");
	assert.match(await readA(), /replaces A\/AGENTS.md for this directory[\s\S]*A OVERRIDE/);
	rmSync(join(sandbox.workspace, "A/AGENTS.override.md"));
	rmSync(join(sandbox.workspace, "A/AGENTS.md"));
	assert.match(await readA(), /removed="A\/AGENTS.override.md"/);
	assert.ok(!(await readA()).includes("<scoped_context"), "withdrawn once");
	t.dispose();
});

test("lazy: calls from a codemode script append to the codemode result, not the script's values", async () => {
	const sandbox = createSandbox();
	monorepo(sandbox);
	const t = await createTestSession(sandbox, {
		extensions: [EXT],
		extensionFactories: [createCodemodeExtension()],
		settings: { compaction: { enabled: false }, defaultTools: ["+codemode"] },
	});
	const code = `const a = await tools.read({ path: "A/src/a.ts" });
await tools.read({ path: "B/b.ts" });
text(a.includes("<scoped_context") ? "SCRIPT SAW CONTEXT" : "script value clean");`;
	await t.turnWithTools([{ name: "codemode", args: { code } }]);
	const result = t.toolResults("codemode")[0];
	assert.match(result, /script value clean/);
	assert.equal(countBlocks(result, "A/AGENTS.md"), 1);
	assert.equal(countBlocks(result, "B/AGENTS.md"), 1);
	t.dispose();
});

test("lazy: /scoped-context lists the files in context and their state", async () => {
	const sandbox = createSandbox();
	monorepo(sandbox);
	const t = await createTestSession(sandbox, { extensions: [EXT] });
	await t.turnWithTools([{ name: "read", args: { path: "A/src/a.ts" } }]);
	writeFileSync(join(sandbox.workspace, "A/src/CLAUDE.md"), "changed");
	await t.session.prompt("/scoped-context");
	const report = t.notices.at(-1)!;
	assert.match(report, /Mode: lazy/);
	assert.match(report, /A\/AGENTS.md \(current\)/);
	assert.match(report, /A\/src\/CLAUDE.md \(changed since, updated on next touch\)/);
	t.dispose();
});

test("eager: files enter the system prompt with their scope; stable across turns; tool results untouched", async () => {
	const sandbox = createSandbox();
	monorepo(sandbox);
	sandbox.write("agent/scoped-context.json", JSON.stringify({ mode: "eager" }));
	const t = await createTestSession(sandbox, { extensions: [EXT] });
	await t.textTurn();
	const [prompt] = t.systemMessages();
	for (const [file, scope] of [["A/AGENTS.md", "A/"], ["B/AGENTS.md", "B/"], ["A/src/CLAUDE.md", "A/src/"]]) {
		assert.ok(prompt.includes(`<project_instructions path=\\"${join(sandbox.workspace, file)}\\">`), file);
		assert.ok(prompt.includes(`Applies only to files under ${scope};`), scope);
	}
	assert.ok(prompt.indexOf("ROOT RULES") < prompt.indexOf("A RULES"), "root file first");
	await t.turnWithTools([{ name: "read", args: { path: "A/src/a.ts" } }]);
	await t.textTurn();
	assert.equal(t.systemMessages().length, 1, "the prompt does not change between turns");
	assert.ok(!t.toolResults("read")[0].includes("<scoped_context"));
	t.dispose();
});

test("project config applies only to trusted projects", async () => {
	for (const trusted of [false, true]) {
		const sandbox = createSandbox();
		monorepo(sandbox);
		sandbox.write("workspace/.pi/scoped-context.json", JSON.stringify({ mode: "eager" }));
		const t = await createTestSession(sandbox, { extensions: [EXT], trusted });
		await t.textTurn();
		assert.equal(t.systemMessages().join("").includes("A RULES"), trusted);
		t.dispose();
	}
});

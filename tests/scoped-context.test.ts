import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import scopedContext, {
	discoverAll,
	ENTRY_TYPE,
	loadConfig,
	loadedOnBranch,
	scopedContextFiles,
} from "../extensions/scoped-context.ts";
import { createSandbox } from "./helpers.ts";

// Unit tests: drive the handlers with a fake pi and session branch. Real-session behavior
// (compaction, codemode, system prompt) is covered in scoped-context.session.test.ts.
const AGENT_DIR = createSandbox().agentDir;

function write(root: string, path: string, content: string) {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), content);
}

function makeRepo() {
	const root = mkdtempSync(join(tmpdir(), "scoped-"));
	write(root, "AGENTS.md", "ROOT RULES");
	write(root, "A/AGENTS.md", "A RULES");
	write(root, "A/sub/CLAUDE.md", "A SUB RULES");
	write(root, "A/sub/file.ts", "code");
	write(root, "A/x/AGENTS.override.md", "A X OVERRIDE");
	write(root, "A/x/AGENTS.md", "A X NORMAL");
	write(root, "B/AGENTS.md", "B RULES");
	write(root, "B/b.ts", "code");
	write(root, "node_modules/pkg/AGENTS.md", "NM RULES");
	write(root, ".hidden/AGENTS.md", "HIDDEN RULES");
	return root;
}

/** Drives the extension with a fake pi, session branch, and UI. */
function harness(cwd: string, opts: { config?: object; projectConfig?: object; trusted?: boolean } = {}) {
	rmSync(join(AGENT_DIR, "scoped-context.json"), { force: true });
	if (opts.config) writeFileSync(join(AGENT_DIR, "scoped-context.json"), JSON.stringify(opts.config));
	if (opts.projectConfig) write(cwd, ".pi/scoped-context.json", JSON.stringify(opts.projectConfig));
	const branch: any[] = [];
	const handlers: Record<string, any> = {};
	const notices: string[] = [];
	const pi: any = {
		on: (name: string, fn: any) => (handlers[name] = fn),
		appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", id: `e${branch.length}`, customType, data }),
		registerCommand: () => {},
	};
	scopedContext(pi);
	const ctx: any = {
		cwd,
		isProjectTrusted: () => opts.trusted ?? false,
		ui: { notify: (message: string) => notices.push(message) },
		sessionManager: { getBranch: () => branch },
	};
	handlers.resources_discover({ type: "resources_discover", cwd, reason: "startup" }, ctx);
	const call = (toolName: string, input: any, extra: any = {}) => {
		const out = handlers.tool_result(
			{ type: "tool_result", toolCallId: extra.toolCallId ?? `t${Math.random()}`, toolName, input, content: extra.content ?? [{ type: "text", text: "result" }], isError: false, ...extra },
			ctx,
		);
		return out ? out.content.map((b: any) => b.text).join("\n") : undefined;
	};
	const systemPrompt = (existing: { path: string; content: string }[] = []) => {
		const event = { type: "before_agent_start", prompt: "", systemPrompt: "", systemPromptOptions: { contextFiles: existing } };
		handlers.before_agent_start(event, ctx);
		return event.systemPromptOptions.contextFiles;
	};
	return { branch, call, ctx, notices, systemPrompt };
}

// ---------------------------------------------------------------- discovery helpers

test("finds nested files outermost first; excludes cwd, node_modules, hidden dirs, outside cwd", () => {
	const root = makeRepo();
	assert.deepEqual(scopedContextFiles(join(root, "A/sub/file.ts"), root).map((f) => f.relPath), ["A/AGENTS.md", "A/sub/CLAUDE.md"]);
	assert.deepEqual(scopedContextFiles(join(root, "A/sub"), root).map((f) => f.scope), ["A/", "A/sub/"]);
	assert.deepEqual(scopedContextFiles(join(root, "A/x/f.ts"), root).map((f) => f.relPath), ["A/AGENTS.md", "A/x/AGENTS.override.md"]);
	assert.deepEqual(scopedContextFiles(join(root, "node_modules/pkg/index.js"), root), []);
	assert.deepEqual(scopedContextFiles(join(root, ".hidden/f.ts"), root), []);
	assert.deepEqual(scopedContextFiles(join(root, "README.md"), root), []);
	assert.deepEqual(scopedContextFiles("/etc/hosts", root), []);
	assert.deepEqual(scopedContextFiles(join(root, "A/new/dir/f.ts"), root).map((f) => f.relPath), ["A/AGENTS.md"]);
});

test("discoverAll: walk outside git, one file per directory, outermost first", () => {
	const root = makeRepo();
	assert.deepEqual(discoverAll(root).map((f) => f.relPath), ["A/AGENTS.md", "B/AGENTS.md", "A/sub/CLAUDE.md", "A/x/AGENTS.override.md"]);
});

test("discoverAll: git repo honors .gitignore and includes untracked files", () => {
	const root = makeRepo();
	write(root, ".gitignore", "build/\n");
	write(root, "build/AGENTS.md", "BUILD RULES");
	execSync("git init -q && git add A B .gitignore", { cwd: root });
	write(root, "C/AGENTS.md", "C RULES (untracked)");
	const found = discoverAll(root).map((f) => f.relPath);
	assert.ok(found.includes("C/AGENTS.md"));
	assert.ok(!found.includes("build/AGENTS.md"));
	assert.ok(!found.some((p) => p.startsWith("node_modules") || p.startsWith(".hidden")));
});

// ---------------------------------------------------------------- config

test("config: default lazy; user file; project file only when trusted; invalid values warn", () => {
	const root = makeRepo();
	assert.equal(loadConfig(root, true, AGENT_DIR).config.mode, "lazy");
	writeFileSync(join(AGENT_DIR, "scoped-context.json"), JSON.stringify({ mode: "eager" }));
	write(root, ".pi/scoped-context.json", JSON.stringify({ mode: "lazy" }));
	assert.equal(loadConfig(root, false, AGENT_DIR).config.mode, "eager");
	assert.equal(loadConfig(root, true, AGENT_DIR).config.mode, "lazy");
	writeFileSync(join(AGENT_DIR, "scoped-context.json"), JSON.stringify({ mode: "always", extra: 1 }));
	const bad = loadConfig(root, false, AGENT_DIR);
	assert.equal(bad.config.mode, "lazy");
	assert.equal(bad.warnings.length, 2);
	writeFileSync(join(AGENT_DIR, "scoped-context.json"), "{ not json");
	assert.match(loadConfig(root, false, AGENT_DIR).warnings[0], /invalid JSON/);
	rmSync(join(AGENT_DIR, "scoped-context.json"));
});

// ---------------------------------------------------------------- lazy mode

test("lazy: injects once per directory, B separately, nothing for cwd-level paths or other tools", () => {
	const root = makeRepo();
	const h = harness(root);
	const first = h.call("read", { path: "A/sub/file.ts" })!;
	assert.match(first, /^result\n<scoped_context file="A\/AGENTS.md" scope="A\/">/);
	assert.ok(first.indexOf("A RULES") < first.indexOf("A SUB RULES"));
	assert.ok(!first.includes("ROOT RULES"));
	assert.equal(h.call("edit", { path: "A/sub/file.ts" }), undefined);
	assert.equal(h.call("ls", { path: "A" }), undefined);
	assert.match(h.call("write", { path: `${root}/B/new.ts` })!, /B RULES/);
	assert.equal(h.call("grep", { pattern: "x" }), undefined);
	assert.equal(h.call("bash", { command: "cat A/AGENTS.md", path: "A/sub/file.ts" }), undefined);
	assert.equal(h.call("read", { path: "README.md" }), undefined);
	assert.equal(h.branch.filter((e) => e.customType === ENTRY_TYPE).length, 2);
	assert.equal(h.systemPrompt().length, 0, "lazy mode leaves the system prompt alone");
});

test("lazy: changed file replaces the earlier version", () => {
	const root = makeRepo();
	const h = harness(root);
	h.call("read", { path: "A/sub/file.ts" });
	writeFileSync(join(root, "A/AGENTS.md"), "A RULES v2");
	const again = h.call("read", { path: "A/sub/file.ts" })!;
	assert.match(again, /A RULES v2/);
	assert.match(again, /changed since it was loaded/);
	assert.ok(!again.includes("A SUB RULES"));
});

test("lazy: an added AGENTS.override.md replaces the directory's AGENTS.md", () => {
	const root = makeRepo();
	const h = harness(root);
	h.call("read", { path: "B/b.ts" });
	write(root, "B/AGENTS.override.md", "B OVERRIDE");
	const out = h.call("read", { path: "B/b.ts" })!;
	assert.match(out, /<scoped_context file="B\/AGENTS.override.md"/);
	assert.match(out, /replaces B\/AGENTS.md for this directory; the instructions from B\/AGENTS.md no longer apply/);
	assert.equal(h.call("read", { path: "B/b.ts" }), undefined);
});

test("lazy: a deleted file is withdrawn once; re-adding it loads it again; never-loaded deletions are silent", () => {
	const root = makeRepo();
	const h = harness(root);
	h.call("read", { path: "B/b.ts" });
	rmSync(join(root, "B/AGENTS.md"));
	const out = h.call("read", { path: "B/b.ts" })!;
	assert.match(out, /<scoped_context scope="B\/" removed="B\/AGENTS.md">/);
	assert.match(out, /no longer apply/);
	assert.equal(h.call("read", { path: "B/b.ts" }), undefined, "withdrawal is reported once");
	write(root, "B/AGENTS.md", "B RULES again");
	const readded = h.call("read", { path: "B/b.ts" })!;
	assert.match(readded, /B RULES again/);
	assert.ok(!readded.includes("replaces"));
	rmSync(join(root, "A/x/AGENTS.override.md"));
	rmSync(join(root, "A/x/AGENTS.md"));
	assert.ok(!h.call("read", { path: "A/x/f.ts" })!.includes("removed="), "A/x was never loaded");
});

test("lazy: compaction — entries before the first kept entry no longer count", () => {
	const root = makeRepo();
	const h = harness(root);
	h.call("read", { path: "A/sub/file.ts" });
	h.branch.push({ type: "message", id: "m1" });
	h.branch.push({ type: "compaction", id: "c1", firstKeptEntryId: "m1" });
	assert.match(h.call("read", { path: "A/sub/file.ts" })!, /A RULES/);
	const reinjected = h.branch.filter((e) => e.customType === ENTRY_TYPE).at(-1);
	h.branch.push({ type: "message", id: "m2" });
	h.branch.push({ type: "compaction", id: "c2", firstKeptEntryId: reinjected.id });
	assert.equal(h.call("read", { path: "A/sub/file.ts" }), undefined);
	h.branch.push({ type: "compaction", id: "c3", firstKeptEntryId: "c3" });
	assert.match(h.call("read", { path: "A/sub/file.ts" })!, /A RULES/, "nothing kept: everything reloads");
});

test("lazy: full read of the context file records it without a copy; partial read appends", () => {
	const root = makeRepo();
	const h = harness(root);
	assert.equal(h.call("read", { path: "A/AGENTS.md" }, { content: [{ type: "text", text: "A RULES" }] }), undefined);
	assert.equal(loadedOnBranch(h.branch).get("A/")?.path, "A/AGENTS.md");
	const h2 = harness(root);
	assert.match(h2.call("read", { path: "A/sub/CLAUDE.md", limit: 1 }, { content: [{ type: "text", text: "A SUB" }] })!, /A SUB RULES/);
});

test("lazy: nested codemode calls go to the codemode result, not the script", () => {
	const root = makeRepo();
	const h = harness(root);
	assert.equal(h.call("read", { path: "A/sub/file.ts" }, { toolCallId: "cm/1", parentToolCallId: "cm" }), undefined);
	assert.equal(h.call("read", { path: "B/b.ts" }, { toolCallId: "cm/2", parentToolCallId: "cm" }), undefined);
	assert.equal(h.branch.length, 0);
	const out = h.call("codemode", { code: "..." }, { toolCallId: "cm", content: [{ type: "text", text: "Script completed" }] })!;
	assert.match(out, /A RULES/);
	assert.match(out, /A SUB RULES/);
	assert.match(out, /B RULES/);
	assert.equal(h.call("codemode", { code: "..." }, { toolCallId: "cm2" }), undefined);
});

test("lazy: structuredContent is preserved", () => {
	const root = makeRepo();
	const h = harness(root);
	const handlers: Record<string, any> = {};
	scopedContext({ on: (n: string, f: any) => (handlers[n] = f), appendEntry() {}, registerCommand() {} } as any);
	handlers.resources_discover({ cwd: root }, h.ctx);
	const out = handlers.tool_result({ toolCallId: "x", toolName: "grep", input: { path: "A", pattern: "x" }, content: [], isError: false, structuredContent: { a: 1 } }, h.ctx);
	assert.deepEqual(out.structuredContent, { a: 1 });
});

// ---------------------------------------------------------------- eager mode

test("eager: every file goes into contextFiles with its scope, stable across turns; tool results untouched", () => {
	const root = makeRepo();
	const h = harness(root, { config: { mode: "eager" } });
	const rootEntry = { path: join(root, "AGENTS.md"), content: "ROOT RULES" };
	const files = h.systemPrompt([rootEntry]);
	assert.deepEqual(files.map((f) => f.path), [rootEntry.path, ...["A/AGENTS.md", "B/AGENTS.md", "A/sub/CLAUDE.md", "A/x/AGENTS.override.md"].map((p) => join(root, p))]);
	assert.match(files[1].content, /^\(Applies only to files under A\/; takes precedence over outer instructions for those files\.\)\n\nA RULES$/);
	assert.deepEqual(h.systemPrompt([rootEntry]), files, "same entries every turn");
	assert.equal(h.call("read", { path: "A/sub/file.ts" }), undefined);
	assert.equal(h.branch.length, 0);
});

test("eager: project config switches mode only when trusted; large totals warn", () => {
	const root = makeRepo();
	assert.equal(harness(root, { projectConfig: { mode: "eager" }, trusted: false }).systemPrompt().length, 0);
	assert.equal(harness(root, { projectConfig: { mode: "eager" }, trusted: true }).systemPrompt().length, 4);
	write(root, "A/AGENTS.md", "x".repeat(50_000));
	assert.match(harness(root, { projectConfig: { mode: "eager" }, trusted: true }).notices.join("\n"), /tokens to every request/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createCodemodeExtension, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { QuestionnaireResult } from "../extensions/ask-user-question/state.ts";
import { questions } from "./ask-user-question-fixtures.ts";
import { tuiHarness } from "./ask-user-question-tui-helpers.ts";
import { createSandbox, createTestSession, extensionPath, REPO_DIR } from "./helpers.ts";

const EXT = extensionPath("ask-user-question/index");
const params = { questions: [questions.questions[0]] };
const call = { name: "ask_user_question", args: params };

function resultDetails(session: Awaited<ReturnType<typeof createTestSession>>) {
	const message = session.session.messages.findLast((message) => message.role === "toolResult" && message.toolName === "ask_user_question");
	assert.ok(message?.role === "toolResult");
	return message.details as unknown as QuestionnaireResult;
}

test("real RPC session: loads the package directory, exposes guidance, uses editable dialogs, persists submitted details", async () => {
	const sandbox = createSandbox();
	// Directory discovery must find index.ts, not register helper modules as extensions.
	const t = await createTestSession(sandbox, { extensions: [REPO_DIR] });
	let calls = 0;
	let customAttempts = 0;
	const ui = {
		select: async (title: string, options: string[]) => {
			calls++;
			if (title.startsWith("Question")) return options.find((option) => option.includes(calls === 3 ? "Python" : "TypeScript"));
			return calls === 2 ? options.find((option) => option.startsWith("Edit 1. Language")) : "Submit answers";
		},
		editor: async () => undefined,
		custom: async () => { customAttempts++; throw new Error("RPC uses native dialogs, even with custom support"); },
	} as unknown as ExtensionUIContext;
	await t.session.bindExtensions({ uiContext: ui, mode: "rpc" });
	await t.turnWithTools([call]);
	assert.equal(calls, 4);
	assert.equal(customAttempts, 0);
	assert.equal(resultDetails(t).status, "submitted");
	assert.equal(resultDetails(t).answers[0].answer, "Python");
	assert.match(t.toolResults("ask_user_question")[0], /Python/);
	assert.match(t.systemMessages().join("\n"), /Group related questions in one call/);
	assert.equal(t.session.getAllTools().filter((tool) => tool.name === "ask_user_question").length, 1);
	t.dispose();
});

test("real TUI session: runs the real component, hide/show retains answers, and input/status hooks are cleaned up", async () => {
	const sandbox = createSandbox();
	const t = await createTestSession(sandbox, { extensions: [EXT] });
	const { tui, theme, keys } = tuiHarness();
	let raw: ((data: string) => { consume?: boolean } | undefined) | undefined;
	let removed = 0;
	const statuses: (string | undefined)[] = [];
	let hidden = false;
	const handle = { setHidden(value: boolean) { hidden = value; }, isHidden() { return hidden; } } as OverlayHandle;
	const ui = {
		onTerminalInput(handler: typeof raw) { raw = handler; return () => { removed++; raw = undefined; }; },
		setStatus(_key: string, text: string | undefined) { statuses.push(text); },
		async custom<T>(factory: (tui: TUI, theme: Theme, keys: KeybindingsManager, done: (value: T) => void) => Component | Promise<Component>, options?: Parameters<ExtensionUIContext["custom"]>[1]): Promise<T> {
			let done!: (value: T) => void;
			const pending = new Promise<T>((resolve) => { done = resolve; });
			const component = await factory(tui, theme, keys, done);
			options?.onHandle?.(handle);
			assert.ok(component.render(120).length);
			assert.deepEqual(raw?.("\x1d"), { consume: true });
			assert.equal(hidden, true);
			assert.deepEqual(raw?.("\x1d"), { consume: true });
			assert.equal(hidden, false);
			component.handleInput?.("\r"); // select an option, then review
			component.handleInput?.("\r"); // submit
			const value = await pending;
			(component as Component & { dispose(): void }).dispose();
			return value;
		},
	} as unknown as ExtensionUIContext;
	await t.session.bindExtensions({ uiContext: ui, mode: "tui" });
	await t.turnWithTools([call]);
	assert.equal(resultDetails(t).status, "submitted");
	assert.equal(resultDetails(t).answers[0].answer, "TypeScript");
	assert.equal(removed, 1);
	assert.equal(statuses.at(-1), undefined);
	assert.ok(statuses.some((status) => status?.includes("Questions hidden")));
	t.dispose();
});

test("real session: cancel, UI failure, missing dialogs, and no UI are distinct and never expose drafts", async () => {
	for (const scenario of ["cancel", "failure", "missing", "no-ui"] as const) {
		const sandbox = createSandbox();
		const t = await createTestSession(sandbox, { extensions: [EXT] });
		if (scenario !== "no-ui") {
			const ui = scenario === "missing" ? {} : { editor: async () => undefined, select: async () => {
				if (scenario === "failure") throw new Error("dialog unavailable");
				return undefined;
			} };
			await t.session.bindExtensions({ uiContext: ui as unknown as ExtensionUIContext, mode: "rpc" });
		} else await t.session.bindExtensions({ mode: "print" });
		await t.turnWithTools([call]);
		const details = resultDetails(t);
		assert.equal(details.status, scenario === "cancel" ? "cancelled" : "unavailable");
		assert.deepEqual(details.answers, []);
		assert.match(t.toolResults("ask_user_question")[0], scenario === "cancel" ? /User cancelled/ : /did not decline/);
		t.dispose();
	}
});

test("real session: invalid tool arguments fail before showing UI", async () => {
	const sandbox = createSandbox();
	const t = await createTestSession(sandbox, { extensions: [EXT] });
	let opened = false;
	await t.session.bindExtensions({ uiContext: {
		select: async () => { opened = true; return undefined; }, editor: async () => undefined,
	} as unknown as ExtensionUIContext, mode: "rpc" });
	const invalid = structuredClone(params);
	invalid.questions[0].options[0].label = "Other";
	await t.turnWithTools([{ name: "ask_user_question", args: invalid }]);
	assert.equal(opened, false);
	assert.match(t.toolResults("ask_user_question")[0], /Do not author/);
	const message = t.session.messages.findLast((m) => m.role === "toolResult");
	assert.ok(message?.role === "toolResult" && message.isError);
	t.dispose();
});

test("real codemode session: questionnaire stays declared to the model, not callable from a script", async () => {
	const sandbox = createSandbox();
	const t = await createTestSession(sandbox, { extensions: [EXT], extensionFactories: [createCodemodeExtension()], settings: { defaultTools: ["+codemode"] } });
	const tool = t.session.getAllTools().find((tool) => tool.name === "ask_user_question");
	assert.equal(tool?.exposure, "model-only");
	await t.turnWithTools([{ name: "codemode", args: { code: 'text("ask_user_question" in tools);' } }]);
	assert.match(t.toolResults("codemode")[0], /false/);
	assert.match(t.systemMessages().join("\n"), /ask_user_question/);
	t.dispose();
});

test("real session: unsupported custom UI falls back to native review, not a user decline", async () => {
	const t = await createTestSession(createSandbox(), { extensions: [EXT] });
	let removed = false;
	await t.session.bindExtensions({ mode: "tui", uiContext: {
		onTerminalInput: () => () => { removed = true; },
		setStatus: () => {},
		custom: async () => undefined,
		editor: async () => undefined,
		select: async (title: string, options: string[]) => title.startsWith("Question") ? options[0] : "Submit answers",
	} as unknown as ExtensionUIContext });
	await t.turnWithTools([call]);
	assert.equal(resultDetails(t).status, "submitted");
	assert.equal(removed, true);
	t.dispose();
});

test("real session: sibling questionnaire calls never open overlapping dialogs", async () => {
	const t = await createTestSession(createSandbox(), { extensions: [EXT] });
	let open = 0;
	let overlap = false;
	await t.session.bindExtensions({ mode: "rpc", uiContext: {
		editor: async () => undefined,
		select: async (title: string, options: string[]) => {
			if (++open > 1) overlap = true;
			await new Promise(setImmediate);
			open--;
			return title.startsWith("Question") ? options[0] : "Submit answers";
		},
	} as unknown as ExtensionUIContext });
	await t.turnWithTools([call, call]);
	assert.equal(overlap, false);
	assert.equal(t.toolResults("ask_user_question").length, 2);
	assert.ok(t.toolResults("ask_user_question").every((result) => result.includes("User has answered")));
	t.dispose();
});

test("real reload: changed questionnaire helpers are loaded again without restarting", async () => {
	const sandbox = createSandbox();
	const files = ["index.ts", "state.ts", "dialogs.ts", "tui.ts"];
	for (const file of files) {
		let source = readFileSync(join(REPO_DIR, "extensions/ask-user-question", file), "utf8");
		if (file === "dialogs.ts") source = source.replace('label: "Continue"', 'label: "Continue before reload"');
		sandbox.write(`fixture/questionnaire/${file}`, source);
	}
	const entry = join(sandbox.root, "fixture/questionnaire/index.ts");
	const t = await createTestSession(sandbox, { extensions: [entry] });
	const labels: string[] = [];
	const ui = {
		editor: async () => undefined,
		select: async (title: string, options: string[]) => {
			if (!title.startsWith("Question")) return "Submit answers";
			const continueOption = options.find((option) => option.startsWith("Continue"));
			assert.ok(continueOption);
			labels.push(continueOption);
			return continueOption;
		},
	} as unknown as ExtensionUIContext;
	await t.session.bindExtensions({ uiContext: ui, mode: "rpc" });
	const multiCall = { name: "ask_user_question", args: { questions: [questions.questions[1]] } };
	await t.turnWithTools([multiCall]);
	sandbox.write("fixture/questionnaire/dialogs.ts", readFileSync(join(REPO_DIR, "extensions/ask-user-question/dialogs.ts"), "utf8"));
	await t.session.reload();
	await t.session.bindExtensions({ uiContext: ui, mode: "rpc" });
	await t.turnWithTools([multiCall]);
	assert.deepEqual(labels, ["Continue before reload", "Continue"]);
	t.dispose();
});

test("setup no longer installs the old same-name questionnaire package", () => {
	const settings = JSON.parse(readFileSync(join(REPO_DIR, "setup/settings.json"), "utf8"));
	assert.ok(!settings.packages.includes("npm:@juicesharp/rpiv-ask-user-question"));
});

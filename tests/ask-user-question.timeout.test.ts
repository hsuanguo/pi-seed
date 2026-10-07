import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { loadQuestionnaireConfig, MAX_TIMEOUT_SECONDS } from "../extensions/ask-user-question/config.ts";
import { ResponseTimeout } from "../extensions/ask-user-question/response-timeout.ts";
import { QuestionnaireState, toolResponse } from "../extensions/ask-user-question/state.ts";
import { QuestionnaireComponent } from "../extensions/ask-user-question/tui.ts";
import { loadConfig as loadContextConfig } from "../extensions/scoped-context.ts";
import { questions } from "./ask-user-question-fixtures.ts";
import { tuiHarness } from "./ask-user-question-tui-helpers.ts";
import { createSandbox, createTestSession, extensionPath } from "./helpers.ts";

const configText = (timeoutSeconds: unknown) => JSON.stringify({ askUserQuestion: { timeoutSeconds } });

test("config: default disabled, user values, trusted project overrides, and explicit zero", () => {
	const s = createSandbox();
	assert.equal(loadQuestionnaireConfig(s.workspace, false, s.agentDir).config.timeoutSeconds, 0);
	s.write("agent/pi-seed-config.json", configText(120));
	s.write("workspace/.pi/pi-seed-config.json", configText(30));
	assert.equal(loadQuestionnaireConfig(s.workspace, false, s.agentDir).config.timeoutSeconds, 120);
	assert.equal(loadQuestionnaireConfig(s.workspace, true, s.agentDir).config.timeoutSeconds, 30);
	s.write("workspace/.pi/pi-seed-config.json", configText(0));
	assert.equal(loadQuestionnaireConfig(s.workspace, true, s.agentDir).config.timeoutSeconds, 0);
	s.write("workspace/.pi/pi-seed-config.json", "{invalid project");
	assert.equal(loadQuestionnaireConfig(s.workspace, false, s.agentDir).warnings.length, 0, "untrusted configuration must not be read");
	assert.equal(loadQuestionnaireConfig(s.workspace, true, s.agentDir).config.timeoutSeconds, 120);
});

test("config: invalid overrides retain earlier values and unrelated sections coexist", () => {
	const s = createSandbox();
	s.write("agent/pi-seed-config.json", configText(15));
	for (const value of [-1, 0.5, MAX_TIMEOUT_SECONDS + 1, "30", true, null]) {
		s.write("workspace/.pi/pi-seed-config.json", configText(value));
		const loaded = loadQuestionnaireConfig(s.workspace, true, s.agentDir);
		assert.equal(loaded.config.timeoutSeconds, 15); assert.equal(loaded.warnings.length, 1);
	}
	s.write("agent/pi-seed-config.json", JSON.stringify({ claudeSkills: { mode: "ancestors" }, scopedContext: { mode: "lazy" }, askUserQuestion: { timeoutSeconds: 10, extra: true } }));
	assert.equal(loadQuestionnaireConfig(s.workspace, false, s.agentDir).warnings.length, 1);
	assert.equal(loadContextConfig(s.workspace, false, s.agentDir).warnings.length, 0);
	for (const raw of ["{private-content", "[]", JSON.stringify({ askUserQuestion: false })]) {
		s.write("agent/pi-seed-config.json", raw);
		const loaded = loadQuestionnaireConfig(s.workspace, false, s.agentDir);
		assert.equal(loaded.config.timeoutSeconds, 0); assert.ok(loaded.warnings.length);
		assert.ok(!loaded.warnings.join().includes("private-content"));
	}
});

test("response clock: expires only without any response; a response turns it off permanently", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
	const unattended = new ResponseTimeout(1000); unattended.start();
	t.mock.timers.tick(999); assert.equal(unattended.expired, false);
	t.mock.timers.tick(1); assert.equal(unattended.expired, true); assert.equal(unattended.signal.reason.name, "TimeoutError");
	unattended.markResponded(); assert.equal(unattended.expired, true, "a late response cannot undo expiry");
	const present = new ResponseTimeout(1000); present.start();
	t.mock.timers.tick(900); present.markResponded();
	t.mock.timers.tick(100000); assert.equal(present.expired, false); assert.equal(present.enabled, false); assert.equal(present.remainingMs, undefined);
	present.start(); t.mock.timers.tick(100000); assert.equal(present.expired, false, "cannot be rearmed after a response");
	const off = new ResponseTimeout(0); off.start(); t.mock.timers.tick(100000); assert.equal(off.expired, false);
	const disposed = new ResponseTimeout(1000); disposed.start(); disposed.dispose(); t.mock.timers.tick(10000); assert.equal(disposed.expired, false);
});

function terminal(timeout: ResponseTimeout) {
	createSandbox();
	const { tui, theme, keys } = tuiHarness();
	const state = new QuestionnaireState(questions);
	let result: ReturnType<QuestionnaireState["result"]> | undefined;
	const component = new QuestionnaireComponent(tui, theme, keys, state, (value) => { result = value; }, timeout.signal, timeout);
	component.focused = true;
	return { component, get result() { return result; } };
}

test("TUI: without input it times out; any key stops the timer for good; no Turn off timeout row", (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"] });
	const idle = new ResponseTimeout(10000); idle.start();
	const quiet = terminal(idle);
	assert.ok(!quiet.component.render(120).join().includes("Turn off timeout"));
	assert.match(quiet.component.render(120).join(), /continuing without answers in 10s/);
	t.mock.timers.tick(10000); assert.equal(quiet.result?.status, "timed_out"); assert.deepEqual(quiet.result.answers, []);
	quiet.component.dispose(); idle.dispose();
	const present = new ResponseTimeout(10000); present.start();
	const active = terminal(present);
	t.mock.timers.tick(9000); active.component.handleInput("\x1b[B");
	t.mock.timers.tick(100000); assert.equal(Boolean(active.result), false);
	assert.ok(!active.component.render(120).join().includes("continuing without answers"));
	active.component.handleInput("\x03"); assert.equal(active.result?.status, "cancelled");
	active.component.dispose(); present.dispose();
});

async function sessionWithTimeout(seconds: number, ui: object, args = questions) {
	const s = createSandbox(); s.write("agent/pi-seed-config.json", configText(seconds));
	const t = await createTestSession(s, { extensions: [extensionPath("ask-user-question/index")] });
	// SAFETY: each mock implements the RPC dialogs actually used in its scenario; tests deliberately omit unrelated UI methods.
	await t.session.bindExtensions({ uiContext: ui as unknown as ExtensionUIContext, mode: "rpc" });
	await t.turnWithTools([{ name: "ask_user_question", args }]);
	return { s, t, text: t.toolResults("ask_user_question")[0] };
}

test("real RPC/faux Agent: no response returns timed_out and the Agent's next response proceeds", async () => {
	let closed = false;
	const { t, text } = await sessionWithTimeout(1, { editor: async () => undefined,
		select: async (_title: string, options: string[], opts: { signal: AbortSignal; timeout: number }) => {
			assert.ok(!options.includes("Turn off timeout")); assert.ok(opts.timeout > 0 && opts.timeout <= 1000);
			return new Promise<string | undefined>((resolve) => opts.signal.addEventListener("abort", () => { closed = true; resolve(undefined); }, { once: true }));
		},
	});
	assert.equal(closed, true); assert.match(text, /response timeout/); assert.match(text, /already-authorized, low-risk/); assert.match(text, /do not perform the gated action/);
	assert.ok(t.session.messages.some((m) => m.role === "assistant" && m.content.some((c) => c.type === "text" && c.text === "done")), "normal Agent loop must run its next response");
	const result = t.session.messages.findLast((m) => m.role === "toolResult");
	assert.ok(result?.role === "toolResult" && JSON.stringify(result.details).includes('"status":"timed_out"'));
	t.dispose();
});

test("real RPC: after the first selection no later dialog has a timeout, however slow", async () => {
	let calls = 0;
	const { t, text } = await sessionWithTimeout(1, { editor: async () => undefined,
		select: async (title: string, options: string[], opts: { timeout?: number }) => {
			calls++;
			if (calls === 1) { assert.ok(opts.timeout); return options.find((o) => o.includes("1. TypeScript")); }
			assert.equal(opts.timeout, undefined);
			await new Promise((resolve) => setTimeout(resolve, 1200));
			if (title.startsWith("Review")) return "Submit answers";
			return calls === 2 ? options.find((o) => o.includes("1. Unit tests")) : "Continue";
		},
	});
	assert.equal(calls, 4); assert.match(text, /User has answered/); t.dispose();
});

test("real RPC: opening an editor first also stops the timer, even if editing takes long", async () => {
	let calls = 0;
	const { t, text } = await sessionWithTimeout(1, {
		select: async (_title: string, _options: string[], opts: { timeout?: number }) => {
			if (++calls === 1) { assert.ok(opts.timeout); return "Type something."; }
			assert.equal(opts.timeout, undefined); return "Submit answers";
		},
		editor: async () => { await new Promise((resolve) => setTimeout(resolve, 1300)); return "custom answer"; },
	}, { questions: [questions.questions[0]] });
	assert.match(text, /custom answer/); t.dispose();
});

test("real RPC: manual Cancel remains cancelled, not timed_out", async () => {
	const { t, text } = await sessionWithTimeout(1, { editor: async () => undefined, select: async () => undefined });
	assert.match(text, /User cancelled/); assert.ok(!text.includes("response timeout")); t.dispose();
});

test("timed_out does not submit or expose stored draft answers or notes", () => {
	const state = new QuestionnaireState(questions); state.choose(0, 0); state.drafts[0].notes = "secret draft"; state.globalNote = "secret global";
	const result = state.result("timed_out"); const response = toolResponse(result);
	assert.deepEqual(result.answers, []); assert.ok(!("globalNote" in result)); assert.ok(!JSON.stringify(response).includes("secret"));
	assert.match(response.content[0].text, /silence as consent/);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { runDialogs } from "../extensions/ask-user-question/dialogs.ts";
import { QuestionnaireState } from "../extensions/ask-user-question/state.ts";
import { questions } from "./ask-user-question-fixtures.ts";
import { createSandbox, createTestSession, extensionPath } from "./helpers.ts";

test("native dialogs: Continue then Back follow choices and retain all answers", async () => {
	const state = new QuestionnaireState(questions);
	const steps = [
		/1\. TypeScript/, /1\. Unit tests/, "Back", /2\. Python/,
		/2\. Integration tests/, "Continue", "Back", "Back",
		"Continue", /^Edit 2\. Checks/, "Continue", "Submit answers",
	];
	const result = await runDialogs({
		async select(title, options) {
			if (title.startsWith("Question 1/")) assert.ok(!options.includes("Back"));
			if (title.startsWith("Question 2/")) assert.deepEqual(options.slice(-2), ["Continue", "Back"]);
			if (title.startsWith("Review")) assert.equal(options.at(-1), "Back");
			const step = steps.shift();
			assert.ok(step, `Unexpected screen ${title}`);
			const chosen = options.find((option) => typeof step === "string" ? option === step : step.test(option));
			assert.ok(chosen, `Missing ${step} in ${JSON.stringify(options)}`);
			return chosen;
		},
		editor: async () => undefined,
	}, state);
	assert.equal(result.status, "submitted");
	assert.equal(result.answers[0].answer, "Python");
	assert.deepEqual(result.answers[1].selected, ["Unit tests", "Integration tests"]);
	assert.equal(steps.length, 0);
});

test("real RPC session: keeps native dialog buttons even when the host offers custom UI", async () => {
	const t = await createTestSession(createSandbox(), { extensions: [extensionPath("ask-user-question/index")] });
	let customCalled = false;
	const ui = {
		custom: async () => { customCalled = true; throw new Error("do not replace native Web dialogs"); },
		editor: async () => undefined,
		select: async (title: string, options: string[]) => title.startsWith("Question") ? options.find((o) => o.includes("1. TypeScript")) : "Submit answers",
	};
	// SAFETY: this RPC-only test implements all questionnaire dialog methods and asserts custom is not called.
	await t.session.bindExtensions({ uiContext: ui as unknown as ExtensionUIContext, mode: "rpc" });
	await t.turnWithTools([{ name: "ask_user_question", args: { questions: [questions.questions[0]] } }]);
	assert.equal(customCalled, false);
	assert.match(t.toolResults("ask_user_question")[0], /TypeScript/);
	t.dispose();
});

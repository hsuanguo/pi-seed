import assert from "node:assert/strict";
import { test } from "node:test";
import { runDialogs, type DialogUI } from "../extensions/ask-user-question/dialogs.ts";
import { QuestionnaireState, normalizeQuestions, toolResponse, type Params } from "../extensions/ask-user-question/state.ts";

import { questions } from "./ask-user-question-fixtures.ts";

interface Step { choice?: string | RegExp; title?: RegExp; options?: RegExp[] }
function scripted(steps: Step[], edits: { value?: string; prefill?: string }[] = []): DialogUI {
	return {
		async select(title, options) {
			assert.ok(steps.length, `Unexpected selector: ${title}`);
			const step = steps.shift()!;
			if (step.title) assert.match(title, step.title);
			for (const pattern of step.options ?? []) assert.ok(options.some((option) => pattern.test(option)), `Missing ${pattern}`);
			if (step.choice === undefined) return undefined;
			const choice = options.find((option) => typeof step.choice === "string" ? option === step.choice : step.choice!.test(option));
			assert.ok(choice, `Missing choice ${step.choice} in ${JSON.stringify(options)}`);
			return choice;
		},
		async editor(_title, prefill) {
			assert.ok(edits.length, "Unexpected editor");
			const edit = edits.shift()!;
			if (edit.prefill !== undefined) assert.equal(prefill, edit.prefill);
			return edit.value;
		},
	};
}
const choose = (choice: string | RegExp, title?: RegExp, options?: RegExp[]): Step => ({ choice, title, options });
const singleParams = (): Params => ({ questions: [structuredClone(questions.questions[0])] });

// These are regressions for the sequential, no-back/no-review RPC fallback.
test("dialogs: previous question and review edits retain later multi-selection", async () => {
	const steps = [
		choose(/1\. TypeScript/), choose("Back", /Question 2\/2/),
		choose(/2\. Python/, /Question 1\/2/, [/\[x\] 1\. TypeScript/]),
		choose(/1\. Unit tests/), choose(/2\. Integration tests/),
		choose("Continue"),
		choose(/^Edit 1\. Language — Python/, /Review answers/, [/Checks — Unit tests \+1/]),
		choose(/1\. TypeScript/, /Question 1\/2/, [/\[x\] 2\. Python/]),
		choose("Submit answers", /Review answers/),
	];
	const result = await runDialogs(scripted(steps), new QuestionnaireState(questions));
	assert.equal(steps.length, 0);
	assert.equal(result.status, "submitted");
	assert.equal(result.answers[0].answer, "TypeScript");
	assert.equal(result.answers[0].preview, questions.questions[0].options[0].preview);
	assert.deepEqual(result.answers[1].selected, ["Unit tests", "Integration tests"]);
});

test("dialogs: do not finish before explicit Submit, even for one question", async () => {
	let submit!: (value: string) => void;
	let finished = false;
	const ui: DialogUI = {
		select: async (title, options) => {
			if (title.startsWith("Question")) return options[0];
			assert.match(title, /Review answers/);
			return new Promise((resolve) => { submit = resolve; });
		},
		editor: async () => undefined,
	};
	const pending = runDialogs(ui, new QuestionnaireState(singleParams())).then((result) => { finished = true; return result; });
	await new Promise(setImmediate);
	assert.equal(finished, false);
	submit("Submit answers");
	assert.equal((await pending).status, "submitted");
});

test("dialogs: review never offers Submit with unanswered questions; explicit empty multi is valid", async () => {
	const steps = [choose("More actions"), choose("Review answers"), choose(/^Edit 1\. Language/), choose(/1\. TypeScript/),
		choose(/^Edit 2\. Checks/), choose("Continue"), choose("Submit answers")];
	const base = scripted(steps);
	const ui: DialogUI = { ...base, select: async (title, options, opts) => {
		if (title.startsWith("Review") && options.some((option) => option.includes("Not answered"))) assert.ok(!options.includes("Submit answers"));
		return base.select(title, options, opts);
	} };
	const result = await runDialogs(ui, new QuestionnaireState(questions));
	assert.deepEqual(result.answers[1].selected, []);
});

test("dialogs: custom text is prefilled when re-editing; notes and preview reach the result", async () => {
	const params = singleParams();
	params.questions[0].options[0].preview = "preview\n".repeat(200);
	const steps = [choose("More actions"), choose("Details & previews"), choose("Back to question", /large preview|preview/),
		choose("More actions"), choose("Edit question note"), choose("Type something."), choose("Add global note"),
		choose(/^Edit 1\. Language — custom v1/), choose(/^Type something\./),
		choose(/^Edit 1\. Language — custom v2/), choose(/1\. TypeScript/), choose("Submit answers")];
	const edits = [{ value: "question note\nsecond line", prefill: "" }, { value: "custom v1", prefill: "" },
		{ value: "global note", prefill: "" }, { value: "custom v2", prefill: "custom v1" }];
	const base = scripted(steps, edits);
	const result = await runDialogs({ ...base, select: (title, options, opts) => {
		if (title.startsWith("Question details")) assert.ok(title.includes(params.questions[0].options[0].preview!));
		else if (title.startsWith("Question")) assert.ok(!title.includes(params.questions[0].options[0].preview!));
		return base.select(title, options, opts);
	} }, new QuestionnaireState(params));
	assert.equal(result.globalNote, "global note");
	assert.equal(result.answers[0].notes, "question note\nsecond line");
	assert.equal(result.answers[0].preview, params.questions[0].options[0].preview);
	assert.ok(!JSON.stringify(result).includes("custom v2"));
});

test("dialogs: dismissing or clearing a custom editor does not erase the committed answer", async () => {
	const steps = [choose("Type something."), choose(/^Edit 1\. Language/), choose(/^Type something\./),
		choose(/^Type something\./), choose("Continue", /Question 1\/1/, [/Type something\. — original/]), choose("Submit answers")];
	const result = await runDialogs(scripted(steps, [{ value: "original" }, { value: undefined, prefill: "original" }, { value: "  " }]), new QuestionnaireState(singleParams()));
	assert.equal(result.answers[0].answer, "original");
});

test("dialogs: multi-select toggles are reversible and do not require typed numbers", async () => {
	const params: Params = { questions: [questions.questions[1]] };
	const steps = [choose(/\[ \] 1\. Unit/), choose(/\[x\] 1\. Unit/), choose(/\[ \] 2\. Integration/), choose("Continue"), choose("Submit answers")];
	const result = await runDialogs(scripted(steps), new QuestionnaireState(params));
	assert.deepEqual(result.answers[0].selected, ["Integration tests"]);
});

test("dialogs: main question and review dismissal discard all drafts", async () => {
	for (const review of [false, true]) {
		const state = new QuestionnaireState(questions);
		state.globalNote = "secret draft";
		const steps = [choose(/1\. TypeScript/), ...(review ? [choose("Continue")] : []), {}];
		const result = await runDialogs(scripted(steps), state);
		assert.equal(result.status, "cancelled");
		assert.deepEqual(result.answers, []);
		assert.ok(!JSON.stringify(toolResponse(result)).includes("secret draft"));
	}
});

test("dialogs: abort before opening UI or while select/editor is pending does not wait or commit", async () => {
	for (const place of ["before", "select", "editor"]) {
		const state = new QuestionnaireState(singleParams());
		const controller = new AbortController();
		let lateEditor!: (value: string) => void;
		let opened = false;
		const ui: DialogUI = {
			select: async (_title, options, opts) => {
				assert.equal(opts?.signal, controller.signal);
				opened = true;
				if (place === "editor") return options.find((o) => o === "Type something.");
				controller.abort();
				return new Promise(() => {});
			},
			editor: async () => {
				controller.abort();
				return new Promise((resolve) => { lateEditor = resolve; });
			},
		};
		if (place === "before") controller.abort();
		const result = await runDialogs(ui, state, controller.signal);
		assert.equal(result.status, "aborted");
		assert.deepEqual(result.answers, []);
		assert.equal(opened, place !== "before");
		if (place === "editor") {
			lateEditor("must not commit");
			await new Promise(setImmediate);
			assert.equal(state.complete, false);
		}
	}
});

test("dialogs: an unknown host response is unavailable, not a decline", async () => {
	const result = await runDialogs({ select: async () => "not offered", editor: async () => undefined }, new QuestionnaireState(singleParams()));
	assert.equal(result.status, "unavailable");
	assert.match(toolResponse(result).content[0].text, /did not decline/);
});

test("state: notes alone do not answer a question; custom text and multi-choice drafts survive changing kind", () => {
	const state = new QuestionnaireState(questions);
	state.drafts[0].notes = "not an answer";
	assert.equal(state.complete, false);
	assert.throws(() => state.result("submitted"), /unanswered/);
	state.choose(1, 1);
	state.commitCustom(1, "custom");
	state.choose(1, 0);
	assert.deepEqual(state.answer(1)?.selected, ["Unit tests", "Integration tests"]);
	assert.equal(state.drafts[1].custom, "custom");
	state.commitCustom(0, "typed");
	assert.equal(state.commitCustom(0, ""), false);
	assert.equal(state.answer(0)?.answer, "typed");
	state.choose(0, 0);
	const result = state.result("submitted");
	assert.equal(result.answers[0].notes, "not an answer");
	assert.equal(state.drafts[0].custom, "typed");
	assert.ok(!("globalNote" in result));
});

test("validation: normalizes CRLF and trimmed labels without losing preview formatting", () => {
	const params = singleParams();
	params.questions[0].question = "  Which\r\nlanguage?  ";
	params.questions[0].options[0].label = " TypeScript ";
	params.questions[0].options[0].preview = "a\r\nb\rc";
	const normalized = normalizeQuestions(params);
	assert.equal(normalized.questions[0].question, "Which\nlanguage?");
	assert.equal(normalized.questions[0].options[0].label, "TypeScript");
	assert.equal(normalized.questions[0].options[0].preview, "a\nb\nc");
	assert.equal(params.questions[0].options[0].label, " TypeScript ", "input is not mutated");
});

test("validation: rejects empty text, duplicate questions/options, reserved labels, and excess items", () => {
	const mutations: ((params: Params) => void)[] = [
		(p) => { p.questions = []; },
		(p) => { p.questions = Array(5).fill(p.questions[0]); },
		(p) => { p.questions.push(structuredClone(p.questions[0])); },
		(p) => { p.questions[0].question = "  "; },
		(p) => { p.questions[0].header = "  "; },
		(p) => { p.questions[0].header = "a".repeat(17); },
		(p) => { p.questions[0].options = []; },
		(p) => { p.questions[0].options = Array(5).fill(p.questions[0].options[0]); },
		(p) => { p.questions[0].options[1].label = "typescript "; },
		(p) => { p.questions[0].options[0].description = "  "; },
		(p) => { p.questions[0].options[0].label = "a".repeat(61); },
		...["Other", "Type something.", "Next"].map((label) => (p: Params) => { p.questions[0].options[0].label = label; }),
	];
	for (const mutate of mutations) {
		const params = singleParams();
		mutate(params);
		assert.throws(() => normalizeQuestions(params));
	}
});

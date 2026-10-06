import assert from "node:assert/strict";
import { test } from "node:test";
import { runDialogs, type DialogUI } from "../extensions/ask-user-question/dialogs.ts";
import { QuestionnaireState } from "../extensions/ask-user-question/state.ts";
import { questions } from "./ask-user-question-fixtures.ts";

test("compact dialogs: review has a short title and inline answer edits, without duplicate navigation", async () => {
	const params = structuredClone(questions);
	params.questions[0].options[0].preview = "large preview\n".repeat(200);
	const state = new QuestionnaireState(params);
	let reviewSeen = false;
	const ui: DialogUI = {
		async select(title, options) {
			assert.ok(!options.includes("Cancel questionnaire"));
			if (title.startsWith("Question")) {
				assert.ok(title.length < 220);
				assert.ok(!title.includes("large preview"));
				if (title.includes("1/2")) return options.find((option) => option.includes("1. TypeScript"));
				assert.deepEqual(options.slice(-2), ["Continue", "Back"], "operations follow the choice list");
				if (!state.drafts[1].kind) return options.find((option) => option.includes("1. Unit tests"));
				return "Continue";
			}
			assert.equal(title, "Review answers");
			assert.ok(options.includes("Back"));
			assert.ok(!options.includes("Previous question"));
			assert.equal(options[0], "Submit answers");
			assert.ok(options.includes("Edit 1. Language — TypeScript"));
			assert.ok(options.includes("Edit 2. Checks — Unit tests"));
			assert.equal(options.length, 5, "submit, Back, two inline edit rows, and a global note");
			reviewSeen = true;
			return "Submit answers";
		},
		editor: async () => undefined,
	};
	const result = await runDialogs(ui, state);
	assert.equal(reviewSeen, true);
	assert.equal(result.status, "submitted");
	assert.equal(result.answers[0].preview, params.questions[0].options[0].preview, "display compaction does not truncate submitted data");
});

test("compact dialogs: Continue stays last on a first question and keeps its name when editing from review", async () => {
	const state = new QuestionnaireState({ questions: [structuredClone(questions.questions[1])] });
	let questionVisits = 0;
	let reviewVisits = 0;
	const result = await runDialogs({
		async select(title, options) {
			if (title.startsWith("Question")) {
				questionVisits++;
				assert.equal(options.at(-1), "Continue");
				assert.ok(!options.includes("Return to review"));
				if (questionVisits === 1) return options.find((option) => option.includes("1. Unit tests"));
				return "Continue";
			}
			return ++reviewVisits === 1 ? options.find((option) => option.startsWith("Edit 1. Checks")) : "Submit answers";
		},
		editor: async () => undefined,
	}, state);
	assert.equal(questionVisits, 3);
	assert.deepEqual(result.answers[0].selected, ["Unit tests"]);
});

test("compact dialogs: dismissing secondary menus, details, or notes returns without losing answers", async () => {
	for (const place of ["menu", "details", "editor"]) {
		const state = new QuestionnaireState({ questions: [structuredClone(questions.questions[0])] });
		state.choose(0, 0);
		state.drafts[0].notes = "keep note";
		const steps: (string | undefined)[] = place === "details"
			? ["More actions", "Details & previews", undefined, "Continue", "Submit answers"]
			: place === "editor" ? ["More actions", "Edit question note", "Continue", "Submit answers"]
				: ["More actions", undefined, "Continue", "Submit answers"];
		const result = await runDialogs({
			async select(_title, options) {
				assert.ok(steps.length);
				const choice = steps.shift();
				if (choice !== undefined) assert.ok(options.includes(choice));
				return choice;
			},
			async editor(_title, prefill) { assert.equal(prefill, "keep note"); return undefined; },
		}, state);
		assert.equal(result.status, "submitted");
		assert.equal(result.answers[0].answer, "TypeScript");
		assert.equal(result.answers[0].notes, "keep note");
		assert.equal(steps.length, 0);
	}
});

test("compact dialogs: long Unicode text stays readable on demand and unmodified in submitted data", async () => {
	const params = { questions: [structuredClone(questions.questions[0])] };
	const q = params.questions[0];
	q.question = "Full question 👩‍💻 ".repeat(60);
	q.options[0].label = "TypeScript\nStrict";
	q.options[0].description = "Full description ".repeat(80);
	q.options[0].preview = "Full preview\n".repeat(100);
	const state = new QuestionnaireState(params);
	const answer = "Custom 👩‍💻\nanswer ".repeat(60);
	const note = "Question note\n".repeat(100);
	const globalNote = "Global note\n".repeat(100);
	state.commitCustom(0, answer);
	state.drafts[0].notes = note;
	const steps = ["More actions", "Details & previews", "Back to question", "Continue",
		"Add global note", "Edit global note", "Submit answers"];
	const result = await runDialogs({
		async select(title, options) {
			if (title.startsWith("Question details")) {
				for (const text of [q.question, q.options[0].description, q.options[0].preview!, answer, note]) assert.ok(title.includes(text));
			} else {
				assert.ok(title.length < 220);
				assert.ok(!title.includes(q.options[0].preview!));
				for (const option of options) {
					assert.ok(!option.includes("\n"));
					assert.ok(Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(option)).length < 130);
				}
				if (title.startsWith("Question")) {
					assert.ok(options.some((option) => option.includes("TypeScript Strict")));
					assert.ok(title.includes("…"));
				}
			}
			const next = steps.shift()!;
			const choice = options.find((option) => option.startsWith(next));
			assert.ok(choice, `Missing ${next}`);
			return choice;
		},
		async editor(_title, prefill) {
			if (prefill) { assert.equal(prefill, globalNote); return undefined; }
			return globalNote;
		},
	}, state);
	assert.equal(result.status, "submitted");
	assert.equal(result.answers[0].question, q.question);
	assert.equal(result.answers[0].answer, answer);
	assert.equal(result.answers[0].notes, note);
	assert.equal(result.globalNote, globalNote);
	assert.equal(steps.length, 0);
});

test("compact dialogs: unknown secondary choices and aborts are not treated as user cancellation", async () => {
	for (const abort of [false, true]) {
		const state = new QuestionnaireState({ questions: [structuredClone(questions.questions[0])] });
		const controller = new AbortController();
		let calls = 0;
		const result = await runDialogs({
			async select() {
				if (++calls === 1) return "More actions";
				if (abort) { controller.abort(); return new Promise(() => {}); }
				return "not offered";
			},
			editor: async () => undefined,
		}, state, controller.signal);
		assert.equal(result.status, abort ? "aborted" : "unavailable");
		assert.deepEqual(result.answers, []);
	}
});

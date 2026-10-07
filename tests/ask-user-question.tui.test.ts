import assert from "node:assert/strict";
import { test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { CURSOR_MARKER, visibleWidth } from "@earendil-works/pi-tui";
import { QuestionnaireState, type QuestionnaireResult } from "../extensions/ask-user-question/state.ts";
import { QuestionnaireComponent } from "../extensions/ask-user-question/tui.ts";
import { questions } from "./ask-user-question-fixtures.ts";
import { tuiHarness } from "./ask-user-question-tui-helpers.ts";
import { createSandbox } from "./helpers.ts";

const UP = "\x1b[A", DOWN = "\x1b[B", ENTER = "\r", ESC = "\x1b", TAB = "\t", BACKTAB = "\x1b[Z";
function component(signal?: AbortSignal, params = structuredClone(questions)) {
	createSandbox();
	const harness = tuiHarness();
	const state = new QuestionnaireState(params);
	let result: QuestionnaireResult | undefined;
	let doneCalls = 0;
	const ui = new QuestionnaireComponent(harness.tui, harness.theme, harness.keys, state, (value) => { result = value; doneCalls++; }, signal);
	ui.focused = true;
	return { ...harness, state, ui, get result() { return result; }, get doneCalls() { return doneCalls; } };
}
const screen = (c: QuestionnaireComponent, width = 120) => c.render(width).map(stripVTControlCharacters).join("\n");
function send(ui: QuestionnaireComponent, ...keys: string[]) { for (const key of keys) ui.handleInput(key); }

test("TUI: switching back and review editing retains all selections until Submit", () => {
	const t = component();
	send(t.ui, ENTER, BACKTAB, DOWN, ENTER, " ", DOWN, " ", TAB);
	assert.equal(Boolean(t.result), false);
	assert.equal(t.state.answer(0)?.answer, "Python");
	assert.deepEqual(t.state.answer(1)?.selected, ["Unit tests", "Integration tests"]);
	assert.match(screen(t.ui), /Review/);
	// Review Edit Language row, change Python back to TypeScript; return to Review.
	send(t.ui, DOWN, ENTER, UP, ENTER, TAB, UP, ENTER);
	assert.equal(t.result?.status, "submitted");
	assert.equal(t.result.answers[0].answer, "TypeScript");
	assert.deepEqual(t.result.answers[1].selected, ["Unit tests", "Integration tests"]);
	t.ui.dispose();
});

test("TUI: Submit is blocked for unanswered questions; explicitly empty multi is accepted", () => {
	const t = component();
	send(t.ui, TAB, TAB, ENTER);
	assert.equal(Boolean(t.result), false);
	assert.match(screen(t.ui), /unanswered/);
	send(t.ui, TAB, ENTER, DOWN, DOWN, DOWN, ENTER, ENTER);
	assert.equal(t.result?.status, "submitted");
	assert.deepEqual(t.result.answers[1].selected, []);
	t.ui.dispose();
});

test("TUI: multiline drafts survive switching and escaping, and notes do not count as answers", () => {
	const t = component();
	send(t.ui, DOWN, DOWN, ENTER, "first", "\x1b[13;2u", "second", TAB, BACKTAB, ENTER);
	assert.match(screen(t.ui), /first[\s\S]*second/);
	assert.ok(t.ui.render(120).some((line) => line.includes(CURSOR_MARKER)), "focused editor propagates its IME cursor");
	send(t.ui, ESC);
	assert.equal(t.state.answer(0), undefined);
	send(t.ui, ENTER, ENTER);
	assert.equal(t.state.answer(0)?.answer, "first\nsecond");
	send(t.ui, "n", "question note", ENTER);
	assert.equal(t.state.answer(1), undefined);
	send(t.ui, DOWN, DOWN, DOWN, ENTER, "n", "global note", ENTER, ENTER);
	assert.equal(t.result?.globalNote, "global note");
	assert.equal(t.result.answers[1].notes, "question note");
	t.ui.dispose();
});

test("TUI: clearing/cancelling an editor preserves a committed answer and the editable text draft", () => {
	const t = component();
	send(t.ui, DOWN, DOWN, ENTER, "old text", ENTER, BACKTAB, ENTER, "\x15", ENTER);
	assert.equal(t.state.answer(0)?.answer, "old text");
	assert.match(screen(t.ui), /Enter an answer/);
	send(t.ui, "new draft", ESC, ENTER);
	assert.match(screen(t.ui), /new draft/);
	assert.equal(t.state.answer(0)?.answer, "old text");
	send(t.ui, ESC, ESC);
	assert.equal(t.result?.status, "cancelled");
	assert.deepEqual(t.result.answers, []);
	t.ui.dispose();
});

test("TUI: Escape and abort settle once, discard drafts, and remove abort listeners on disposal", () => {
	for (const finish of ["cancel", "abort", "dispose"]) {
		const controller = new AbortController();
		const t = component(controller.signal);
		send(t.ui, ENTER);
		if (finish === "cancel") send(t.ui, ESC);
		if (finish === "dispose") t.ui.dispose();
		controller.abort();
		if (finish === "dispose") assert.equal(t.doneCalls, 0);
		else {
			assert.equal(t.doneCalls, 1);
			assert.equal(t.result?.status, finish === "cancel" ? "cancelled" : "aborted");
			assert.deepEqual(t.result?.answers, []);
		}
		t.ui.dispose();
	}
});

test("TUI: long previews can scroll, Unicode/narrow layouts and resizing never overflow", () => {
	const params = structuredClone(questions);
	params.questions[0].question = "选哪个语言？🧪 ".repeat(30);
	params.questions[0].options[0].description = "比较选项与取舍。".repeat(30);
	params.questions[0].options[0].preview = Array.from({ length: 80 }, (_, i) => `preview-line-${i}`).join("\n\n");
	const t = component(undefined, params);
	const before = screen(t.ui);
	send(t.ui, "\x1b[6~");
	const after = screen(t.ui);
	assert.notEqual(after, before, "PageDown scrolls details independently from choices");
	for (const rows of [12, 18, 40]) {
		t.terminal.rows = rows;
		for (const width of [1, 12, 30, 80, 120]) {
			t.ui.invalidate();
			const lines = t.ui.render(width);
			assert.ok(lines.length <= Math.max(8, rows - 4));
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} columns > ${width}`);
		}
	}
	t.ui.dispose();
});

test("TUI: the overlay is fully framed and fills every row to its width, so the transcript cannot show through", () => {
	const t = component();
	for (const width of [40, 80, 120]) {
		for (const view of ["question", "review", "editor"]) {
			if (view === "review") send(t.ui, TAB, TAB);
			if (view === "editor") send(t.ui, "n");
			const lines = t.ui.render(width).map((line) => stripVTControlCharacters(line).replace(CURSOR_MARKER, ""));
			assert.match(lines[0], /^\u256d\u2500 Questions \u2500*\u256e$/, `${view} ${width}`);
			assert.match(lines.at(-1)!, /^\u2570\u2500+\u256f$/);
			for (const line of lines) assert.equal(visibleWidth(line), width, `${view} ${width}: ${JSON.stringify(line)}`);
			for (const line of lines.slice(1, -1)) assert.ok(line.startsWith("\u2502 ") && line.endsWith(" \u2502"), `${view} ${width}: ${JSON.stringify(line)}`);
			if (view === "editor") send(t.ui, ESC);
			if (view === "review") send(t.ui, TAB);
		}
	}
	t.ui.dispose();
});

test("TUI: the focused Continue row stays visible on a short, narrow terminal", () => {
	const t = component();
	t.terminal.rows = 12;
	send(t.ui, TAB);
	t.ui.render(60);
	send(t.ui, DOWN, DOWN, DOWN);
	assert.match(screen(t.ui, 60), /→ Continue/);
	send(t.ui, ENTER);
	assert.match(screen(t.ui, 60), /Review/);
	t.ui.dispose();
});

test("TUI: note edits can be cleared and cancelled without changing the committed note", () => {
	const t = component();
	send(t.ui, "n", "keep note", ENTER, "n", "\x15", "discard", ESC);
	assert.equal(t.state.drafts[0].notes, "keep note");
	send(t.ui, "n", "\x15", ENTER);
	assert.equal(t.state.drafts[0].notes, "");
	t.ui.dispose();
});

/**
 * Structured questions for pi-seed. No configuration or project files are read.
 *
 * TUI: question tabs, single/multi-selection, multiline custom answers, Markdown
 * previews, per-question/global notes, review, and Ctrl+] overlay hide/show.
 * Pi Web / RPC: ordinary select/editor dialogs, with Continue then Back after
 * the choices and editable review. No host or frontend patch.
 * TUI stays terminal-only; the Web UI is intentionally mouse-friendly.
 * A structured TUI cancellation never opens another questionnaire.
 * Only explicit Submit returns answers. Cancel/abort discard unsubmitted drafts.
 * Submitted data lives in tool-result details, so it follows the session branch.
 *
 * Inspired by @juicesharp/rpiv-ask-user-question 2.12.0 (MIT, juicesharp).
 * This is an independent implementation, not a dependency or a full fork.
 * Disable that package before loading this extension: both register ask_user_question.
 */
import { defineTool, type ExtensionAPI, type ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Key, Text, matchesKey, type OverlayHandle } from "@earendil-works/pi-tui";
import { runDialogs } from "./dialogs.ts";
import { QuestionParams, QuestionnaireState, normalizeQuestions, toolResponse, type QuestionnaireResult } from "./state.ts";

async function ask(state: QuestionnaireState, ctx: ExtensionToolContext, signal?: AbortSignal): Promise<QuestionnaireResult> {
	if (signal?.aborted) return state.result("aborted");
	if (!ctx.hasUI) return state.result("unavailable", "No dialog UI in this mode.");
	try {
		if (ctx.mode === "tui") {
			let handle: OverlayHandle | undefined;
			const unsubscribe = ctx.ui.onTerminalInput((data) => {
				if (!handle || !matchesKey(data, Key.ctrl("]"))) return;
				handle.setHidden(!handle.isHidden());
				ctx.ui.setStatus("ask-user-question", handle.isHidden() ? "Questions hidden — Ctrl+] to resume" : undefined);
				return { consume: true };
			});
			try {
				const result = await ctx.ui.custom<QuestionnaireResult>(async (tui, theme, keys, done) => {
					const { QuestionnaireComponent } = await import("./tui.ts");
					return new QuestionnaireComponent(tui, theme, keys, state, done, signal);
				}, {
					overlay: true,
					overlayOptions: { width: "95%", anchor: "center", margin: 1 },
					onHandle: (value) => { handle = value; },
				});
				if (signal?.aborted) return state.result("aborted");
				if (result !== undefined) return result;
			} finally {
				unsubscribe();
				handle = undefined;
				ctx.ui.setStatus("ask-user-question", undefined);
			}
		}
		if (typeof ctx.ui.select !== "function" || typeof ctx.ui.editor !== "function") {
			return state.result("unavailable", "Host does not support select/editor dialogs.");
		}
		return await runDialogs(ctx.ui, state, signal);
	} catch (error) {
		const aborted = signal?.aborted || (error instanceof Error && error.name === "AbortError");
		return aborted ? state.result("aborted") : state.result("unavailable", `UI failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export const questionTool = defineTool<typeof QuestionParams, QuestionnaireResult>({
	name: "ask_user_question",
	label: "Ask User Question",
	description: "Ask 1–4 structured questions when a decision needs user input. Each question has a short header and 2–4 labeled options with descriptions. Use multiSelect for multiple valid choices; optional preview fields show Markdown or code. Type something. is appended automatically. Users can revisit any answer, add notes, and review before explicitly submitting. Cancellation is not an answer. Do not call this tool without a dialog-capable UI.",
	promptSnippet: "Ask the user structured questions instead of guessing requirements.",
	promptGuidelines: [
		"Use ask_user_question when you need user decisions. Group related questions in one call (1–4 questions, 2–4 options each).",
		"Each option needs a concise label and a description of its trade-offs. Put a recommended option first and append (Recommended) to its label.",
		"Use multiSelect when several options can apply. Use optional preview for code, diagrams, or layouts worth comparing.",
		"Keep question text concise. Do not include UI navigation or test instructions in the question; the UI supplies its own controls.",
		"Do not author Other, Type something., or Next options; the UI adds its own controls. Respect cancellation and distinguish UI failures from user refusal.",
	],
	parameters: QuestionParams,
	exposure: "model-only",
	executionMode: "sequential",

	async execute(_toolCallId, params, signal, _onUpdate, ctx) {
		const state = new QuestionnaireState(normalizeQuestions(params));
		return toolResponse(await ask(state, ctx, signal));
	},

	renderCall(params, theme) {
		const questions = params.questions ?? [];
		return new Text(theme.fg("toolTitle", theme.bold("ask_user_question"))
			+ questions.map((q, i) => `\n${i + 1}. [${q.header}] ${q.question}`).join(""), 0, 0);
	},

	renderResult(result, options, theme) {
		const details = result.details;
		if (!details) return new Text(options.isPartial ? "Waiting for answers…" : "No questionnaire result", 0, 0);
		if (details.status !== "submitted") return new Text(theme.fg("warning", `Questionnaire ${details.status}${details.error ? `: ${details.error}` : ""}`), 0, 0);
		const text = details.answers.map((a) => `${a.questionIndex + 1}. ${a.question}\n   ${a.kind === "multi" ? a.selected?.join(", ") || "(none selected)" : a.answer}`
			+ (a.notes ? `\n   Note: ${a.notes}` : "")
			+ (options.expanded && a.preview ? `\n${a.preview}` : "")).join("\n");
		return new Text(theme.fg("success", "Submitted answers") + `\n${text}${details.globalNote ? `\nGlobal note: ${details.globalNote}` : ""}`, 0, 0);
	},
});

export default function (pi: ExtensionAPI) {
	pi.registerTool(questionTool);
}

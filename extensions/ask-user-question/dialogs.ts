import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { QuestionnaireState, type QuestionnaireResult } from "./state.ts";

export type DialogUI = Pick<ExtensionUIContext, "select" | "editor">;
type Action = { label: string; run: () => void | Promise<void> };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Compact display text only. Full questions, answers, notes, and previews remain in state. */
function compact(text: string, limit: number): string {
	const parts = Array.from(segmenter.segment(text.replace(/\s+/g, " ").trim()), (part) => part.segment);
	return parts.length > limit ? `${parts.slice(0, limit - 1).join("")}…` : parts.join("");
}

function answerLabel(state: QuestionnaireState, qi: number): string {
	const answer = state.answer(qi);
	if (answer?.kind === "multi" && answer.selected?.length) {
		const extra = answer.selected.length > 1 ? ` +${answer.selected.length - 1}` : "";
		return compact(answer.selected[0], 48 - extra.length) + extra;
	}
	return compact(state.summary(qi), 48);
}

/** editor has no signal option in pi. Settle on abort even if a host leaves its dialog pending. */
async function waitForDialog<T>(open: () => Promise<T | undefined>, signal?: AbortSignal): Promise<T | undefined> {
	if (signal?.aborted) return undefined;
	return new Promise((resolve, reject) => {
		const finish = (value: T | undefined) => { signal?.removeEventListener("abort", onAbort); resolve(value); };
		const onAbort = () => finish(undefined);
		signal?.addEventListener("abort", onAbort, { once: true });
		Promise.resolve().then(() => signal?.aborted ? undefined : open()).then(finish, (error) => {
			signal?.removeEventListener("abort", onAbort);
			reject(error);
		});
	});
}

/** Native UI has no separate body or button styles. Keep primary screens short and details on demand. */
export async function runDialogs(
	ui: DialogUI,
	state: QuestionnaireState,
	signal?: AbortSignal,
): Promise<QuestionnaireResult> {
	const count = state.params.questions.length;
	let cursor = 0;
	let reviewing = false;
	let dialogError: string | undefined;
	const advance = () => { cursor = reviewing ? count : cursor + 1; };
	const edit = async (title: string, prefill: string, save: (value: string) => void) => {
		const value = await waitForDialog(() => ui.editor(title, prefill), signal);
		// Dismissing a secondary dialog returns to its parent, not cancel the questionnaire.
		if (!signal?.aborted && value !== undefined) save(value);
	};
	const secondaryMenu = async (title: string, actions: Action[]) => {
		const choice = await waitForDialog(() => ui.select(title, actions.map((a) => a.label), { signal }), signal);
		if (signal?.aborted || choice === undefined) return;
		const action = actions.find((a) => a.label === choice);
		if (!action) { dialogError = "Host returned an unknown dialog choice."; return; }
		await action.run();
	};
	while (true) {
		if (signal?.aborted) return state.result("aborted");
		const actions: Action[] = [];
		let submitted = false;
		let title: string;
		if (cursor === count) {
			reviewing = true;
			const answered = state.drafts.filter((draft) => draft.kind !== undefined).length;
			title = state.complete ? "Review answers" : `Review answers · ${answered}/${count} answered`;
			if (state.complete) actions.push({ label: "Submit answers", run: () => { submitted = true; } });
			state.params.questions.forEach((q, qi) => {
				actions.push({
					label: `Edit ${qi + 1}. ${compact(q.header, 16)} — ${answerLabel(state, qi)}${state.drafts[qi].notes.trim() ? " · note" : ""}`,
					run: () => { cursor = qi; },
				});
			});
			actions.push({
				label: state.globalNote.trim() ? `Edit global note — ${compact(state.globalNote, 48)}` : "Add global note",
				run: () => edit("Global note (optional)", state.globalNote, (value) => { state.globalNote = value; }),
			});
			actions.push({ label: "Back", run: () => { cursor = count - 1; } });
		} else {
			const qi = cursor;
			const q = state.params.questions[qi];
			const draft = state.drafts[qi];
			title = `Question ${qi + 1}/${count} · ${compact(q.header, 16)}\n${compact(q.question, 120)}`
				+ (q.multiSelect ? "\nSelect any, then Continue." : "");
			q.options.forEach((o, oi) => {
				const mark = draft.kind !== "custom" && draft.selected.has(oi) ? "[x]" : "[ ]";
				actions.push({
					label: `${mark} ${oi + 1}. ${compact(o.label, 60)} — ${compact(o.description, 48)}`,
					run: () => { state.choose(qi, oi); if (!q.multiSelect) advance(); },
				});
			});
			actions.push({
				label: draft.kind === "custom" ? `Type something. — ${compact(draft.custom, 48)}` : "Type something.",
				run: () => edit("Your answer", draft.custom, (value) => {
					if (state.commitCustom(qi, value)) advance();
				}),
			});
			actions.push({ label: "More actions", run: () => secondaryMenu(`More actions · ${compact(q.header, 16)}`, [
				{ label: "Details & previews", run: async () => {
					const details = `${q.question}\n\nCurrent answer: ${state.summary(qi)}`
						+ q.options.map((o, oi) => `\n\n${oi + 1}. ${o.label}\n${o.description}${o.preview ? `\n${o.preview}` : ""}`).join("")
						+ (draft.notes.trim() ? `\n\nNote: ${draft.notes}` : "");
					await secondaryMenu(`Question details\n\n${details}`, [{ label: "Back to question", run: () => {} }]);
				} },
				{ label: "Edit question note", run: () => edit("Question note (optional)", draft.notes, (value) => { draft.notes = value; }) },
				{ label: "Review answers", run: () => { cursor = count; } },
			]) });
			// Keep navigation after the choices and secondary actions, in this order.
			if (draft.kind || q.multiSelect) actions.push({
				label: "Continue",
				run: () => { state.commitEmptyMulti(qi); advance(); },
			});
			if (qi > 0) actions.push({ label: "Back", run: () => { cursor = qi - 1; } });
		}
		// The host already supplies Cancel. Do not add a second cancellation row.
		const choice = await waitForDialog(() => ui.select(title, actions.map((action) => action.label), { signal }), signal);
		if (signal?.aborted) return state.result("aborted");
		if (choice === undefined) return state.result("cancelled");
		const action = actions.find((a) => a.label === choice);
		if (!action) return state.result("unavailable", "Host returned an unknown dialog choice.");
		await action.run();
		if (signal?.aborted) return state.result("aborted");
		if (dialogError) return state.result("unavailable", dialogError);
		if (submitted) return state.result("submitted");
	}
}

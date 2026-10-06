import { Type, type Static } from "typebox";

export const QuestionParams = Type.Object({
	questions: Type.Array(Type.Object({
		question: Type.String({ minLength: 1, description: "Complete question to ask the user." }),
		header: Type.String({ minLength: 1, maxLength: 16, description: "Short question tab label." }),
		options: Type.Array(Type.Object({
			label: Type.String({ minLength: 1, maxLength: 60 }),
			description: Type.String({ minLength: 1, description: "Explain this choice and its trade-offs." }),
			preview: Type.Optional(Type.String({ description: "Optional Markdown, code, or diagram preview." })),
		}), { minItems: 2, maxItems: 4 }),
		multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple choices. Default: false." })),
	}), { minItems: 1, maxItems: 4 }),
});
export type Params = Static<typeof QuestionParams>;
export type Question = Params["questions"][number];
export type AnswerKind = "option" | "multi" | "custom";

export interface Answer {
	questionIndex: number;
	question: string;
	kind: AnswerKind;
	answer: string | null;
	selected?: string[];
	preview?: string;
	notes?: string;
}
export interface QuestionnaireResult {
	status: "submitted" | "cancelled" | "aborted" | "unavailable";
	/** Compatibility flag: true whenever no answers were submitted. Use status for the reason. */
	cancelled: boolean;
	answers: Answer[];
	globalNote?: string;
	error?: string;
}
export interface Draft {
	kind?: AnswerKind;
	selected: Set<number>;
	custom: string;
	notes: string;
}

const normalize = (text: string) => text.replace(/\r\n?/g, "\n");

/** Schema validation runs in pi; check semantic conflicts after normalizing text. */
export function normalizeQuestions(params: Params): Params {
	if (params.questions.length < 1 || params.questions.length > 4) throw new Error("Ask 1–4 questions.");
	const questions = params.questions.map((q) => ({
		...q,
		question: normalize(q.question).trim(),
		header: normalize(q.header).trim(),
		options: q.options.map((o) => ({
			...o,
			label: normalize(o.label).trim(),
			description: normalize(o.description).trim(),
			...(o.preview !== undefined ? { preview: normalize(o.preview) } : {}),
		})),
	}));
	const seenQuestions = new Set<string>();
	for (const q of questions) {
		if (!q.question || !q.header || [...q.header].length > 16) throw new Error("Questions and headers must be non-empty; headers allow 16 characters.");
		if (seenQuestions.has(q.question)) throw new Error("Duplicate question.");
		seenQuestions.add(q.question);
		if (q.options.length < 2 || q.options.length > 4) throw new Error("Each question needs 2–4 options.");
		const labels = new Set<string>();
		for (const o of q.options) {
			const key = o.label.toLowerCase();
			if (!o.label || [...o.label].length > 60 || !o.description) throw new Error("Options need a label (1–60 characters) and description.");
			if (["other", "type something.", "next"].includes(key)) throw new Error("Do not author Other, Type something., or Next rows.");
			if (labels.has(key)) throw new Error("Duplicate option label.");
			labels.add(key);
		}
	}
	return { questions };
}

/** One invocation owns its drafts. Only explicit submission serializes them into a tool result. */
export class QuestionnaireState {
	readonly drafts: Draft[];
	globalNote = "";
	readonly params: Params;

	constructor(params: Params) {
		this.params = params;
		this.drafts = params.questions.map(() => ({ selected: new Set<number>(), custom: "", notes: "" }));
	}

	choose(qi: number, oi: number): void {
		const draft = this.drafts[qi];
		if (this.params.questions[qi].multiSelect) {
			if (draft.selected.has(oi)) draft.selected.delete(oi);
			else draft.selected.add(oi);
			draft.kind = "multi";
		} else {
			draft.selected = new Set([oi]);
			draft.kind = "option";
		}
	}

	commitCustom(qi: number, value: string): boolean {
		if (!value.trim()) return false;
		this.drafts[qi].custom = value;
		this.drafts[qi].kind = "custom";
		return true;
	}

	/** An explicitly empty multi-selection is an answer, unlike a question never visited. */
	commitEmptyMulti(qi: number): void {
		if (this.params.questions[qi].multiSelect && !this.drafts[qi].kind) this.drafts[qi].kind = "multi";
	}

	get complete(): boolean {
		return this.drafts.every((draft) => draft.kind !== undefined);
	}

	answer(qi: number): Answer | undefined {
		const draft = this.drafts[qi];
		if (!draft.kind) return undefined;
		const q = this.params.questions[qi];
		const options = [...draft.selected].sort((a, b) => a - b).map((oi) => q.options[oi]);
		const result: Answer = {
			questionIndex: qi, question: q.question, kind: draft.kind,
			answer: draft.kind === "custom" ? draft.custom : draft.kind === "option" ? options[0].label : null,
		};
		if (draft.kind === "multi") result.selected = options.map((o) => o.label);
		if (draft.kind === "option" && options[0].preview) result.preview = options[0].preview;
		if (draft.notes.trim()) result.notes = draft.notes;
		return result;
	}

	summary(qi: number): string {
		const answer = this.answer(qi);
		if (!answer) return "Not answered";
		return answer.kind === "multi" ? answer.selected!.join(", ") || "(none selected)" : answer.answer!;
	}

	review(): string {
		return this.params.questions.map((q, qi) => {
			const notes = this.drafts[qi].notes;
			return `${qi + 1}. [${q.header}] ${q.question}\n   ${this.summary(qi)}${notes.trim() ? `\n   Note: ${notes}` : ""}`;
		}).join("\n\n") + (this.globalNote.trim() ? `\n\nGlobal note: ${this.globalNote}` : "");
	}

	result(status: QuestionnaireResult["status"], error?: string): QuestionnaireResult {
		if (status === "submitted" && !this.complete) throw new Error("Cannot submit unanswered questions.");
		return {
			status, cancelled: status !== "submitted",
			answers: status === "submitted" ? this.drafts.map((_, qi) => this.answer(qi)!) : [],
			...(status === "submitted" && this.globalNote.trim() ? { globalNote: this.globalNote } : {}),
			...(error ? { error } : {}),
		};
	}
}

export function toolResponse(result: QuestionnaireResult) {
	const text = result.status === "submitted"
		? `User has answered your questions:\n${JSON.stringify({ answers: result.answers, ...(result.globalNote ? { globalNote: result.globalNote } : {}) }, null, 2)}`
		: result.status === "cancelled"
			? "User cancelled the questionnaire. No answers were submitted. Do not use draft answers or ask again unless requested."
			: result.status === "aborted"
				? "Questionnaire interrupted. No answers were submitted; this is not a user decline."
				: `Questionnaire unavailable: ${result.error}. The user did not decline. Ask in plain chat instead.`;
	return { content: [{ type: "text" as const, text }], details: result };
}

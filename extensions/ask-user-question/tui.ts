import type { KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_MARKER, Editor, Key, Markdown, SelectList, matchesKey, truncateToWidth,
	visibleWidth, wrapTextWithAnsi, type Component, type Focusable, type MarkdownTheme,
	type SelectItem, type TUI,
} from "@earendil-works/pi-tui";
import { QuestionnaireState, type QuestionnaireResult } from "./state.ts";
import type { ResponseTimeout } from "./response-timeout.ts";

/** Keyboard-first questionnaire. It uses pi's editor, selector, and width-aware Markdown renderer. */
export class QuestionnaireComponent implements Component, Focusable {
	private tab = 0;
	private list!: SelectList;
	private editor: Editor;
	private editing?: "custom" | "note";
	private customDrafts: string[];
	private noteDrafts: string[];
	private selectionByTab: number[];
	private detailOffset = 0;
	private detailHeight = 1;
	private detailLength = 0;
	private notice = "";
	private closed = false;
	private hasFocus = false;
	private listHeight = 0;
	private markdownTheme: MarkdownTheme;
	private cachedDetail?: { text: string; component: Markdown };

	private tui: TUI;
	private theme: Theme;
	private keys: KeybindingsManager;
	readonly state: QuestionnaireState;
	private done: (result: QuestionnaireResult) => void;
	private signal?: AbortSignal;
	private timeout?: ResponseTimeout;
	private clock?: ReturnType<typeof setInterval>;

	constructor(tui: TUI, theme: Theme, keys: KeybindingsManager, state: QuestionnaireState,
		done: (result: QuestionnaireResult) => void, signal?: AbortSignal, timeout?: ResponseTimeout) {
		this.tui = tui;
		this.theme = theme;
		this.keys = keys;
		this.state = state;
		this.done = done;
		this.signal = signal;
		this.timeout = timeout;
		this.customDrafts = state.drafts.map((draft) => draft.custom);
		this.noteDrafts = [...state.drafts.map((draft) => draft.notes), state.globalNote];
		this.selectionByTab = Array(state.drafts.length + 1).fill(0);
		const selectTheme = {
			selectedPrefix: (text: string) => theme.fg("accent", text),
			selectedText: (text: string) => theme.fg("accent", text),
			description: (text: string) => theme.fg("muted", text),
			scrollInfo: (text: string) => theme.fg("dim", text),
			noMatch: (text: string) => theme.fg("warning", text),
		};
		this.editor = new Editor(tui, { borderColor: (text) => theme.fg("accent", text), selectList: selectTheme });
		this.editor.onSubmit = (text) => this.saveEditor(text);
		this.editor.onChange = () => this.saveDraft();
		this.markdownTheme = {
			heading: (text) => theme.bold(theme.fg("mdHeading", text)),
			link: (text) => theme.fg("mdLink", text), linkUrl: (text) => theme.fg("mdLinkUrl", text),
			code: (text) => theme.fg("mdCode", text), codeBlock: (text) => theme.fg("mdCodeBlock", text),
			codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text), quote: (text) => theme.fg("mdQuote", text),
			quoteBorder: (text) => theme.fg("mdQuoteBorder", text), hr: (text) => theme.fg("mdHr", text),
			listBullet: (text) => theme.fg("mdListBullet", text), bold: (text) => theme.bold(text),
			italic: (text) => theme.italic(text), strikethrough: (text) => theme.strikethrough(text),
			underline: (text) => theme.underline(text),
		};
		this.rebuildList();
		this.signal?.addEventListener("abort", this.onAbort, { once: true });
		if (this.signal?.aborted) this.onAbort();
		if (!this.closed && this.timeout?.enabled) {
			this.clock = setInterval(() => this.refresh(), 1000);
			this.clock.unref?.();
		}
	}

	get focused(): boolean { return this.hasFocus; }
	set focused(value: boolean) { this.hasFocus = value; this.editor.focused = value && !!this.editing; }
	private get reviewing(): boolean { return this.tab === this.state.drafts.length; }
	private onAbort = () => this.finish(this.timeout?.expired ? "timed_out" : "aborted");

	private finish(status: QuestionnaireResult["status"]): void {
		if (this.closed) return;
		this.closed = true;
		this.signal?.removeEventListener("abort", this.onAbort);
		if (this.clock !== undefined) clearInterval(this.clock);
		this.done(this.state.result(status));
	}

	dispose(): void {
		this.closed = true;
		this.signal?.removeEventListener("abort", this.onAbort);
		if (this.clock !== undefined) clearInterval(this.clock);
	}

	invalidate(): void {
		this.list.invalidate();
		this.editor.invalidate();
		this.cachedDetail?.component.invalidate();
	}

	private refresh(): void { this.tui.requestRender(); }
	private saveDraft(): void {
		if (this.editing === "custom") this.customDrafts[this.tab] = this.editor.getExpandedText();
		if (this.editing === "note") this.noteDrafts[this.tab] = this.editor.getExpandedText();
	}

	private startEditor(kind: "custom" | "note"): void {
		this.editing = kind;
		this.editor.setText(kind === "custom" ? this.customDrafts[this.tab] : this.noteDrafts[this.tab]);
		this.editor.focused = this.focused;
		this.notice = "";
		this.refresh();
	}

	private saveEditor(text: string): void {
		this.saveDraft();
		if (this.editing === "custom") {
			if (!this.state.commitCustom(this.tab, text)) {
				this.notice = "Enter an answer, or press Esc to return without changing it.";
				this.refresh();
				return;
			}
			this.switchTab(this.tab + 1);
		} else {
			if (this.reviewing) this.state.globalNote = text;
			else this.state.drafts[this.tab].notes = text;
			this.editing = undefined;
			this.editor.focused = false;
			this.refresh();
		}
	}

	private switchTab(tab: number): void {
		this.saveDraft();
		this.tab = (tab + this.state.drafts.length + 1) % (this.state.drafts.length + 1);
		this.editing = undefined;
		this.editor.focused = false;
		this.detailOffset = 0;
		this.notice = "";
		this.rebuildList();
		this.refresh();
	}

	private rebuildList(maxVisible?: number): void {
		const items: SelectItem[] = this.reviewing
			? [
				{ value: "submit", label: this.state.complete ? "Submit answers" : "Submit (answer all questions first)" },
				...this.state.params.questions.map((q, qi) => ({ value: `edit:${qi}`, label: `Edit ${qi + 1}. ${q.header}`, description: this.state.summary(qi) })),
				{ value: "note", label: "Edit global note" },
				{ value: "cancel", label: "Cancel questionnaire" },
			]
			: [
				...this.state.params.questions[this.tab].options.map((o, oi) => ({
					value: `option:${oi}`,
					label: `${this.state.drafts[this.tab].kind !== "custom" && this.state.drafts[this.tab].selected.has(oi) ? "[x]" : "[ ]"} ${oi + 1}. ${o.label}`,
				})),
				{ value: "custom", label: "Type something." },
				{ value: "next", label: "Continue" },
			];
		this.listHeight = maxVisible ?? (this.listHeight || Math.max(1, Math.min(8, this.tui.terminal.rows - 12)));
		this.list = new SelectList(items, this.listHeight, {
			selectedPrefix: (text) => this.theme.fg("accent", text), selectedText: (text) => this.theme.fg("accent", text),
			description: (text) => this.theme.fg("muted", text), scrollInfo: (text) => this.theme.fg("dim", text),
			noMatch: (text) => this.theme.fg("warning", text),
		});
		this.list.setSelectedIndex(Math.min(this.selectionByTab[this.tab], items.length - 1));
		this.list.onSelect = (item) => this.select(item.value);
		this.list.onCancel = () => this.finish("cancelled");
		this.list.onSelectionChange = (item) => {
			this.selectionByTab[this.tab] = items.findIndex((i) => i.value === item.value);
			this.detailOffset = 0;
		};
	}

	private select(value: string): void {
		if (value === "submit") {
			if (this.state.complete) this.finish("submitted");
			else { this.notice = "Some questions are unanswered. Select an Edit row to complete them."; this.refresh(); }
		} else if (value === "cancel") this.finish("cancelled");
		else if (value.startsWith("edit:")) this.switchTab(Number(value.slice(5)));
		else if (value === "note") this.startEditor("note");
		else if (value === "custom") this.startEditor("custom");
		else if (value === "next") {
			this.state.commitEmptyMulti(this.tab);
			this.switchTab(this.tab + 1);
		} else if (value.startsWith("option:")) {
			this.state.choose(this.tab, Number(value.slice(7)));
			if (this.state.params.questions[this.tab].multiSelect) { this.rebuildList(); this.refresh(); }
			else this.switchTab(this.tab + 1);
		}
	}

	handleInput(data: string): void {
		if (this.closed) return;
		// Any input proves someone is present: stop the unattended-run timeout.
		if (this.timeout?.enabled) { this.timeout.markResponded(); if (this.clock !== undefined) clearInterval(this.clock); }
		if (matchesKey(data, Key.ctrl("c"))) { this.finish("cancelled"); return; }
		if (matchesKey(data, Key.tab)) { this.switchTab(this.tab + 1); return; }
		if (matchesKey(data, Key.shift("tab"))) { this.switchTab(this.tab - 1); return; }
		if (this.editing) {
			if (this.keys.matches(data, "tui.select.cancel")) {
				this.saveDraft(); this.editing = undefined; this.editor.focused = false; this.notice = "";
			} else if (matchesKey(data, Key.ctrl("u"))) this.editor.setText("");
			else this.editor.handleInput(data);
			this.refresh();
			return;
		}
		if (matchesKey(data, Key.left)) { this.switchTab(this.tab - 1); return; }
		if (matchesKey(data, Key.right)) { this.switchTab(this.tab + 1); return; }
		if (data === "n") { this.startEditor("note"); return; }
		if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.pageDown)) {
			const delta = matchesKey(data, Key.pageUp) ? -this.detailHeight : this.detailHeight;
			this.detailOffset = Math.max(0, Math.min(this.detailLength - this.detailHeight, this.detailOffset + delta));
		} else if (matchesKey(data, Key.space)) {
			const item = this.list.getSelectedItem();
			if (!this.reviewing && item?.value.startsWith("option:") && this.state.params.questions[this.tab].multiSelect) this.select(item.value);
		} else this.list.handleInput(data);
		this.refresh();
	}

	private detailText(): string {
		if (this.reviewing) return this.state.review();
		const q = this.state.params.questions[this.tab];
		const value = this.list.getSelectedItem()?.value;
		const option = value?.startsWith("option:") ? q.options[Number(value.slice(7))] : undefined;
		return `${q.question}\n\nCurrent answer: ${this.state.summary(this.tab)}`
			+ (option ? `\n\n${option.description}${option.preview ? `\n\n${option.preview}` : ""}` : "")
			+ (this.state.drafts[this.tab].notes.trim() ? `\n\nNote: ${this.state.drafts[this.tab].notes}` : "");
	}

	private detailLines(width: number, height: number): string[] {
		const text = this.detailText();
		if (this.cachedDetail?.text !== text) this.cachedDetail = { text, component: new Markdown(text, 0, 0, this.markdownTheme) };
		const lines = this.cachedDetail.component.render(width);
		this.detailLength = lines.length;
		this.detailHeight = Math.max(1, height);
		this.detailOffset = Math.min(this.detailOffset, Math.max(0, lines.length - height));
		return lines.slice(this.detailOffset, this.detailOffset + height);
	}

	/** A full frame with an opaque inner area, so the overlay never blends into the transcript behind it. */
	render(width: number): string[] {
		width = Math.max(1, width);
		if (width < 8) return this.renderContent(width);
		const inner = width - 4;
		const border = (text: string) => this.theme.fg("borderAccent", text);
		const lines = this.renderContent(inner);
		const title = truncateToWidth(" Questions ", width - 4);
		const top = border("╭─") + this.theme.fg("accent", title) + border(`${"─".repeat(Math.max(0, width - 3 - visibleWidth(title)))}╮`);
		const bottom = border(`╰${"─".repeat(width - 2)}╯`);
		// renderContent's first and last lines are its own horizontal rules; the frame replaces them.
		const middle = lines.slice(1, -1).map((line) => {
			const fitted = truncateToWidth(line, inner);
			return `${border("│")} ${fitted}${" ".repeat(Math.max(0, inner - visibleWidth(fitted)))} ${border("│")}`;
		});
		return [top, ...middle, bottom];
	}

	private renderContent(width: number): string[] {
		const height = Math.max(8, this.tui.terminal.rows - 4);
		const tabWidth = Math.max(1, Math.floor(width / (this.state.drafts.length + 1)) - 1);
		const tabs = [...this.state.params.questions.map((q, qi) => `${qi + 1}:${q.header}`), "Review"]
			.map((label, i) => this.theme.fg(i === this.tab ? "accent" : "muted", truncateToWidth(label, tabWidth))).join(" ");
		const top = [this.theme.fg("border", "─".repeat(width)), tabs,
			this.theme.fg("accent", this.editing ? (this.editing === "note" ? "Edit note" : "Your answer") : this.reviewing ? "Review — nothing is sent until you submit" : `Question ${this.tab + 1}/${this.state.drafts.length} • ${this.state.params.questions[this.tab].multiSelect ? "multi-select" : "single-select"}`)];
		if (!this.editing && !this.reviewing) {
			top.push(...wrapTextWithAnsi(this.state.params.questions[this.tab].question, width).slice(0, Math.max(0, Math.min(3, height - 9))));
		}
		const hint = this.editing ? "Enter save • Shift+Enter newline\nEsc back • Tab/Shift+Tab switch\nCtrl+U clear"
			: "Tab/Shift+Tab or ←→ switch\n↑↓ move • Enter choose • Space toggle\nn note • PgUp/PgDn scroll • Esc cancel" + " • Ctrl+] hide/show";
		const hintLines = wrapTextWithAnsi(hint, width).slice(0, Math.max(1, Math.min(3, height - top.length - 3)));
		const bodyHeight = Math.max(1, height - top.length - hintLines.length - 2);
		const maxVisible = Math.max(1, Math.min(8, bodyHeight - (width < 90 ? 3 : 1)));
		if (this.listHeight !== maxVisible) this.rebuildList(maxVisible);
		let body: string[];
		if (this.editing) {
			body = this.editor.render(width);
			// Keep the IME cursor visible even on a short terminal.
			const cursor = body.findIndex((line) => line.includes(CURSOR_MARKER));
			const start = Math.max(0, cursor - bodyHeight + 1);
			body = body.slice(start, start + bodyHeight);
		} else if (width >= 90) {
			const leftWidth = Math.floor((width - 3) / 2);
			const rightWidth = width - leftWidth - 3;
			const left = this.list.render(leftWidth).slice(0, bodyHeight);
			const right = this.detailLines(rightWidth, bodyHeight);
			body = Array.from({ length: Math.max(left.length, right.length) }, (_, i) => {
				const line = truncateToWidth(left[i] ?? "", leftWidth);
				return line + " ".repeat(Math.max(0, leftWidth - visibleWidth(line))) + this.theme.fg("border", " │ ") + (right[i] ?? "");
			});
		} else {
			const gap = bodyHeight > 2 ? [""] : [];
			const list = this.list.render(width).slice(0, Math.max(1, bodyHeight - gap.length - 1));
			body = [...list, ...gap, ...this.detailLines(width, Math.max(1, bodyHeight - list.length - gap.length))].slice(0, bodyHeight);
		}
		const idleHint = this.timeout?.enabled ? `No response: continuing without answers in ${Math.ceil((this.timeout.remainingMs ?? this.timeout.durationMs) / 1000)}s. Any key stops the timer.` : "";
		const bottom = [this.theme.fg(this.notice ? "warning" : "dim", this.notice || idleHint || (this.detailLength > this.detailHeight ? `Details ${this.detailOffset + 1}–${Math.min(this.detailLength, this.detailOffset + this.detailHeight)}/${this.detailLength}` : "Answers stay editable until Submit.")),
			...hintLines.map((line) => this.theme.fg("dim", line)), this.theme.fg("border", "─".repeat(width))];
		return [...top, ...body, ...bottom].map((line) => truncateToWidth(line, width));
	}
}

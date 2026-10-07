/**
 * Unattended-run timeout for one questionnaire. It starts when the questionnaire opens.
 * The first user response (a selection, navigation, or editor) turns it off permanently,
 * so a present user is never cut off. Never started at extension registration.
 */
export class ResponseTimeout {
	private controller = new AbortController();
	private timer?: ReturnType<typeof setTimeout>;
	private deadline?: number;
	private responded = false;
	readonly durationMs: number;

	constructor(durationMs: number) { this.durationMs = durationMs; }
	get signal(): AbortSignal { return this.controller.signal; }
	get expired(): boolean { return this.signal.aborted; }
	get enabled(): boolean { return this.durationMs > 0 && !this.responded && !this.expired; }
	get remainingMs(): number | undefined {
		return this.enabled && this.deadline !== undefined ? Math.max(1, this.deadline - Date.now()) : undefined;
	}

	start(): void {
		if (!this.enabled || this.timer !== undefined) return;
		this.deadline = Date.now() + this.durationMs;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.deadline = undefined;
			this.controller.abort(new DOMException("Questionnaire response timeout", "TimeoutError"));
		}, this.durationMs);
	}

	/** Any user response proves someone is present; stop timing for the rest of this questionnaire. */
	markResponded(): void {
		if (this.expired) return;
		this.responded = true;
		this.clear();
	}

	dispose(): void { this.responded = true; this.clear(); }

	private clear(): void {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
		this.deadline = undefined;
	}
}

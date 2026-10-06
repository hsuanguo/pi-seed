import type { Params } from "../extensions/ask-user-question/state.ts";

export const questions: Params = {
	questions: [
		{ question: "Which language?", header: "Language", options: [
			{ label: "TypeScript", description: "Use types", preview: "```ts\nconst x: number = 1;\n```" },
			{ label: "Python", description: "Use Python" },
		] },
		{ question: "Which checks?", header: "Checks", multiSelect: true, options: [
			{ label: "Unit tests", description: "Fast checks" },
			{ label: "Integration tests", description: "Real sessions" },
		] },
	],
};

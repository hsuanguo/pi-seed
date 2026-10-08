/**
 * handoff — split a discovered issue into a persistent session in its own Git worktree.
 * `/handoff [task]` asks the current model to prepare the relevant context and call
 * `handoff`; natural-language requests can call the same tool directly. No config.
 *
 * Worktrees live at <main-repo>-worktrees/handoff-<title>-<unique-id>, compatible
 * with pi-web's Git discovery and removed-worktree grouping. Each branches from
 * the current checkout's exact HEAD. Local edits, untracked/ignored files, and
 * dependencies are not copied. Dirty tracked/untracked state is reported.
 *
 * A fresh, named session stores the brief, source relation and commit through
 * SessionManager. The source session keeps running. The new session is idle until
 * opened; no child process, terminal, web server, or paid child turn is launched.
 * CLI gets a POSIX opening command; pi-web can discover the session on refresh.
 * Sessions use pi's default agent session storage for the target cwd, even when
 * the parent uses --session-dir. No pi-web or pi-subagents dependency.
 *
 * Successful worktrees and branches are retained for explicit user cleanup.
 * Failure/cancellation removes only newly allocated, unchanged resources; Git
 * checkout is allowed to settle (up to five minutes) before cancellation cleanup.
 * Receipts are stored on the parent session branch and in tool-result details.
 */
import { Type } from "typebox";
import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHandoff, HANDOFF_ENTRY_TYPE } from "./create.ts";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "handoff",
		label: "Handoff",
		description:
			"Create one persistent, idle pi session with a focused task and relevant context in a new Git worktree. Keeps the source session. Returns session, worktree, branch and an opening command. Does not run the new task or copy uncommitted/ignored files.",
		promptSnippet:
			"Split an explicitly requested task into a new session and independent Git worktree.",
		promptGuidelines: [
			"Use handoff only when the user asks to split or hand off work into a separate session/worktree.",
			"Write a self-contained task and focused context: relevant findings, reproduction steps, repository-relative file paths, decisions, constraints and remaining work. Mark uncertainty; omit unrelated conversation and secrets.",
			"The new session is idle until opened. Report the returned opening command and any uncopied-local-change warnings; do not claim the new task has started.",
		],
		parameters: Type.Object({
			title: Type.String({
				minLength: 1,
				maxLength: 120,
				description: "Short name for the new task.",
			}),
			task: Type.String({
				minLength: 1,
				maxLength: 8_000,
				description: "Self-contained goal and completion criteria.",
			}),
			context: Type.String({
				minLength: 1,
				maxLength: 40_000,
				description:
					"Only the context this task needs from the current conversation.",
			}),
		}),
		exposure: "model-only",
		executionMode: "sequential",
		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const receipt = await createHandoff(
				{
					...params,
					cwd: ctx.cwd,
					sourceSessionId: ctx.sessionManager.getSessionId(),
					sourceSessionFile: ctx.sessionManager.getSessionFile(),
					sourceLeafId: ctx.sessionManager.getLeafId(),
					model: ctx.model
						? { provider: ctx.model.provider, id: ctx.model.id }
						: undefined,
				},
				signal,
			);
			pi.appendEntry(HANDOFF_ENTRY_TYPE, { toolCallId, receipt });
			return {
				content: [
					{
						type: "text",
						text: [
							"Handoff created. The new session is idle; open it to continue.",
							`Session: ${receipt.sessionId}`,
							`Session file: ${receipt.sessionFile}`,
							`Worktree: ${receipt.worktree}`,
							`Branch: ${receipt.branch}`,
							`Base commit: ${receipt.baseCommit}`,
							...receipt.warnings,
							`\nOpen in a POSIX shell:\n${receipt.openCommand}`,
							"In pi-web, refresh the session list and open the new session under the same project.",
							"Keep the worktree for this task; remove it explicitly when no longer needed.",
						].join("\n"),
					},
				],
				details: receipt,
			};
		},
	});

	pi.registerCommand("handoff", {
		description:
			"Split a task into a new session and Git worktree, carrying relevant context",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify(
					"Wait for the current turn to finish before /handoff.",
					"warning",
				);
				return;
			}
			pi.sendUserMessage(
				[
					"Create exactly one handoff for the task below. Use the handoff tool with a short title, a self-contained task, and only relevant context from our conversation. Include findings, reproduction steps, file paths, decisions, constraints and remaining work. Do not implement the task in this session. Report the resulting session and opening command.",
					`Task: ${args.trim() || "The issue just identified in this conversation."}`,
				].join("\n\n"),
			);
		},
	});
}

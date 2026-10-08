import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { SessionManager } from "@earendil-works/pi-coding-agent";

const execFileAsync = promisify(execFile);
export const HANDOFF_ENTRY_TYPE = "handoff";

export interface HandoffInput {
	cwd: string;
	title: string;
	task: string;
	context: string;
	sourceSessionId: string;
	sourceSessionFile?: string;
	sourceLeafId?: string | null;
	model?: { provider: string; id: string };
}

export interface HandoffReceipt {
	sessionId: string;
	sessionFile: string;
	worktree: string;
	branch: string;
	baseCommit: string;
	sourceCwd: string;
	sourceSessionId: string;
	sourceSessionFile?: string;
	sourceLeafId?: string | null;
	warnings: string[];
	openCommand: string;
}

async function git(
	cwd: string,
	args: string[],
	signal?: AbortSignal,
	timeout = 10_000,
): Promise<string> {
	try {
		const result = await execFileAsync("git", ["-C", cwd, ...args], {
			signal,
			timeout,
			maxBuffer: 1024 * 1024,
			env: { ...process.env, LC_ALL: "C" },
		});
		return result.stdout.trim();
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		const stderr = (error as { stderr?: string }).stderr?.trim();
		throw new Error(
			stderr || (error instanceof Error ? error.message : String(error)),
			{ cause: error },
		);
	}
}

/** POSIX command for pi's terminal hosts; arguments never pass through a shell here. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function requireText(value: string, name: string, maxLength: number): string {
	const text = value.trim();
	if (!text || text.length > maxLength)
		throw new Error(`${name} must contain 1–${maxLength} characters.`);
	return text;
}

/** Create a durable, idle session. Neither the source session nor its files are changed. */
export async function createHandoff(
	input: HandoffInput,
	signal?: AbortSignal,
): Promise<HandoffReceipt> {
	const title = requireText(input.title, "title", 120).replace(/[\r\n]+/g, " ");
	const task = requireText(input.task, "task", 8_000);
	const context = requireText(input.context, "context", 40_000);
	signal?.throwIfAborted();
	const sourceCwd = resolve(input.cwd);
	const sourceRoot = await git(
		sourceCwd,
		["rev-parse", "--show-toplevel"],
		signal,
	);
	const baseCommit = await git(
		sourceRoot,
		["rev-parse", "--verify", "HEAD^{commit}"],
		signal,
	);
	const worktrees = await git(
		sourceRoot,
		["worktree", "list", "--porcelain"],
		signal,
	);
	const repoRoot = worktrees
		.split("\n")
		.find((line) => line.startsWith("worktree "))
		?.slice(9);
	if (!repoRoot)
		throw new Error("Cannot resolve the repository's main checkout.");
	const status = await git(
		sourceRoot,
		["status", "--porcelain=v1", "--untracked-files=normal"],
		signal,
	);
	const slug =
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "task";
	const branch = `handoff/${slug}-${randomUUID().slice(0, 12)}`;
	const worktree = join(`${repoRoot}-worktrees`, branch.replaceAll("/", "-"));
	const warnings = status
		? [
				"Source checkout has uncommitted or untracked files. They were not copied; the new worktree starts from the recorded HEAD commit.",
			]
		: [];
	const sourceSessionFile =
		input.sourceSessionFile && existsSync(input.sourceSessionFile)
			? resolve(input.sourceSessionFile)
			: undefined;
	const origin = {
		sourceCwd,
		sourceSessionId: input.sourceSessionId,
		...(sourceSessionFile ? { sourceSessionFile } : {}),
		sourceLeafId: input.sourceLeafId,
	};
	let branchCreated = false;
	let worktreeCreated = false;
	let worktreeAttempted = false;
	let sessionFile: string | undefined;
	try {
		signal?.throwIfAborted();
		mkdirSync(dirname(worktree), { recursive: true });
		// Let each Git mutation settle before cancellation/rollback: killing checkout
		// midway can leave an ambiguous worktree. The add still has a bounded timeout.
		await git(sourceRoot, ["branch", branch, baseCommit]);
		branchCreated = true;
		signal?.throwIfAborted();
		worktreeAttempted = true;
		await git(
			sourceRoot,
			["worktree", "add", "--", worktree, branch],
			undefined,
			300_000,
		);
		worktreeCreated = true;
		signal?.throwIfAborted();
		const manager = SessionManager.create(worktree, undefined, {
			parentSession: sourceSessionFile,
		});
		sessionFile = manager.getSessionFile();
		if (!sessionFile)
			throw new Error("Pi did not allocate a persistent session file.");
		if (input.model)
			manager.appendModelChange(input.model.provider, input.model.id);
		manager.appendSessionInfo(title);
		manager.appendCustomEntry(HANDOFF_ENTRY_TYPE, {
			...origin,
			worktree,
			branch,
			baseCommit,
		});
		manager.appendMessage({
			role: "user",
			content: [
				{
					type: "text",
					text: [
						task,
						"\n## Handoff context",
						context,
						"\n## Workspace",
						`Work in ${worktree}. Resolve repository paths against this checkout; do not edit the source checkout.`,
						`Base commit: ${baseCommit}`,
						`Source checkout: ${sourceRoot}`,
						`Source working directory: ${sourceCwd}`,
						`Source session: ${input.sourceSessionId}${sourceSessionFile ? ` (${sourceSessionFile})` : " (not persisted)"}`,
						...(warnings.length
							? ["\n## Uncopied local changes", ...warnings, status]
							: []),
					].join("\n"),
				},
			],
			timestamp: Date.now(),
		});
		return {
			...origin,
			sessionId: manager.getSessionId(),
			sessionFile,
			worktree,
			branch,
			baseCommit,
			warnings,
			openCommand: `cd ${shellQuote(worktree)} && pi --session ${shellQuote(sessionFile)}`,
		};
	} catch (error) {
		const recovery: string[] = [];
		if (worktreeAttempted && !worktreeCreated) {
			recovery.push(
				`Git checkout did not finish; inspect ${worktree} and branch ${branch} before cleanup.`,
			);
		}
		if (sessionFile) {
			try {
				rmSync(sessionFile, { force: true });
			} catch {
				recovery.push(`Session file may remain: ${sessionFile}`);
			}
		}
		if (worktreeCreated) {
			try {
				// Never discard changed files or commits, including checkout-hook output.
				const head = await git(worktree, ["rev-parse", "HEAD"]);
				if (head !== baseCommit)
					throw new Error("Worktree HEAD changed; keeping it.");
				if (
					await git(worktree, [
						"status",
						"--porcelain=v1",
						"--ignored",
						"--untracked-files=all",
					])
				) {
					throw new Error("Worktree contains local files; keeping it.");
				}
				await git(sourceRoot, ["worktree", "remove", "--", worktree]);
				worktreeCreated = false;
			} catch {
				recovery.push(`Worktree retained: ${worktree}`);
			}
		}
		if (branchCreated && !worktreeCreated) {
			try {
				const head = await git(sourceRoot, [
					"rev-parse",
					`refs/heads/${branch}`,
				]);
				if (head !== baseCommit) throw new Error("Branch changed; keeping it.");
				await git(sourceRoot, ["branch", "-D", "--", branch]);
			} catch {
				recovery.push(`Branch retained: ${branch}`);
			}
		}
		const message = error instanceof Error ? error.message : String(error);
		throw new Error([message, ...recovery].join("\n"), { cause: error });
	}
}

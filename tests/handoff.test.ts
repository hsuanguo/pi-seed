import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	watch,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
	createHandoff,
	shellQuote,
	type HandoffInput,
} from "../extensions/handoff/create.ts";
import { createSandbox, type Sandbox } from "./helpers.ts";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", ["-C", cwd, ...args], {
		encoding: "utf8",
		env: { ...process.env, LC_ALL: "C" },
	}).trim();
}

function repository(sandbox: Sandbox): HandoffInput {
	git(sandbox.workspace, "init", "-q");
	git(sandbox.workspace, "config", "user.name", "Test User");
	git(sandbox.workspace, "config", "user.email", "test@example.invalid");
	sandbox.write("workspace/source.txt", "main version\n");
	git(sandbox.workspace, "add", ".");
	git(sandbox.workspace, "commit", "-qm", "Initial");
	return {
		cwd: sandbox.workspace,
		title: "Fix cache",
		task: "Fix the cache bug and verify it.",
		context:
			"Reproduce with a repeated lookup; source.txt describes the cache.",
		sourceSessionId: "parent",
	};
}

test("creates a discoverable, named pi session and independent retained Git worktree", async () => {
	const sandbox = createSandbox();
	const input = repository(sandbox);
	const receipt = await createHandoff(input);
	assert.equal(git(receipt.worktree, "rev-parse", "HEAD"), receipt.baseCommit);
	assert.match(
		git(sandbox.workspace, "worktree", "list", "--porcelain"),
		new RegExp(receipt.branch),
	);
	assert.equal(
		git(receipt.worktree, "branch", "--show-current"),
		receipt.branch,
	);
	assert.equal(git(sandbox.workspace, "status", "--porcelain"), "");
	assert.ok(receipt.worktree.startsWith(`${sandbox.workspace}-worktrees/`));
	assert.ok(receipt.sessionFile.startsWith(join(sandbox.agentDir, "sessions")));
	const child = SessionManager.open(receipt.sessionFile);
	assert.equal(child.getCwd(), receipt.worktree);
	assert.equal(child.getSessionId(), receipt.sessionId);
	assert.equal(child.getSessionName(), input.title);
	assert.equal(
		child.getHeader()?.parentSession,
		undefined,
		"an ephemeral parent creates no dangling file relation",
	);
	assert.equal(
		child.getBranch().filter((entry) => entry.type === "message").length,
		1,
	);
	const initial = JSON.stringify(child.buildSessionProjection().messages);
	assert.ok(initial.includes(input.task));
	assert.ok(initial.includes(input.context));
	assert.ok(initial.includes(receipt.baseCommit));
	assert.deepEqual(receipt.warnings, []);
	assert.ok(
		existsSync(receipt.worktree),
		"success does not auto-clean the new task",
	);
});

test("a linked checkout forks its own HEAD even when main has diverged; concurrent names stay unique", async () => {
	const sandbox = createSandbox();
	const input = repository(sandbox);
	const linked = join(sandbox.root, "linked");
	git(sandbox.workspace, "worktree", "add", "-qb", "feature", linked);
	sandbox.write("linked/source.txt", "feature version\n");
	git(linked, "commit", "-qam", "Feature");
	const featureCommit = git(linked, "rev-parse", "HEAD");
	sandbox.write("workspace/source.txt", "different main version\n");
	git(sandbox.workspace, "commit", "-qam", "Divergent main");
	const receipts = await Promise.all([
		createHandoff({ ...input, cwd: linked }),
		createHandoff({ ...input, cwd: linked }),
	]);
	for (const receipt of receipts) {
		assert.equal(receipt.baseCommit, featureCommit);
		assert.equal(
			readFileSync(join(receipt.worktree, "source.txt"), "utf8"),
			"feature version\n",
		);
		assert.ok(receipt.worktree.startsWith(`${sandbox.workspace}-worktrees/`));
	}
	assert.notEqual(receipts[0].worktree, receipts[1].worktree);
	assert.notEqual(receipts[0].sessionId, receipts[1].sessionId);
});

test("dirty and ignored source state stays in place and the brief reports uncopied changes", async () => {
	const sandbox = createSandbox();
	const input = repository(sandbox);
	sandbox.write("workspace/source.txt", "uncommitted\n");
	sandbox.write("workspace/untracked.txt", "local\n");
	sandbox.write("workspace/.git/info/exclude", "ignored.txt\n");
	sandbox.write("workspace/ignored.txt", "private\n");
	git(sandbox.workspace, "add", "source.txt");
	const before = git(sandbox.workspace, "status", "--porcelain");
	const receipt = await createHandoff(input);
	assert.equal(git(sandbox.workspace, "status", "--porcelain"), before);
	assert.equal(
		readFileSync(join(sandbox.workspace, "source.txt"), "utf8"),
		"uncommitted\n",
	);
	assert.equal(
		readFileSync(join(receipt.worktree, "source.txt"), "utf8"),
		"main version\n",
	);
	assert.equal(existsSync(join(receipt.worktree, "untracked.txt")), false);
	assert.equal(existsSync(join(receipt.worktree, "ignored.txt")), false);
	assert.equal(receipt.warnings.length, 1);
	assert.match(
		readFileSync(receipt.sessionFile, "utf8"),
		/Uncopied local changes/,
	);
});

test("links a persisted parent, works from a subdirectory, and quotes shell metacharacters", async () => {
	const sandbox = createSandbox();
	const input = repository(sandbox);
	const parent = SessionManager.create(sandbox.workspace);
	parent.appendMessage({
		role: "user",
		content: "Parent task",
		timestamp: Date.now(),
	});
	mkdirSync(join(sandbox.workspace, "subdir"));
	const receipt = await createHandoff({
		...input,
		cwd: join(sandbox.workspace, "subdir"),
		sourceSessionId: parent.getSessionId(),
		sourceSessionFile: parent.getSessionFile(),
		sourceLeafId: parent.getLeafId(),
	});
	assert.equal(
		SessionManager.open(receipt.sessionFile).getHeader()?.parentSession,
		parent.getSessionFile(),
	);
	assert.equal(receipt.sourceLeafId, parent.getLeafId());
	assert.equal(receipt.sourceCwd, join(sandbox.workspace, "subdir"));
	assert.equal(
		execFileSync(
			"sh",
			["-c", `printf %s ${shellQuote("a'b $(exit 7) `exit 8` ;")}`],
			{ encoding: "utf8" },
		),
		"a'b $(exit 7) `exit 8` ;",
	);
});

test("invalid inputs, non-Git directories and cancellation allocate no worktree", async () => {
	const sandbox = createSandbox();
	const input = repository(sandbox);
	await assert.rejects(createHandoff({ ...input, context: "  " }), /context/);
	await assert.rejects(
		createHandoff({ ...input, cwd: sandbox.home }),
		/not a git repository/,
	);
	await assert.rejects(createHandoff(input, AbortSignal.abort()), /abort/i);
	assert.equal(existsSync(`${sandbox.workspace}-worktrees`), false);
	assert.equal(git(sandbox.workspace, "branch", "--list", "handoff/*"), "");
});

test("repository names with spaces and shell syntax are literal paths", async () => {
	const sandbox = createSandbox();
	const input = repository(sandbox);
	const renamed = join(sandbox.root, "repo's $(touch unexpected) `exit 7`");
	renameSync(sandbox.workspace, renamed);
	const receipt = await createHandoff({ ...input, cwd: renamed });
	assert.equal(
		readFileSync(join(receipt.worktree, "source.txt"), "utf8"),
		"main version\n",
	);
	assert.equal(
		execFileSync("sh", ["-c", `cd ${shellQuote(receipt.worktree)} && pwd`], {
			encoding: "utf8",
		}).trim(),
		receipt.worktree,
	);
	assert.equal(existsSync(join(sandbox.root, "unexpected")), false);
});

test("session persistence failure rolls back only the newly created worktree and branch", async () => {
	const sandbox = createSandbox();
	const input = repository(sandbox);
	// A file where pi needs a session directory creates a deterministic write failure.
	sandbox.write("agent/sessions", "blocked\n");
	await assert.rejects(createHandoff(input));
	assert.equal(
		git(sandbox.workspace, "worktree", "list", "--porcelain").split("worktree ")
			.length,
		2,
	);
	assert.equal(git(sandbox.workspace, "branch", "--list", "handoff/*"), "");
	assert.equal(
		readFileSync(join(sandbox.agentDir, "sessions"), "utf8"),
		"blocked\n",
	);
});

test(
	"cancellation during checkout settles Git and rolls back the clean allocation",
	{ timeout: 10_000 },
	async () => {
		const sandbox = createSandbox();
		const input = repository(sandbox);
		const marker = join(sandbox.root, "cancel-checkout");
		const hook = sandbox.write(
			"workspace/.git/hooks/post-checkout",
			`#!/bin/sh\ntouch ${shellQuote(marker)}\n`,
		);
		execFileSync("chmod", ["+x", hook]);
		const controller = new AbortController();
		const watcher = watch(sandbox.root, (_event, name) => {
			if (name === "cancel-checkout") controller.abort();
		});
		try {
			await assert.rejects(createHandoff(input, controller.signal), /abort/i);
			assert.equal(controller.signal.aborted, true);
			assert.equal(
				git(sandbox.workspace, "worktree", "list", "--porcelain").split(
					"worktree ",
				).length,
				2,
			);
			assert.equal(git(sandbox.workspace, "branch", "--list", "handoff/*"), "");
		} finally {
			watcher.close();
		}
	},
);

test("rollback retains a worktree modified by a checkout hook", async () => {
	const sandbox = createSandbox();
	const input = repository(sandbox);
	const hook = sandbox.write(
		"workspace/.git/hooks/post-checkout",
		"#!/bin/sh\nprintf 'hook output\\n' > hook-output.txt\n",
	);
	git(
		sandbox.workspace,
		"config",
		"core.hooksPath",
		join(sandbox.workspace, ".git/hooks"),
	);
	execFileSync("chmod", ["+x", hook]);
	sandbox.write("agent/sessions", "blocked\n");
	await assert.rejects(createHandoff(input), /Worktree retained:/);
	const worktrees = git(sandbox.workspace, "worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("worktree "));
	assert.equal(worktrees.length, 2);
	assert.ok(existsSync(join(worktrees[1].slice(9), "hook-output.txt")));
	assert.match(
		git(sandbox.workspace, "branch", "--list", "handoff/*"),
		/handoff\//,
	);
});

test("rollback retains ignored checkout-hook output too", async () => {
	const sandbox = createSandbox();
	const input = repository(sandbox);
	sandbox.write("workspace/.git/info/exclude", "hook-output.txt\n");
	const hook = sandbox.write(
		"workspace/.git/hooks/post-checkout",
		"#!/bin/sh\nprintf 'keep me\\n' > hook-output.txt\n",
	);
	execFileSync("chmod", ["+x", hook]);
	sandbox.write("agent/sessions", "blocked\n");
	await assert.rejects(createHandoff(input), /Worktree retained:/);
	const paths = git(sandbox.workspace, "worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("worktree "));
	assert.equal(
		readFileSync(join(paths[1].slice(9), "hook-output.txt"), "utf8"),
		"keep me\n",
	);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	fauxAssistantMessage,
	fauxText,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { HandoffReceipt } from "../extensions/handoff/create.ts";
import {
	createSandbox,
	createTestSession,
	extensionPath,
	type Sandbox,
} from "./helpers.ts";

const EXT = extensionPath("handoff/index");
const brief = {
	title: "Fix lookup",
	task: "Fix the repeated-lookup bug.",
	context:
		"lookup.ts returns stale values on the second call. Keep the public API.",
};

function initRepo(sandbox: Sandbox) {
	for (const args of [
		["init", "-q"],
		["config", "user.name", "Test"],
		["config", "user.email", "test@example.invalid"],
	]) {
		execFileSync("git", ["-C", sandbox.workspace, ...args]);
	}
	sandbox.write("workspace/lookup.ts", "export const lookup = () => 1;\n");
	execFileSync("git", ["-C", sandbox.workspace, "add", "."]);
	execFileSync("git", ["-C", sandbox.workspace, "commit", "-qm", "Initial"]);
}

test("real session: tool persists its receipt and source relation; child resumes with the brief and isolated tools", async () => {
	const sandbox = createSandbox();
	initRepo(sandbox);
	const source = SessionManager.create(sandbox.workspace);
	const parent = await createTestSession(sandbox, {
		extensions: [EXT],
		sessionManager: source,
	});
	const sourceId = source.getSessionId();
	await parent.turnWithTools(
		[{ name: "handoff", args: brief }],
		"Split the lookup problem into its own session.",
	);
	const result = parent.session.messages.findLast(
		(message) =>
			message.role === "toolResult" && message.toolName === "handoff",
	);
	assert.ok(result?.role === "toolResult" && !result.isError);
	const receipt = result.details as unknown as HandoffReceipt;
	assert.ok(existsSync(receipt.sessionFile));
	assert.equal(parent.session.sessionManager.getSessionId(), sourceId);
	assert.equal(parent.session.sessionManager.getCwd(), sandbox.workspace);
	assert.match(parent.toolResults("handoff")[0], /idle/);
	assert.match(parent.systemMessages().join("\n"), /only when the user asks/);
	const savedParent = SessionManager.open(source.getSessionFile()!);
	assert.ok(
		savedParent
			.getBranch()
			.some(
				(entry) => entry.type === "custom" && entry.customType === "handoff",
			),
	);
	const childManager = SessionManager.open(receipt.sessionFile);
	assert.equal(
		childManager.getHeader()?.parentSession,
		source.getSessionFile(),
	);
	assert.ok(
		JSON.stringify(childManager.buildSessionProjection().messages).includes(
			brief.context,
		),
	);
	const child = await createTestSession(sandbox, {
		cwd: receipt.worktree,
		sessionManager: childManager,
	});
	await child.turnWithTools(
		[{ name: "write", args: { path: "child.txt", content: "isolated" } }],
		"Continue from the handoff.",
	);
	assert.equal(
		readFileSync(join(receipt.worktree, "child.txt"), "utf8"),
		"isolated",
	);
	assert.equal(existsSync(join(sandbox.workspace, "child.txt")), false);
	assert.ok(JSON.stringify(child.session.messages).includes(brief.context));
	child.dispose();
	parent.dispose();
});

test(
	"real RPC session: /handoff asks the current model for a focused brief without host-specific APIs",
	{ timeout: 10_000 },
	async () => {
		const sandbox = createSandbox();
		initRepo(sandbox);
		const parent = await createTestSession(sandbox, { extensions: [EXT] });
		await parent.session.bindExtensions({ mode: "rpc" });
		parent.respond(
			fauxAssistantMessage([fauxToolCall("handoff", brief)], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage([fauxText("New session is ready to open.")]),
		);
		const settled = new Promise<void>((resolve) => {
			const unsubscribe = parent.session.subscribe((event) => {
				if (event.type === "agent_settled") {
					unsubscribe();
					resolve();
				}
			});
		});
		await parent.session.prompt("/handoff Fix the lookup bug");
		await settled;
		assert.equal(parent.toolResults("handoff").length, 1);
		assert.match(
			JSON.stringify(parent.session.messages),
			/only relevant context/,
		);
		assert.match(JSON.stringify(parent.session.messages), /Fix the lookup bug/);
		assert.match(parent.toolResults("handoff")[0], /pi --session/);
		parent.dispose();
	},
);

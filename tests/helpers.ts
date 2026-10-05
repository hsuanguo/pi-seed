/**
 * Test helpers. Every test runs against disposable directories: HOME, the pi agent directory,
 * and the workspace all live under one temp root, so the developer's pi installation is never
 * read or written. Sessions are real `AgentSession`s driven by pi's scripted faux model, so
 * tests need no credentials and make no network requests.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type FauxResponseStep, type JsonObject, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	type ExtensionUIContext,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export const REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const extensionPath = (name: string) => join(REPO_DIR, "extensions", `${name}.ts`);

export interface Sandbox {
	root: string;
	home: string;
	agentDir: string;
	/** Default working directory for sessions. */
	workspace: string;
	/** Write a file below `root`, creating parent directories. */
	write(path: string, content: string): string;
}

/** A fresh temp root, with HOME and PI_CODING_AGENT_DIR pointing into it for this process. */
export function createSandbox(): Sandbox {
	const root = mkdtempSync(join(tmpdir(), "pi-dotfiles-test-"));
	const home = join(root, "home");
	const agentDir = join(root, "agent");
	const workspace = join(root, "workspace");
	for (const dir of [home, agentDir, workspace]) mkdirSync(dir, { recursive: true });
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	return {
		root,
		home,
		agentDir,
		workspace,
		write(path, content) {
			const target = resolve(root, path);
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, content);
			return target;
		},
	};
}

export interface TestSession {
	session: AgentSession;
	/** Messages passed to `ctx.ui.notify`. */
	notices: string[];
	/** Queue the faux model's next responses, replacing any left over. */
	respond(...steps: FauxResponseStep[]): void;
	/** One user turn in which the model makes `calls` (in parallel), then answers "done". */
	turnWithTools(calls: { name: string; args: JsonObject }[], prompt?: string): Promise<void>;
	/** One user turn the model answers with text only. */
	textTurn(prompt?: string): Promise<void>;
	/** Real compaction; the faux model writes the summaries. */
	compact(): Promise<void>;
	/** Text of every tool result named `toolName`, oldest first. */
	toolResults(toolName: string): string[];
	/**
	 * System messages recorded in the transcript: what the model was sent. pi records the first
	 * prompt and appends one only when the prompt changes. (`session.systemPrompt` is the base
	 * prompt, without `before_agent_start` changes.)
	 */
	systemMessages(): string[];
	dispose(): void;
}

export interface TestSessionOptions {
	cwd?: string;
	/** Extension files to load. Discovery of other extensions is off. */
	extensions?: string[];
	extensionFactories?: ExtensionFactory[];
	trusted?: boolean;
	settings?: Record<string, unknown>;
}

export async function createTestSession(sandbox: Sandbox, options: TestSessionOptions = {}): Promise<TestSession> {
	const cwd = options.cwd ?? sandbox.workspace;
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, ...options.settings });
	settingsManager.setProjectTrusted(options.trusted ?? false);
	const faux = fauxProvider();
	const modelRuntime = await ModelRuntime.create({
		authPath: join(sandbox.agentDir, "auth.json"),
		modelsPath: null,
		refreshOnCreate: false,
	});
	modelRuntime.registerNativeProvider(faux.provider);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: sandbox.agentDir,
		settingsManager,
		noExtensions: true,
		additionalExtensionPaths: options.extensions ?? [],
		extensionFactories: options.extensionFactories ?? [],
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd,
		agentDir: sandbox.agentDir,
		model: faux.getModel(),
		modelRuntime,
		resourceLoader,
		settingsManager,
		sessionManager: SessionManager.inMemory(cwd),
	});
	const notices: string[] = [];
	const uiContext = { notify: (message: string) => notices.push(message) } as unknown as ExtensionUIContext;
	await session.bindExtensions({ uiContext });

	const respond = (...steps: FauxResponseStep[]) => faux.setResponses(steps);
	return {
		session,
		notices,
		respond,
		async turnWithTools(calls, prompt = "go") {
			respond(
				fauxAssistantMessage(
					calls.map((call) => fauxToolCall(call.name, call.args)),
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage([fauxText("done")]),
			);
			await session.prompt(prompt);
		},
		async textTurn(prompt = "next") {
			respond(fauxAssistantMessage([fauxText("ok")]));
			await session.prompt(prompt);
		},
		async compact() {
			// A split turn needs a second summary for the turn prefix.
			respond(fauxAssistantMessage([fauxText("## Goal\nsummary")]), fauxAssistantMessage([fauxText("prefix summary")]));
			await session.compact();
		},
		toolResults(toolName) {
			return session.messages.flatMap((message) =>
				message.role === "toolResult" && message.toolName === toolName
					? [message.content.map((block) => (block.type === "text" ? block.text : "")).join("")]
					: [],
			);
		},
		systemMessages() {
			return session.sessionManager
				.getBranch()
				.flatMap((entry) => (entry.type === "message" && entry.message.role === "system" ? [JSON.stringify(entry.message)] : []));
		},
		dispose: () => session.dispose(),
	};
}

/** `name: description` SKILL.md content. */
export function skillMd(name: string, description = `${name} skill`): string {
	return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

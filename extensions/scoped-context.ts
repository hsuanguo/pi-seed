/**
 * scoped-context.ts — AGENTS.md / CLAUDE.md files in subdirectories of the working directory.
 *
 * pi loads context files from the agent directory and from the working directory upward, so a
 * monorepo's `A/AGENTS.md` is never loaded when pi runs at the repository root. Per directory the
 * first of AGENTS.override.md, AGENTS.md, AGENTS.MD, CLAUDE.md, CLAUDE.MD applies, as in pi.
 * This extension adds the files below the working directory in one of two modes:
 *
 * lazy (default) — like Claude Code's nested CLAUDE.md:
 *   - When `read`, `edit`, `write`, `ls`, `find`, or `grep` touches a path below the working
 *     directory, each directory between that path and the working directory (exclusive) is
 *     checked, outermost first. A context file not in context yet is appended to the tool result.
 *     A file that changed, a directory whose applying file changed (an AGENTS.override.md was
 *     added, say), and a file that was deleted are reported the same way, so stale instructions
 *     are marked as replaced or withdrawn.
 *   - Appended files stay in context (they are part of the transcript). What each directory
 *     contributed is recorded as `scoped-context` custom entries on the session branch, so /tree,
 *     fork, and resume see what that branch's transcript holds. Entries before the last
 *     compaction's first kept entry were summarized away, so their files are appended again on
 *     the next touch.
 *   - Calls made from a codemode script deliver their result to the script, not the model, so
 *     their files are appended to the codemode result instead.
 *   - A full `read` of a context file counts as loading it; nothing is appended.
 *   - `bash` is not inspected: its paths cannot be known reliably.
 *
 * eager — like the root AGENTS.md:
 *   - At startup and /reload every context file below the working directory is added to the
 *     system prompt's project instructions, each with a line naming the directory it applies to.
 *     Files come from `git ls-files` (honoring .gitignore), or from a directory walk outside git.
 *   - Changes take effect after /reload, as for the root AGENTS.md.
 *
 * Both modes skip `node_modules` and hidden directories. `--no-context-files` disables the extension.
 *
 * Config (optional, JSON; run /reload after editing):
 *   - User:    ~/.pi/agent/scoped-context.json
 *   - Project: <cwd>/.pi/scoped-context.json (read only when the project is trusted; overrides user)
 *
 *   { "mode": "lazy" }   // or "eager"
 *
 * `/scoped-context` shows the mode, the config files read, and the files in context.
 *
 * Install: copy to ~/.pi/agent/extensions/ (or a project's .pi/extensions/), then /reload.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CONFIG_DIR_NAME, type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";

export const ENTRY_TYPE = "scoped-context";
export const CONFIG_FILE_NAME = "scoped-context.json";
/** Same names and precedence as pi's own context-file discovery. */
export const CONTEXT_FILE_NAMES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
/** Built-in tools whose `path` argument names what they touch. */
export const PATH_TOOLS = new Set(["read", "edit", "write", "ls", "find", "grep"]);
/** Eager mode warns above this many characters (about 10k tokens) of added instructions. */
const EAGER_WARN_CHARS = 40_000;
/** Upper bound on directories visited by the walk used outside git repositories. */
const WALK_MAX_DIRS = 20_000;

export type Mode = "lazy" | "eager";

export interface Config {
	mode: Mode;
}

export interface ContextFile {
	absPath: string;
	/** Relative to the working directory, with `/` separators. */
	relPath: string;
	/** Directory the file applies to, relative to the working directory, with a trailing `/`. */
	scope: string;
	content: string;
	hash: string;
}

/** What one directory contributed to context: its applying file, or `null` once it was withdrawn. */
export interface ScopeState {
	scope: string;
	path: string | null;
	hash: string | null;
}

export interface ScopedContextEntryData {
	scopes: ScopeState[];
}

/** Minimal session entry shape this extension reads. */
interface BranchEntry {
	type: string;
	id: string;
	customType?: string;
	data?: unknown;
	firstKeptEntryId?: string;
}

// ---------------------------------------------------------------------------------------------
// Files and paths
// ---------------------------------------------------------------------------------------------

const toPosix = (path: string) => path.split(sep).join("/");

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/** Whether `child` lies strictly below `parent`. */
export function isStrictlyInside(child: string, parent: string): boolean {
	const rel = relative(parent, child);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** `node_modules` or a hidden directory anywhere between `root` and `dir`. */
function isSkipped(dir: string, root: string): boolean {
	return relative(root, dir)
		.split(sep)
		.some((part) => part === "node_modules" || part.startsWith("."));
}

/** Resolve a tool's `path` argument like pi's tools do: `@` prefix, `~`, relative to cwd. */
export function resolveToolPath(raw: string, cwd: string): string {
	let path = raw.trim().replace(/^@/, "");
	if (path === "~") path = homedir();
	else if (path.startsWith("~/") || path.startsWith("~\\")) path = resolve(homedir(), path.slice(2));
	return resolve(cwd, path);
}

/** The path a built-in tool call touched, resolved against `cwd`, if any. */
export function touchedPath(toolName: string, input: Record<string, unknown> | undefined, cwd: string): string | undefined {
	const raw = input?.path;
	if (!PATH_TOOLS.has(toolName) || typeof raw !== "string" || raw.trim() === "") return undefined;
	return resolveToolPath(raw, cwd);
}

function hashOf(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

const scopeOf = (dir: string, root: string) => `${toPosix(relative(root, dir))}/`;

/** The context file that applies in `dir`, if any. */
export function contextFileIn(dir: string, root: string): ContextFile | undefined {
	for (const name of CONTEXT_FILE_NAMES) {
		const absPath = join(dir, name);
		if (!existsSync(absPath)) continue;
		let content: string;
		try {
			if (!statSync(absPath).isFile()) continue;
			content = readFileSync(absPath, "utf8");
		} catch {
			continue;
		}
		return { absPath, relPath: toPosix(relative(root, absPath)), scope: scopeOf(dir, root), content, hash: hashOf(content) };
	}
	return undefined;
}

/**
 * Directories that can hold context files for `target` that pi does not load itself: from
 * `target` (or its parent, for a file) up to, but excluding, `cwd`. Outermost first.
 */
export function scopeDirs(target: string, cwd: string): string[] {
	const root = resolve(cwd);
	const start = isDirectory(target) ? target : dirname(target);
	if (!isStrictlyInside(start, root) || isSkipped(start, root)) return [];
	const dirs: string[] = [];
	for (let dir = start; isStrictlyInside(dir, root); dir = dirname(dir)) dirs.unshift(dir);
	return dirs;
}

/** The context files that apply to `target`, outermost first. */
export function scopedContextFiles(target: string, cwd: string): ContextFile[] {
	const root = resolve(cwd);
	return scopeDirs(target, root).flatMap((dir) => contextFileIn(dir, root) ?? []);
}

/** Paths of context-file candidates below `root`: from git when it is a repository, else a walk. */
function listCandidatePaths(root: string): string[] {
	const git = spawnSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
		encoding: "utf8",
		timeout: 15_000,
		maxBuffer: 512 * 1024 * 1024,
	});
	if (git.status === 0 && typeof git.stdout === "string") {
		return git.stdout
			.split("\0")
			.filter((path) => CONTEXT_FILE_NAMES.includes(basename(path)))
			.map((path) => resolve(root, path));
	}
	const found: string[] = [];
	const queue = [root];
	for (let visited = 0; queue.length > 0 && visited < WALK_MAX_DIRS; visited++) {
		const dir = queue.shift()!;
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (entry.name !== "node_modules" && !entry.name.startsWith(".")) queue.push(join(dir, entry.name));
			} else if (CONTEXT_FILE_NAMES.includes(entry.name)) {
				found.push(join(dir, entry.name));
			}
		}
	}
	return found;
}

/** Every context file below `cwd` (not in `cwd` itself), one per directory, outermost first. */
export function discoverAll(cwd: string): ContextFile[] {
	const root = resolve(cwd);
	const dirs = new Set(
		listCandidatePaths(root)
			.map((path) => dirname(path))
			.filter((dir) => isStrictlyInside(dir, root) && !isSkipped(dir, root)),
	);
	return [...dirs]
		.flatMap((dir) => contextFileIn(dir, root) ?? [])
		.sort((a, b) => a.scope.split("/").length - b.scope.split("/").length || a.scope.localeCompare(b.scope));
}

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------

export interface LoadedConfig {
	config: Config;
	sources: string[];
	warnings: string[];
}

function readConfigFile(path: string, warnings: string[]): Partial<Config> | undefined {
	if (!existsSync(path)) return undefined;
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		warnings.push(`${path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`);
		return undefined;
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		warnings.push(`${path}: expected a JSON object`);
		return undefined;
	}
	const result: Partial<Config> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (key !== "mode") warnings.push(`${path}: unknown key "${key}"`);
		else if (value === "lazy" || value === "eager") result.mode = value;
		else warnings.push(`${path}: "mode" must be "lazy" or "eager"`);
	}
	return result;
}

/** defaults ← user file ← project file (project only when trusted, like other `.pi/` config). */
export function loadConfig(cwd: string, projectTrusted: boolean, agentDir = getAgentDir()): LoadedConfig {
	const files = [join(agentDir, CONFIG_FILE_NAME)];
	if (projectTrusted) files.push(join(resolve(cwd), CONFIG_DIR_NAME, CONFIG_FILE_NAME));
	const config: Config = { mode: "lazy" };
	const sources: string[] = [];
	const warnings: string[] = [];
	for (const file of files) {
		const values = readConfigFile(file, warnings);
		if (!values) continue;
		sources.push(file);
		Object.assign(config, values);
	}
	return { config, sources, warnings };
}

// ---------------------------------------------------------------------------------------------
// Lazy mode: what the branch's transcript holds
// ---------------------------------------------------------------------------------------------

/**
 * What each directory contributed to the context the model still sees on this branch: entries
 * recorded from the last compaction's first kept entry on. Earlier ones went into the summary.
 */
export function loadedOnBranch(branch: readonly BranchEntry[]): Map<string, ScopeState> {
	let from = 0;
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "compaction") continue;
		const kept = branch.findIndex((candidate) => candidate.id === entry.firstKeptEntryId);
		from = kept >= 0 ? kept : i;
		break;
	}
	const loaded = new Map<string, ScopeState>();
	for (const entry of branch.slice(from)) {
		if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
		const scopes = (entry.data as Partial<ScopedContextEntryData> | undefined)?.scopes;
		if (!Array.isArray(scopes)) continue;
		for (const state of scopes) {
			if (typeof state?.scope === "string") loaded.set(state.scope, state);
		}
	}
	return loaded;
}

/** A directory whose contribution to context differs from what is on disk now. */
export type ScopeChange =
	| { kind: "add"; file: ContextFile; replaces?: string }
	| { kind: "remove"; scope: string; path: string };

/** Compare the directories for the touched targets with what the branch already holds. */
export function scopeChanges(targets: Iterable<string>, cwd: string, loaded: ReadonlyMap<string, ScopeState>): ScopeChange[] {
	const root = resolve(cwd);
	const dirs = new Map<string, string>();
	for (const target of targets) for (const dir of scopeDirs(target, root)) dirs.set(scopeOf(dir, root), dir);
	const changes: ScopeChange[] = [];
	for (const [scope, dir] of [...dirs].sort((a, b) => a[0].split("/").length - b[0].split("/").length)) {
		const current = contextFileIn(dir, root);
		const previous = loaded.get(scope);
		if (current) {
			if (previous?.path === current.relPath && previous.hash === current.hash) continue;
			changes.push({ kind: "add", file: current, ...(previous?.path ? { replaces: previous.path } : {}) });
		} else if (previous?.path) {
			changes.push({ kind: "remove", scope, path: previous.path });
		}
	}
	return changes;
}

export function renderChanges(changes: readonly ScopeChange[]): string {
	return changes
		.map((change) => {
			if (change.kind === "remove") {
				return [
					`<scoped_context scope="${change.scope}" removed="${change.path}">`,
					`${change.path} was deleted. Its earlier instructions no longer apply to files under ${change.scope}.`,
					"</scoped_context>",
				].join("\n");
			}
			const { file, replaces } = change;
			let note = "";
			if (replaces === file.relPath) note = " This file changed since it was loaded; this version replaces the earlier one.";
			else if (replaces) note = ` It replaces ${replaces} for this directory; the instructions from ${replaces} no longer apply.`;
			return [
				`<scoped_context file="${file.relPath}" scope="${file.scope}">`,
				`Instructions for work under ${file.scope}, loaded because this call touched a path there. They apply only to files under ${file.scope} and take precedence over outer instructions for those files.${note}`,
				"",
				file.content.trim(),
				"</scoped_context>",
			].join("\n");
		})
		.join("\n\n");
}

function resultText(content: readonly { type: string; text?: string }[]): string {
	return content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("\n");
}

// ---------------------------------------------------------------------------------------------
// Eager mode: project instructions
// ---------------------------------------------------------------------------------------------

/** The system prompt entry for `file`: the scope note followed by its content. */
export function eagerContextEntry(file: ContextFile): { path: string; content: string } {
	return {
		path: file.absPath,
		content: `(Applies only to files under ${file.scope}; takes precedence over outer instructions for those files.)\n\n${file.content.trim()}`,
	};
}

// ---------------------------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------------------------

export default function scopedContext(pi: ExtensionAPI) {
	const disabled = process.argv.includes("--no-context-files") || process.argv.includes("-nc");
	let loadedConfig: LoadedConfig = { config: { mode: "lazy" }, sources: [], warnings: [] };
	/** Eager mode: files found at startup or /reload. */
	let eagerFiles: ContextFile[] = [];
	/** Lazy mode: paths touched by nested calls, waiting for the result of the call that made them. */
	const pending = new Map<string, Set<string>>();

	pi.on("resources_discover", (event, ctx) => {
		if (disabled) return undefined;
		loadedConfig = loadConfig(event.cwd, ctx.isProjectTrusted());
		for (const warning of loadedConfig.warnings) ctx.ui.notify(`scoped-context config: ${warning}`, "warning");
		eagerFiles = loadedConfig.config.mode === "eager" ? discoverAll(event.cwd) : [];
		const chars = eagerFiles.reduce((sum, file) => sum + file.content.length, 0);
		if (chars > EAGER_WARN_CHARS) {
			ctx.ui.notify(
				`scoped-context (eager): ${eagerFiles.length} files add ~${Math.round(chars / 4000)}k tokens to every request. Consider "mode": "lazy".`,
				"warning",
			);
		}
		return undefined;
	});

	// The same entries every turn, so the system prompt does not change between turns.
	pi.on("before_agent_start", (event) => {
		if (disabled || loadedConfig.config.mode !== "eager") return undefined;
		const files = event.systemPromptOptions.contextFiles;
		const present = new Set(files.map((file) => file.path));
		for (const file of eagerFiles) if (!present.has(file.absPath)) files.push(eagerContextEntry(file));
		return undefined;
	});

	// Synchronous on purpose: parallel tool results cannot interleave between reading the branch
	// and recording what was loaded, so a file is never appended twice.
	pi.on("tool_result", (event, ctx) => {
		if (disabled || loadedConfig.config.mode !== "lazy") return undefined;
		const targets = new Set(pending.get(event.toolCallId) ?? []);
		pending.delete(event.toolCallId);
		const target = touchedPath(event.toolName, event.input, ctx.cwd);
		if (target !== undefined && scopeDirs(target, ctx.cwd).length > 0) targets.add(target);
		if (targets.size === 0) return undefined;

		if (event.parentToolCallId) {
			const waiting = pending.get(event.parentToolCallId) ?? new Set<string>();
			for (const path of targets) waiting.add(path);
			pending.set(event.parentToolCallId, waiting);
			return undefined;
		}

		const changes = scopeChanges(targets, ctx.cwd, loadedOnBranch(ctx.sessionManager.getBranch() as readonly BranchEntry[]));
		if (changes.length === 0) return undefined;

		pi.appendEntry<ScopedContextEntryData>(ENTRY_TYPE, {
			scopes: changes.map((change) =>
				change.kind === "add"
					? { scope: change.file.scope, path: change.file.relPath, hash: change.file.hash }
					: { scope: change.scope, path: null, hash: null },
			),
		});

		// A successful read of the context file itself already shows the model its content.
		const shown = event.toolName === "read" && !event.isError ? resultText(event.content) : undefined;
		const toAppend = changes.filter(
			(change) =>
				!(
					change.kind === "add" &&
					!change.replaces &&
					shown !== undefined &&
					change.file.absPath === target &&
					shown.includes(change.file.content.trim())
				),
		);
		if (toAppend.length === 0) return undefined;
		return {
			content: [...event.content, { type: "text" as const, text: renderChanges(toAppend) }],
			...(event.structuredContent !== undefined ? { structuredContent: event.structuredContent } : {}),
		};
	});

	pi.registerCommand("scoped-context", {
		description: "Show the scoped-context mode and the subdirectory AGENTS.md / CLAUDE.md files in context",
		handler: async (_args, ctx) => {
			if (disabled) {
				ctx.ui.notify("scoped-context is off: pi runs with --no-context-files.", "info");
				return;
			}
			const { config, sources, warnings } = loadedConfig;
			const lines = [
				`Mode: ${config.mode}`,
				`Config: ${sources.length > 0 ? sources.join(", ") : "(none, using defaults)"}`,
				...warnings.map((warning) => `  ⚠ ${warning}`),
			];
			if (config.mode === "eager") {
				lines.push(eagerFiles.length > 0 ? "In the system prompt (until /reload):" : "No context files below the working directory.");
				for (const file of eagerFiles) lines.push(`  ${file.relPath}`);
			} else {
				const loaded = [...loadedOnBranch(ctx.sessionManager.getBranch() as readonly BranchEntry[]).values()];
				const active = loaded.filter((state) => state.path !== null);
				lines.push(active.length > 0 ? "In context on this branch:" : "No subdirectory context files in context on this branch yet.");
				for (const state of active) {
					const current = contextFileIn(resolve(ctx.cwd, state.scope), resolve(ctx.cwd));
					let status = "current";
					if (!current) status = "deleted since, withdrawn on next touch";
					else if (current.relPath !== state.path || current.hash !== state.hash) status = "changed since, updated on next touch";
					lines.push(`  ${state.path} (${status})`);
				}
			}
			ctx.ui.notify(lines.join("\n"), warnings.length > 0 ? "warning" : "info");
		},
	});
}

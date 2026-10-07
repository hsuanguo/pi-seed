/**
 * claude-skills.ts — pi extension that discovers skills from Claude Code's
 * `~/.claude/skills/` and project-level `.claude/skills/` directories.
 *
 * Hooks the `resources_discover` event so pi reuses its own loader:
 * frontmatter parsing, validation, and prompt formatting all come for free.
 * No prompt hacking, no duplicate state.
 *
 * Behavior:
 *   - Only `SKILL.md` files are loaded (Claude Code's layout). Loose `.md`
 *     files such as `README.md` are never treated as skills.
 *   - Project-level `.claude/skills/` is only loaded when pi trusts the
 *     project, the same gate pi applies to `.pi/skills/` and `.agents/skills/`.
 *     Note: pi does not prompt for trust just because `.claude/skills/`
 *     exists; `/claude-skills` reports directories skipped for this reason.
 *   - On a name collision, pi's native skills win over Claude skills, and
 *     `~/.claude/skills/` wins over project-level ones.
 *   - `ancestors` (default) searches cwd and its ancestors up to the Git root.
 *     `eager` also searches below the Git root (or cwd outside Git), skipping
 *     hidden directories, node_modules, directory symlinks, and nested Git
 *     repositories (a `.git` directory or file). It only walks trusted projects
 *     when project skills are enabled. Ancestor skills win
 *     over newly discovered skills with the same name.
 *
 * Config (optional, JSON):
 *   - User:    `~/.pi/agent/pi-seed-config.json`
 *   - Project: `<cwd>/.pi/pi-seed-config.json` (only read when the project is
 *     trusted; overrides user values key by key)
 *
 *   {
 *     "claudeSkills": {
 *       "mode": "ancestors",        // or "eager" to include nested directories
 *       "ignoreUserSkills": false,    // true = skip ~/.claude/skills/
 *       "ignoreProjectSkills": false  // true = skip project .claude/skills/
 *     }
 *   }
 *
 *   The shared file also accepts a `scopedContext` section, read by scoped-context.ts.
 *   Legacy claude-skills.json files are not read; move their values into `claudeSkills`.
 *   Invalid JSON, unknown keys, and invalid values produce a warning and
 *   are ignored. Run `/reload` after editing.
 *
 * Install (user-level, applies to every project):
 *   mkdir -p ~/.pi/agent/extensions
 *   cp claude-skills.ts ~/.pi/agent/extensions/
 *
 * Install (project-level, only for this repo):
 *   mkdir -p .pi/extensions
 *   cp claude-skills.ts .pi/extensions/
 *
 * Verify:
 *   - Restart pi, or run `/reload` inside pi.
 *   - Run `/claude-skills` to see scanned directories and per-skill status.
 *   - Skills show up in the system prompt alongside native ones.
 *   - Force-load with `/skill:<name>` when the model misses them.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	getAgentDir,
	loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";

const CONFIG_FILE_NAME = "pi-seed-config.json";

interface ClaudeSkillsConfig {
	mode: "ancestors" | "eager";
	ignoreUserSkills: boolean;
	ignoreProjectSkills: boolean;
}

const DEFAULT_CONFIG: ClaudeSkillsConfig = {
	mode: "ancestors",
	ignoreUserSkills: false,
	ignoreProjectSkills: false,
};

interface LoadedConfig {
	config: ClaudeSkillsConfig;
	/** Config files that were found and read, lowest precedence first. */
	sources: string[];
	/** Human-readable problems found while reading config files. */
	warnings: string[];
}

interface ClaudeSkillDirs {
	/** `~/.claude/skills/`, if it exists. */
	user: string[];
	/** Project-level dirs that will be loaded (project is trusted). */
	project: string[];
	/** Project-level dirs that exist but were skipped (project not trusted). */
	skippedUntrusted: string[];
	/** Dirs that exist but were skipped by config. */
	ignoredByConfig: string[];
}

interface SkillEntry {
	/** Absolute path to the SKILL.md file. */
	filePath: string;
	/** Skill name, when the file parsed into a valid skill. */
	name?: string;
	/** First loader diagnostic, when the file failed to load. */
	error?: string;
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/**
 * Walk up from `start` looking for a directory containing `.git`.
 * The filesystem root itself is never considered.
 */
function findGitRoot(start: string): string | undefined {
	let current = resolve(start);
	while (dirname(current) !== current) {
		if (existsSync(join(current, ".git"))) return current;
		current = dirname(current);
	}
	return undefined;
}

/** Read one config file. Returns undefined when the file does not exist. */
function readConfigFile(path: string, warnings: string[]): Partial<ClaudeSkillsConfig> | undefined {
	if (!existsSync(path)) return undefined;
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf-8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`${path}: invalid JSON, ignored (${message})`);
		return {};
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		warnings.push(`${path}: expected a JSON object, ignored`);
		return {};
	}
	for (const key of Object.keys(raw)) {
		if (key !== "claudeSkills" && key !== "scopedContext" && key !== "askUserQuestion") warnings.push(`${path}: unknown section "${key}", ignored`);
	}
	const section = (raw as Record<string, unknown>).claudeSkills;
	if (section === undefined) return {};
	if (typeof section !== "object" || section === null || Array.isArray(section)) {
		warnings.push(`${path}: "claudeSkills" must be a JSON object, ignored`);
		return {};
	}
	const result: Partial<ClaudeSkillsConfig> = {};
	for (const [key, value] of Object.entries(section)) {
		if (!Object.hasOwn(DEFAULT_CONFIG, key)) {
			warnings.push(`${path}: unknown key "claudeSkills.${key}", ignored`);
		} else if (key === "mode") {
			if (value === "ancestors" || value === "eager") result.mode = value;
			else warnings.push(`${path}: "claudeSkills.mode" must be "ancestors" or "eager", ignored`);
		} else if (typeof value !== "boolean") {
			warnings.push(`${path}: "claudeSkills.${key}" must be a boolean, ignored`);
		} else {
			result[key as "ignoreUserSkills" | "ignoreProjectSkills"] = value;
		}
	}
	return result;
}

/**
 * Load config: defaults ← user file ← project file (project only when trusted,
 * matching how pi treats other project-local `.pi/` config).
 */
function loadConfig(cwd: string, projectTrusted: boolean): LoadedConfig {
	const loaded: LoadedConfig = { config: { ...DEFAULT_CONFIG }, sources: [], warnings: [] };
	const files = [join(getAgentDir(), CONFIG_FILE_NAME)];
	if (projectTrusted) files.push(join(resolve(cwd), CONFIG_DIR_NAME, CONFIG_FILE_NAME));
	for (const file of files) {
		const partial = readConfigFile(file, loaded.warnings);
		if (!partial) continue;
		loaded.sources.push(file);
		Object.assign(loaded.config, partial);
	}
	return loaded;
}

/**
 * Collect `.claude/skills/` directories.
 *
 * - User-level: `~/.claude/skills/`.
 * - Project-level: `.claude/skills/` in `cwd` and every ancestor, stopping at
 *   the git repository root — the same walk pi uses for `.agents/skills/`.
 *   Outside a git repo the walk continues upward but never checks the
 *   filesystem root (`/.claude/skills/`).
 * - Eager mode additionally walks below the Git root (or cwd outside Git).
 *   User and ancestor directories keep their existing priority. Descendant
 *   scanning requires trust and enabled project skills.
 *
 * Config ignores take precedence over the trust check, so a dir ignored by
 * config is always reported as such.
 */
function collectClaudeSkillDirs(
	cwd: string,
	projectTrusted: boolean,
	config: ClaudeSkillsConfig,
): ClaudeSkillDirs {
	const userDir = resolve(homedir(), ".claude", "skills");
	const result: ClaudeSkillDirs = { user: [], project: [], skippedUntrusted: [], ignoredByConfig: [] };
	const seen = new Set<string>([userDir]);

	if (isDirectory(userDir)) {
		(config.ignoreUserSkills ? result.ignoredByConfig : result.user).push(userDir);
	}

	function addProjectDir(dir: string): void {
		const candidate = join(dir, ".claude", "skills");
		if (seen.has(candidate) || !isDirectory(candidate)) return;
		seen.add(candidate);
		if (config.ignoreProjectSkills) result.ignoredByConfig.push(candidate);
		else if (projectTrusted) result.project.push(candidate);
		else result.skippedUntrusted.push(candidate);
	}

	const gitRoot = findGitRoot(cwd);
	let current = resolve(cwd);
	while (dirname(current) !== current) {
		addProjectDir(current);
		if (current === gitRoot) break;
		current = dirname(current);
	}
	if (config.mode === "eager" && projectTrusted && !config.ignoreProjectSkills) {
		const pending = [gitRoot ?? resolve(cwd)];
		while (pending.length > 0) {
			const dir = pending.pop()!;
			addProjectDir(dir);
			let entries;
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}
			entries.sort((left, right) => right.name.localeCompare(left.name));
			for (const entry of entries) {
				if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
				const child = join(dir, entry.name);
				if (existsSync(join(child, ".git"))) continue;
				pending.push(child);
			}
		}
	}
	return result;
}

/**
 * Find SKILL.md files under `dir` using pi's own directory scanner, so ignore
 * files, symlink handling, and "SKILL.md marks a skill root" semantics match
 * pi exactly. Loose `.md` files are filtered out. SKILL.md files that failed
 * to parse are kept, so pi still reports their diagnostics.
 */
function scanSkillDir(dir: string): SkillEntry[] {
	const { skills, diagnostics } = loadSkillsFromDir({ dir, source: "claude" });
	const entries = new Map<string, SkillEntry>();
	for (const skill of skills) {
		if (basename(skill.filePath) !== "SKILL.md") continue;
		entries.set(skill.filePath, { filePath: skill.filePath, name: skill.name });
	}
	for (const diag of diagnostics) {
		if (!diag.path || basename(diag.path) !== "SKILL.md" || entries.has(diag.path)) continue;
		entries.set(diag.path, { filePath: diag.path, error: diag.message });
	}
	return [...entries.values()];
}

export default function (pi: ExtensionAPI) {
	// Feed individual SKILL.md files (not directories) into pi's loader, so
	// pi never picks up loose `.md` files at the root of a skills dir.
	pi.on("resources_discover", (event, ctx) => {
		const trusted = ctx.isProjectTrusted();
		const { config, warnings } = loadConfig(event.cwd, trusted);
		if (warnings.length > 0) {
			ctx.ui.notify(`claude-skills config:\n${warnings.map((w) => `  ${w}`).join("\n")}`, "warning");
		}
		const dirs = collectClaudeSkillDirs(event.cwd, trusted, config);
		const seen = new Set<string>();
		const skillPaths: string[] = [];
		for (const dir of [...dirs.user, ...dirs.project]) {
			for (const entry of scanSkillDir(dir)) {
				if (seen.has(entry.filePath)) continue;
				seen.add(entry.filePath);
				skillPaths.push(entry.filePath);
			}
		}
		return { skillPaths };
	});

	// Debug command: show scanned directories and the load status of each skill.
	pi.registerCommand("claude-skills", {
		description: "Show .claude/skills/ directories and the load status of each Claude skill",
		handler: async (_args, ctx) => {
			const trusted = ctx.isProjectTrusted();
			const { config, sources, warnings } = loadConfig(ctx.cwd, trusted);
			const dirs = collectClaudeSkillDirs(ctx.cwd, trusted, config);
			const scanned = [...dirs.user, ...dirs.project];

			const header: string[] = [];
			header.push(`Mode: ${config.mode}`);
			header.push(`Config: ${sources.length > 0 ? sources.join(", ") : "(none, using defaults)"}`);
			for (const warning of warnings) header.push(`  ⚠ ${warning}`);

			if (scanned.length === 0 && dirs.skippedUntrusted.length === 0 && dirs.ignoredByConfig.length === 0) {
				ctx.ui.notify(`${header.join("\n")}\nNo .claude/skills/ directories found.`, "info");
				return;
			}

			// What pi actually loaded, keyed by canonical file path and by name.
			const loadedByPath = new Map<string, string>();
			const loadedByName = new Map<string, string>();
			for (const cmd of pi.getCommands()) {
				if (cmd.source !== "skill") continue;
				const name = cmd.name.replace(/^skill:/, "");
				loadedByPath.set(canonical(cmd.sourceInfo.path), name);
				loadedByName.set(name, cmd.sourceInfo.path);
			}

			const lines: string[] = [];
			let loadedCount = 0;
			for (const dir of scanned) {
				lines.push(dir);
				const entries = scanSkillDir(dir);
				if (entries.length === 0) lines.push("  (no SKILL.md found)");
				for (const entry of entries) {
					const loadedName = loadedByPath.get(canonical(entry.filePath));
					if (loadedName) {
						loadedCount++;
						lines.push(`  ✓ ${loadedName}`);
					} else if (entry.error) {
						lines.push(`  ✗ ${entry.filePath} — invalid: ${entry.error}`);
					} else if (entry.name && loadedByName.has(entry.name)) {
						lines.push(`  ✗ ${entry.name} — shadowed by ${loadedByName.get(entry.name)}`);
					} else {
						lines.push(`  ? ${entry.name ?? entry.filePath} — not loaded yet, run /reload`);
					}
				}
			}
			if (dirs.ignoredByConfig.length > 0) {
				lines.push("Ignored by config:");
				for (const dir of dirs.ignoredByConfig) lines.push(`  ${dir}`);
			}
			if (dirs.skippedUntrusted.length > 0) {
				lines.push("Skipped (project not trusted):");
				for (const dir of dirs.skippedUntrusted) lines.push(`  ${dir}`);
			}

			ctx.ui.notify(
				`Claude skills: ${loadedCount} loaded\n${header.join("\n")}\n${lines.join("\n")}`,
				warnings.length > 0 ? "warning" : "info",
			);
		},
	});
}

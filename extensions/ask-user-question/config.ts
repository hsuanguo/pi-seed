import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

const CONFIG_FILE_NAME = "pi-seed-config.json";
export const MAX_TIMEOUT_SECONDS = 86400;
export interface QuestionnaireConfig {
	timeoutSeconds: number;
}
export interface LoadedConfig {
	config: QuestionnaireConfig;
	warnings: string[];
}

function readConfigFile(path: string, warnings: string[]): Partial<QuestionnaireConfig> | undefined {
	if (!existsSync(path)) return undefined;
	let raw: unknown;
	try { raw = JSON.parse(readFileSync(path, "utf8")); }
	catch { warnings.push(`${path}: invalid JSON, ignored`); return undefined; }
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		warnings.push(`${path}: expected a JSON object, ignored`);
		return undefined;
	}
	for (const key of Object.keys(raw)) {
		if (!["claudeSkills", "scopedContext", "askUserQuestion"].includes(key)) warnings.push(`${path}: unknown section "${key}", ignored`);
	}
	const section = (raw as Record<string, unknown>).askUserQuestion;
	if (section === undefined) return {};
	if (typeof section !== "object" || section === null || Array.isArray(section)) {
		warnings.push(`${path}: "askUserQuestion" must be a JSON object, ignored`);
		return undefined;
	}
	const result: Partial<QuestionnaireConfig> = {};
	for (const [key, value] of Object.entries(section)) {
		if (key !== "timeoutSeconds") warnings.push(`${path}: unknown key "askUserQuestion.${key}", ignored`);
		else if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_TIMEOUT_SECONDS) result.timeoutSeconds = value;
		else warnings.push(`${path}: "askUserQuestion.timeoutSeconds" must be an integer from 0 to ${MAX_TIMEOUT_SECONDS}, ignored`);
	}
	return result;
}

/** Defaults ← user ← trusted project; invalid overrides keep earlier valid values. */
export function loadQuestionnaireConfig(cwd: string, projectTrusted: boolean, agentDir = getAgentDir()): LoadedConfig {
	const config: QuestionnaireConfig = { timeoutSeconds: 0 };
	const warnings: string[] = [];
	const files = [join(agentDir, CONFIG_FILE_NAME)];
	if (projectTrusted) files.push(join(resolve(cwd), CONFIG_DIR_NAME, CONFIG_FILE_NAME));
	for (const file of files) Object.assign(config, readConfigFile(file, warnings));
	return { config, warnings };
}

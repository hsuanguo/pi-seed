// Optional browser check against an unmodified, installed npm pi-web package.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
assert.ok(process.env.PI_WEB_PACKAGE_ROOT, "Set PI_WEB_PACKAGE_ROOT to the unmodified installed npm pi-web directory");
const host = resolve(process.env.PI_WEB_PACKAGE_ROOT);
const hostPackage = JSON.parse(readFileSync(join(host, "package.json"), "utf8"));
assert.equal(hostPackage.name, "@agegr/pi-web");
assert.ok(existsSync(join(host, ".next/BUILD_ID")), "Test the installed production build, not a patched dev checkout");
const nextBin = createRequire(join(host, "package.json")).resolve("next/dist/bin/next");
const sandbox = mkdtempSync(join(tmpdir(), "pi-seed-custom-ui-"));
const home = join(sandbox, "home"), agentDir = join(sandbox, "agent"), project = join(sandbox, "project");
const artifacts = join(root, "test-results/questionnaire-web");
for (const path of [home, project, artifacts, join(agentDir, "extensions"), join(agentDir, "fixture/questionnaire"), join(agentDir, "sessions/e2e")]) mkdirSync(path, { recursive: true });
for (const file of ["index.ts", "state.ts", "dialogs.ts", "tui.ts", "config.ts", "response-timeout.ts"]) {
	writeFileSync(join(agentDir, "fixture/questionnaire", file), readFileSync(join(root, "extensions/ask-user-question", file)));
}
const questions = [
	{ header: "Language", question: "Which language?", options: [{ label: "TypeScript", description: "Types", preview: "```ts\nconst x = 1;\n```" }, { label: "Python", description: "Scripts" }] },
	{ header: "Checks", question: "Which checks?", multiSelect: true, options: [{ label: "Unit", description: "Fast" }, { label: "Integration", description: "Real sessions" }] },
	{ header: "Verdict", question: "What should happen next?", options: [{ label: "Use it", description: "Keep the independent plugin" }, { label: "Adjust it", description: "More changes" }] },
];
writeFileSync(join(agentDir, "extensions/questionnaire-demo.ts"), `
import { questionTool } from "../fixture/questionnaire/index.ts";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
export default function (pi) {
  pi.registerCommand("questionnaire-demo", { handler: async (mode, ctx) => {
    writeFileSync(join(getAgentDir(), "pi-seed-config.json"), JSON.stringify({askUserQuestion:{timeoutSeconds:mode === "timeout" ? 4 : 0}}));
		const result = await questionTool.execute("demo", {questions:${JSON.stringify(questions)}}, ctx.signal, undefined, ctx);
		ctx.ui.notify("FORM_RESULT: " + JSON.stringify(result.details));
	}});
}
`);
const id = "custom-ui-browser-test", timestamp = "2026-10-06T00:00:00.000Z";
writeFileSync(join(agentDir, "sessions/e2e", `${timestamp.replaceAll(":", "-")}_${id}.jsonl`), [
	{ type: "session", version: 3, id, timestamp, cwd: project },
	{ type: "message", id: "root", parentId: null, timestamp, message: { role: "user", content: "Independent questionnaire fixture" } },
].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
let server, exited, browser, page;
const log = createWriteStream(join(artifacts, "server.log"));
const interrupt = () => { process.exitCode = 1; server?.kill("SIGTERM"); void browser?.close().catch(() => {}); };
process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
try {
	const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
	const port = probe.address().port; await new Promise((done) => probe.close(done));
	const base = `http://127.0.0.1:${port}`;
	server = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
		cwd: host, env: { PATH: process.env.PATH, HOME: home, LANG: "en_US.UTF-8", PI_CODING_AGENT_DIR: agentDir,
			PI_WEB_PASSWORD: "", PI_WEB_SKIP_VERSION_CHECK: "1", NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
	});
	exited = once(server, "exit"); server.stdout.pipe(log, { end: false }); server.stderr.pipe(log, { end: false });
	const deadline = Date.now() + 60000;
	while (!(await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(5000) }).catch(() => null))?.ok) {
		assert.equal(server.exitCode, null, "Server exited; inspect server.log"); assert.ok(Date.now() < deadline, "Server readiness timed out"); await delay(250);
	}
	browser = await chromium.launch({ ...(process.env.E2E_CHROMIUM_EXECUTABLE ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE } : {}) });
	for (const width of [1280, 390]) {
		const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "en-US" });
		await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
		page = await context.newPage(); page.setDefaultTimeout(30000);
		const errors = [], commands = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === `/api/agent/${id}`) commands.push(request.postDataJSON()); });
		await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
		await page.getByRole("paragraph").filter({ hasText: "Independent questionnaire fixture" }).waitFor();
		const start = async (mode = "") => {
			await page.locator("textarea").last().fill(`/questionnaire-demo ${mode}`.trim());
			await page.getByRole("button", { name: "Send", exact: true }).click();
			const dialog = page.getByRole("dialog"); await dialog.waitFor();
			await dialog.getByRole("button", { name: /1\. TypeScript/ }).waitFor();
			return dialog;
		};
		let panel = await start();
		const choice = (name, exact = false) => panel.getByRole("button", { name, exact });
		assert.equal(await choice("Back", true).count(), 0, "first question has no Back");
		await choice(/1\. TypeScript/).click();
		await choice("Back", true).waitFor();
		assert.deepEqual(await panel.locator("[data-extension-option]").evaluateAll((elements) => elements.slice(-2).map((element) => element.textContent.trim())), ["Continue", "Back"]);
		await choice(/\[ \] 1\. Unit/).click();
		await choice(/\[ \] 2\. Integration/).click();
		await choice(/\[x\] 1\. Unit/).click();
		await choice("Back", true).click();
		await choice(/\[x\] 1\. TypeScript/).waitFor();
		await choice(/2\. Python/).click();
		await choice(/\[x\] 2\. Integration/).waitFor();
		await panel.screenshot({ path: join(artifacts, `back-${width}.png`) });
		await page.reload({ waitUntil: "domcontentloaded" });
		panel = page.getByRole("dialog"); await panel.waitFor();
		await choice("Back", true).waitFor(); await choice(/\[x\] 2\. Integration/).waitFor();
		await choice("More actions", true).click(); await choice("Edit question note", true).click();
		await panel.getByRole("textbox").fill("Checks note"); await choice("Submit", true).click();
		await choice("Continue", true).click();
		await choice("Type something.", true).click();
		await panel.getByRole("textbox").fill("Custom verdict\nSecond line"); await choice("Submit", true).click();
		await choice("Submit answers", true).waitFor();
		await choice("Back", true).click();
		await choice(/^Type something\./).waitFor();
		await choice(/^Type something\./).click();
		assert.equal(await panel.getByRole("textbox").inputValue(), "Custom verdict\nSecond line");
		await choice("Cancel", true).click();
		await choice("Continue", true).click();
		await choice("Add global note", true).click();
		await panel.getByRole("textbox").fill("Overall note"); await choice("Submit", true).click();
		await choice(/^Edit 1\. Language/).click();
		await choice(/1\. TypeScript/).click();
		await choice("Submit answers", true).waitFor();
		assert.equal(await page.getByText(/^FORM_RESULT:/).count(), 0, "nothing returns before explicit Submit");
		await panel.screenshot({ path: join(artifacts, `review-${width}.png`) });
		await choice("Submit answers", true).click(); await panel.waitFor({ state: "hidden" });
		const result = page.getByText(/^FORM_RESULT:.*"status":"submitted"/); await result.waitFor();
		const value = JSON.parse((await result.innerText()).replace(/^FORM_RESULT:\s*/, ""));
		assert.equal(value.answers[0].answer, "TypeScript"); assert.deepEqual(value.answers[1].selected, ["Integration"]);
		assert.equal(value.answers[1].notes, "Checks note"); assert.equal(value.answers[2].answer, "Custom verdict\nSecond line"); assert.equal(value.globalNote, "Overall note");
		await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
		panel = await start();
		await choice(/1\. TypeScript/).click(); await choice("Back", true).waitFor();
		await choice("Cancel", true).click(); await panel.waitFor({ state: "hidden" });
		const cancelled = page.getByText(/^FORM_RESULT:.*"status":"cancelled"/).last(); await cancelled.waitFor();
		const cancelValue = JSON.parse((await cancelled.innerText()).replace(/^FORM_RESULT:\s*/, ""));
		assert.deepEqual(cancelValue.answers, []); assert.ok(!("globalNote" in cancelValue));
		assert.equal(commands.some((command) => command.type === "abort"), false, "Cancel belongs to the questionnaire, not agent Stop");
		await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
		panel = await start("timeout");
		assert.equal(await choice("Turn off timeout", true).count(), 0);
		await panel.getByText(/expires in/).waitFor();
		await panel.waitFor({ state: "hidden" });
		const timed = page.getByText(/^FORM_RESULT:.*"status":"timed_out"/).last(); await timed.waitFor();
		const timedValue = JSON.parse((await timed.innerText()).replace(/^FORM_RESULT:\s*/, ""));
		assert.deepEqual(timedValue.answers, []);
		await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
		panel = await start("timeout");
		await choice("Type something.", true).click();
		await panel.getByRole("textbox").waitFor();
		assert.equal(await panel.getByText(/expires in/).count(), 0, "opening an editor stops the timer");
		await delay(4300);
		assert.equal(await panel.isVisible(), true, "an editor may outlast the configured limit");
		await panel.getByRole("textbox").fill("Present user");
		await choice("Submit", true).click();
		assert.equal(await panel.getByText(/expires in/).count(), 0, "no countdown after any response");
		await delay(4300);
		assert.equal(await panel.isVisible(), true, "the timer stays off after a response");
		await choice("Cancel", true).click(); await panel.waitFor({ state: "hidden" });
		assert.deepEqual(errors, []);
		console.log(`PASS: unmodified pi-web ${hostPackage.version}, ${width}px native dialogs, Back, answer preservation, unattended timeout, response stops timer, notes, review and Cancel`);
		await context.close(); page = undefined;
	}
} catch (error) {
	console.error(error); process.exitCode = 1;
	if (page) await page.screenshot({ path: join(artifacts, "failure.png") }).catch(() => {});
} finally {
	await browser?.close().catch(() => {});
	if (server && server.exitCode === null && server.signalCode === null) { server.kill("SIGTERM"); const timer = setTimeout(() => server.kill("SIGKILL"), 10000); await exited; clearTimeout(timer); }
	log.end(); rmSync(sandbox, { recursive: true, force: true }); process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
}

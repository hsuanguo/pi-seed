import type { Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { getThemeByName } from "../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { setKeybindings, type TUI } from "@earendil-works/pi-tui";

/** Real pi components/themes/keybindings, but no terminal or live settings. */
export function tuiHarness() {
	const keys = new KeybindingsManager();
	setKeybindings(keys);
	const theme: Theme = getThemeByName("dark")!;
	const terminal = { rows: 40, columns: 120 };
	// SAFETY: this rendering harness provides the terminal dimensions and requestRender used by the real components.
	const tui = { terminal, requestRender() {} } as unknown as TUI;
	return { tui, terminal, theme, keys };
}

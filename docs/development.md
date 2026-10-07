# Development

Keep contributions small and focused on making this shared starting point simpler or more reliable. The root [AGENTS.md](../AGENTS.md) covers development conventions and installer compatibility. Run `npm ci --ignore-scripts && npm run check` before submitting: tests run in disposable directories and never touch your pi settings or sessions. Use `pi -e ./` to try this checkout for one run.

Run `pre-commit run --all-files` (Gitleaks) before pushing.

## Trying a personal questionnaire extension

Update **one** active extension copy, then run `/reload`; keep using the normal `pi-web` command. If you use a personal copy, back it up outside the autoloaded `extensions/` directory before copying the complete extension files (including `config.ts` and `response-timeout.ts`):

```bash
agentDir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
backup="$agentDir/backups/questionnaire-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a "$agentDir/extensions/ask-user-question" "$backup/"
cp extensions/ask-user-question/*.ts "$agentDir/extensions/ask-user-question/"
```

Do not load a packaged copy alongside this personal copy: both register the same tool name. The extension works with the normal, unmodified pi-web host.

## Optional browser verification

The credential-free suite tests state and real pi sessions with `npm run check`. The optional browser suite uses an **unmodified installed npm pi-web build** on a free loopback port, with temporary HOME and agent directories and no inherited model credentials. It does not build or edit the host, access your real sessions, or call a paid model.

```bash
npx playwright install chromium
PI_WEB_PACKAGE_ROOT=/path/to/node_modules/@agegr/pi-web npm run test:questionnaire-web
```

You can set `E2E_CHROMIUM_EXECUTABLE` to an existing Chromium executable instead. The test covers 1280px and 390px native dialogs, Continue/Back order, returning and changing answers, multi-selection, both note scopes, custom text, active-request refresh, review, Submit, Cancel, unattended expiry, and a response stopping the timer. Results go to the ignored `test-results/questionnaire-web/` directory. These viewport checks do not claim real Safari/iOS coverage. See [`assets/questionnaire-back.png`](../assets/questionnaire-back.png) for an actual unmodified-host screenshot.

# Structured questions

The model calls `ask_user_question` when it needs a decision. Each question has a header (up to 16 characters) and 2–4 options with labels (up to 60 characters) and descriptions. The tool automatically adds a custom-answer control. Only **Submit answers** sends the answers and notes to the model. All questions must be answered; an explicitly empty multi-selection is valid. Cancelling or interrupting discards unsubmitted drafts instead of treating them as decisions.

- **Terminal:** Tab / Shift+Tab or ← / → switches question and Review tabs. ↑ / ↓ moves between options. Enter selects; Space toggles multiple choices. The custom-answer row opens a multiline editor: Enter saves, Shift+Enter adds a line, Ctrl+U clears, and Esc returns without changing the committed answer. Text drafts survive tab switches. `n` edits a question note, or a global note on Review. PgUp / PgDn scrolls question details and Markdown previews; wide screens show them beside the options. Ctrl+] hides/shows the overlay to read the transcript. Esc outside the editor cancels the entire questionnaire.
- **Unmodified pi-web / RPC:** Keeps the host's ordinary mouse-friendly `select()` / `editor()` dialogs, even when it offers `custom()`. No host fork, private API, extra server, port, or frontend patch is required. Questions appear at the top, then the answer choices and secondary actions. Available navigation comes at the end: **Continue**, then **Back**. The first question has no Back. A fresh single-select question has no Continue until it has an answer. Back returns to the previous question without clearing any answers. Review also offers Back to return to the last question. These controls are normal option-list buttons, not additions to the host's fixed Cancel footer. The host controls their styling and one-column layout. Multi-select uses clickable `[ ]` / `[x]` rows. Single choices advance automatically; multi-selection stays until Continue. **More actions** contains full question/option details, previews, question notes, and a shortcut to review. Custom answers use an editor with the previous text prefilled. Review has a short title and compact answer summaries in the Edit rows (multiple choices show the first choice plus a count); it does not repeat every full question. Global notes remain editable there. To inspect a full answer or note, open its Edit row, then Details & previews or the text editor. Only display text is shortened; submitted data stays complete. The host owns the Cancel button: dismissing a main question/review cancels the questionnaire; dismissing an editor, More actions, or details returns to the parent question. Button styles and layout still come from the host; this is not a custom Web form.
- **Print / JSON:** The tool reports that no UI is available and tells the model to ask in plain chat. It does not claim the user declined.
- The tool is model-only and sequential: codemode cannot invoke it, and sibling tool calls cannot open overlapping questionnaires. Submitted data is stored in the tool result, so it follows the active session branch.

## Optional no-response timeout

Set `askUserQuestion.timeoutSeconds` in the shared `pi-seed-config.json`, for example:

```json
{
  "askUserQuestion": {
    "timeoutSeconds": 120
  }
}
```

The default is `0` (disabled). User configuration applies everywhere; a trusted project can override it, including setting `0`. Invalid values warn and do not replace an earlier valid value. The tool reads this configuration for each call; it does not change your settings, context files, or configuration on disk.

It is meant for **unattended runs**, not to hurry a present user:

- The countdown starts when the questionnaire opens. The host shows its ordinary expiry countdown on the first dialog; the TUI shows it in its status line.
- The **first user response** turns the timer off for the rest of that questionnaire: any native dialog choice (an answer, Back, Continue, a menu, or opening an editor) or any key in the TUI. From then on the questionnaire waits indefinitely, as when the timeout is disabled.
- There is no UI switch to disable it; answering is enough.
- The native extension API cannot report mouse movement, hovering, or scrolling. Those do not count as a response. Stop/reload still use normal host cancellation.

Expiry closes the waiting selector/TUI and returns `status: "timed_out"` with no submitted answers or notes. Manual Cancel stays `cancelled`; Stop stays `aborted`. The compatibility `cancelled` flag means "not submitted"; use `status` for the reason. Timer cleanup prevents old expiry callbacks or late responses from affecting a later questionnaire.

The Agent receives a normal tool result: it may state reasonable assumptions and continue **already-authorized, low-risk work**. No extra model call is launched by the extension. Timeout is not consent, not a user selection, and not permission to perform approval-gated actions. If approval or essential data is still needed, the result tells the Agent to leave that action blocked rather than infer consent. Unsubmitted drafts are never promoted to answers by timeout.

This is an independent implementation inspired by [`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question) (MIT). It keeps the question parameter shape and core questionnaire workflow, not the upstream localization, notification events, external editor integration, or configuration system.

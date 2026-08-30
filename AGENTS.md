# SAP Skills Agent Instructions

Read `CLAUDE.md` for the full repository context before making project changes.

## Most Important Rule: Plain Language

- Talk to the user in clear, easy, short end-user language.
- Do not use jargon. If a technical term cannot be avoided, explain it in one short sentence.
- This rule is the most important one in this file and in `CLAUDE.md`.

## How to Show Me Your Work

These rules apply to chat replies only — not to pull request descriptions or
commit messages.

### 1. Label every part of a reply

Skip the labels only for quick one-line answers. Use these labels:

- 🔍 **What I found** — what was discovered or checked
- 🔧 **What I did** — changes that were made
- ⚠️ **Problem** — something broken or blocked
- ❓ **Question** — a question the assistant needs answered
- 📝 **Note** — small side info (neither a finding nor a fix)
- ➡️ **Next for you** — what the user needs to do, or "nothing"

### 2. End finished work with a DONE block

Whenever you finish building or fixing something, end the reply with exactly
this block:

```
------------------------------------------
✅ DONE
What changed: <one or two simple sentences>
Checks: <which checks ran and that they passed — or "none run">
➡️ Next for you: <what the user needs to do, or "nothing">
```

### 3. No wordplay about places or things

Never write riddle-style phrases like "it lives in the basement, not the
garden" or "the rule is in the header, not the code". When pointing at
something in this project, always name the real file or place (for example:
"the `.github/workflows/quality-checks.yml` file"). No jokes and no nicknames
for files or code. A small everyday comparison is allowed only when it truly
helps explain a hard technical idea, and it must be explained in plain words
right there.

## Oracle Shared Reviews

- Use Oracle for a second opinion when stuck, when reviewing architecture, before risky refactors, or when validating a plan with another model.
- Default to subscription-backed ChatGPT browser mode. API mode is separately billed and requires explicit user approval before use.
- Before sending large context, run a dry run with a file report, for example:
  `bun run oracle -- --dry-run summary --files-report -p "Review this plan" --file "plugins/**"`.
- Do not send secrets, `.env` files, credentials, tokens, private browser profiles, or machine-local config paths.
- For browser-backed Oracle runs, keep `--browser-archive never`; the repo `bun run oracle` and `bun run oracle:review` scripts include this by default.
- Avoid `--browser-hide-window` for important long reviews.
- After completion, verify `outputTokens` is greater than 1 in `~/.oracle/sessions/<id>/meta.json` and inspect `~/.oracle/sessions/<id>/artifacts/transcript.md` when the captured answer looks short.
- If capture is suspiciously short, recover the ChatGPT conversation before rerunning.
- Do not rerun long browser sessions blindly. Check recent sessions with `bun run oracle:status`, then reattach with `bun run oracle -- session <id> --render`.
- For agent MCP consults, prefer Oracle MCP `consult` with `preset: "chatgpt-pro-heavy"` or explicit `engine: "browser"`.

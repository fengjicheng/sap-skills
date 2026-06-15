# SAP Skills Agent Instructions

Read `CLAUDE.md` for the full repository context before making project changes.

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

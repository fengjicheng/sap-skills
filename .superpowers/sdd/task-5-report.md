# Task 5 — Gate unsigned-bundle deploy (Node side) — Report

## Commit
`bb8db0052ea3bed3c898501e6ec7a48a5b9abcff` — `fix(bw-query): gate unsigned-bundle deploy and reclassify deploy/rollback (finding #2)`

## Files changed (with line refs)

### `plugins/sap-bw-query/mcp/src/tool-registry.mjs`
- Line 128: `bw_studio_deploy` now declared as `tool(..., "destructive", true)`.
- Line 130: `bw_studio_rollback` now declared as `tool(..., "destructive", true)`.
- All other tool registrations unchanged.

### `plugins/sap-bw-query/mcp/src/server.mjs`
- Line 73: `destructiveHint: false,` → `destructiveHint: tool.operationClass === "destructive",`.
- `readOnlyHint`, `idempotentHint`, `openWorldHint` logic unchanged.

### `plugins/sap-bw-query/mcp/src/tool-handlers.mjs`
- Line 1: added `import fs from "node:fs";`.
- Lines 40–63 (approx): replaced the one-liner `bw_studio_deploy: (input) => studio.run("Deploy", input)` with an async handler that:
  1. Tries to `JSON.parse(fs.readFileSync(input.manifestPath, "utf8"))` and read `keyId`. On any read/parse error throws `{ code: "MANIFEST_UNREADABLE" }` with a generic message.
  2. If `keyId === "LOCAL-UNSIGNED"` AND `process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE !== "1"`, throws `{ code: "UNSIGNED_BUNDLE_NOT_ALLOWED" }` with the brief-specified message (no manifest content beyond keyId).
  3. Otherwise returns `studio.run("Deploy", input)`.
- `bw_studio_launch`, `bw_studio_rollback` untouched. `wrap()` and `assertNoSecrets` untouched.

### `tests/sap-bw-query/tool-registry.test.mjs`
- Replaced the old "only prepare-new-save …" test (lines 43–54) with "prepare-new-save is a tenant mutation; deploy/rollback are destructive; all require approval" — keeps the same intent but updates the destructive carve-out for `bw_studio_deploy` and `bw_studio_rollback`.
- Added "bw_studio_deploy and bw_studio_rollback are classified destructive with approval required" — explicit assertions on `operationClass === "destructive"` and `approvalRequired === true` for both.

### `tests/sap-bw-query/handler-runtime.test.mjs`
- Added `import fs`, `import os`.
- Added helpers `writeManifest(keyId)`, `writeMalformedManifest()`, `studioSpy()`.
- 4 new tests at end of file:
  1. Unsigned manifest + no env → rejects `UNSIGNED_BUNDLE_NOT_ALLOWED`, `studio.run` not called (calls.length === 0).
  2. Unsigned manifest + `BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE=1` → proceeds, `studio.run("Deploy", input)` called once. Env cleaned up in `finally`.
  3. Signed manifest (`sap-skills-release-2026`) + no env → proceeds without opt-in.
  4. Malformed manifest JSON → rejects `MANIFEST_UNREADABLE`, `studio.run` not called.

## Test results

### Single files (post-impl, green)
```
node --test tests/sap-bw-query/tool-registry.test.mjs
  → tests 4, pass 4, fail 0, skipped 0

node --test tests/sap-bw-query/handler-runtime.test.mjs
  → tests 16, pass 16, fail 0, skipped 0
```

### Full sap-bw-query suite (TAP reporter)
Pre-impl baseline (stash):
```
# tests 141  # pass 132  # fail 7  # skipped 2  # cancelled 0
```

Post-impl:
```
# tests 146  # pass 137  # fail 7  # skipped 2  # cancelled 0
```
Net change: +5 tests, +5 passing. Pre-existing 7 fail / 2 skip unchanged — the 7 failures are the known `powershell.exe`-dependent tests in `deployer-contract.test.mjs` (6) and `studio-service.test.mjs` (1: "status works without an installed studio …"), all of which require Windows tooling absent on this host.

## Concerns
- None. The gate reads the manifest only to inspect `keyId`; nothing else from the file is logged or surfaced in error messages. Env-var cleanup is in `finally` blocks. The handler signature change from sync to async is safe because `wrap()` already `await`s the handler.

## Critical fix

**Finding (Critical, post-Task-5 review):** The unsigned-bundle gate in `bw_studio_deploy` (`plugins/sap-bw-query/mcp/src/tool-handlers.mjs`) was bypassable. The tool schema marks `manifestPath` as optional, and the gate logic read the manifest only inside `if (input?.manifestPath) { ... }`. When a caller omitted `manifestPath`, the manifest-read block was skipped, `keyId` stayed `undefined`, neither the `MANIFEST_UNREADABLE` nor the `UNSIGNED_BUNDLE_NOT_ALLOWED` branch fired, and the handler fell through to `studio.run("Deploy", input)` with **no gate applied**. A prompt-injected caller could exploit this to deploy arbitrary code by simply omitting `manifestPath`.

**Fix:** At the top of the `bw_studio_deploy` handler, before any `studio.run` call, reject hard when `manifestPath` is absent (undefined, null, or empty string):

```js
if (!input?.manifestPath) {
  const err = new Error("A deploy manifest path is required; refusing to forward an unverified deploy.");
  err.code = "MANIFEST_UNREADABLE";
  throw err;
}
```

The subsequent manifest-read block no longer needs its `if (input?.manifestPath)` guard and was simplified to an unconditional read. The tool schema in `tool-registry.mjs` is intentionally unchanged (`manifestPath` stays schema-optional) so that the failure surfaces as an actionable `MANIFEST_UNREADABLE` error rather than a generic schema rejection.

**New test:** `bw_studio_deploy rejects when manifestPath is omitted` in `tests/sap-bw-query/handler-runtime.test.mjs` — calls the handler with `{}` (no `manifestPath`), asserts it rejects with `code: "MANIFEST_UNREADABLE"`, and asserts the `studioSpy` was not called (`spy.calls.length === 0`). Written TDD-style (red first, then fix → green).

**Verification:** Full suite re-run: 147 tests / 138 pass / 7 fail / 2 skip (the +1 test, +1 pass vs. the 146/137 baseline from Task 5). The 4 existing gate tests still pass.

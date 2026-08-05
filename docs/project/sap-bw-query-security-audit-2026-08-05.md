# SAP BW Query Plugin — Security Audit & Hardening (2026-08-05)

**Target:** `plugins/sap-bw-query/` (v0.3.0) — MCP server + Eclipse plugin driving SAP BW Query Design
**Branch:** `fix/sap-bw-query-security-hardening` (off `main` @ `fab70ad`)
**Method:** 3 adversarial exploration agents (architecture, security, Mac feasibility) + controller verification of every Critical/High finding + subagent-driven-development execution (fresh implementer + task reviewer per task) with TDD.
**Scope of fixes:** all 9 findings. Node-side logic is TDD-covered on macOS; PowerShell/Java changes are source-text-asserted on macOS with runtime validation deferred to the `windows-2025` CI leg (see the companion [Windows validation handoff](sap-bw-query-windows-validation-handoff.md)).

---

## How the AI connects to the plugin (the embedded question, answered)

The MCP↔Eclipse link is a **Windows named pipe** whose name both sides derive independently from the per-user home directory — no path is ever exchanged or configured by the user:

- **Pipe name:** `\\.\pipe\bw-automation-<sha256(home)[0:16]>` (`mcp/src/bridge-broker.mjs:21-24`, mirrored in `scripts/BwStudio.ps1` `Get-BridgePipeName`, and read in Eclipse via `-Dbw.automation.pipe=<name>` at `BridgeLoop.java:39`).
- **Wire-up:** `.mcp.json` → `powershell.exe Start-BwMcp.ps1` → Node MCP server (`mcp/src/server.mjs`) creates the pipe; `BwStudio.ps1 Start-Studio` launches `eclipse.exe` with the derived pipe name; `BridgeLoop` opens it with `RandomAccessFile`. Single connection slot, 15s timeout.

---

## Findings & fix status

| # | Sev | Finding | Fix (commit) | Mac-TDD? |
|---|-----|---------|--------------|----------|
| 1 | High | Bridge named pipe: no auth token, no DACL — any same-user local process could connect and drive all allow-listed methods | `2ad6c0d` — per-session 32-byte token (Node); `625d0f1` — Java sends auth frame | Node ✅; Java source-asserted, Windows CI runtime |
| 2 | High | Unsigned-local bundle deploy → RCE (`trusted-publishers.json` ships `keys:[]`, so signed mode unusable) | `bb8db00` + `6cc8957` (Node gate + manifestPath-omission critical fix); `e2a39ef` (PS default-deny) | Node ✅; PS source-asserted, Windows CI runtime |
| 3 | High | `bw_connection_import_landscape` arbitrary local-file read | `ebcfef9` — confined to `<home>/landscapes` + opt-in `BW_AUTOMATION_LANDSCAPE_ALLOW_DIR` | ✅ fully |
| 4 | Med | Raw BW content returned to AI → prompt-injection vector | `6e39df1` — `markResponseUntrusted` on 5 read-only-tenant handlers | ✅ fully |
| 5 | Med | `secret-guard.mjs` keylist/regex gaps (missed `authorization`, `accesstoken`, bare `Bearer …`, zero-width unicode) | `023535c` (Node); `625d0f1` (Java mirror) | Node ✅; Java source-asserted |
| 6 | Med | Release-channel SSRF — no host allowlist (HTTPS scheme only) | `e544d40` + `a6f0613` (IPv6 `fe80::/10` critical fix) — `Test-ReleaseHostAllowed`, default-deny private ranges, opt-in strict allowlist | PS source-asserted, Windows CI runtime |
| 7 | Med | `BW_AUTOMATION_PLUGIN_COMMIT="source-commit"` inert placeholder | `0a30d7f` — build emits real `dist/provenance.json`; server surfaces via `bw_studio_status` | ✅ fully |
| 8 | Low | Forced `-ExecutionPolicy Bypass` | **No code change (documented).** Args are array-spawned (no `shell:true`), so classic injection is blocked; `Bypass` is required for locked-down Windows policies. See handoff. | n/a |
| 9 | Low | Desktop `.lnk` out-of-home write on every deploy | `e544d40` — opt-in via `BW_AUTOMATION_CREATE_SHORTCUTS=1` (was opt-out) | PS source-asserted, Windows CI runtime |

---

## Solid controls that existed BEFORE this hardening (unchanged, respected by every fix)

- **No auto-save anywhere.** Every mutating path (`populateQueryEditor`) leaves saving to the human (`QueryEditorGateway.java` instruction: "press Save yourself; the automation never saves").
- **Overwrite of existing queries blocked at 3 independent layers:** `draft-state.mjs:86-88` (duplicate technical name), `QueryEditorGateway.java:49-53` (read-only refusal) + `61-68` (non-empty refusal), binding-hash match.
- **Zero destructive BW tools** — no delete/drop/release/transport/activate. `CapabilityProbe.java:46-47` advertises `deleteSupported:false`, `overwriteSupported:false`.
- `spawn` with array args + no `shell:true` (`studio-service.mjs:41`) — classic shell injection blocked.
- `assertNoSecrets` runs on BOTH request payloads and bridge responses (`bridge-broker.mjs:101,110`; `tool-handlers.mjs:12`).
- Append-only deploys with content-addressing (never overwrite/delete); hash-pinned external downloads; zip-slip protection (`Test-ArchivePaths`); bundle inventory SHA-512 verified; `npm ci --ignore-scripts`.

---

## Test results

**Baseline (before):** `node --test tests/sap-bw-query/*.test.mjs` → 114 tests / 105 pass / 7 fail / 2 skip
**Final (after):** 160 tests / 151 pass / 7 fail / 2 skip

- **+46 tests, +46 passing, 0 new failures.**
- The 7 failures + 2 skips are unchanged and are all Windows-only (`powershell.exe` ENOENT on macOS — they spawn PowerShell for the deploy/rollback/signature flows). They run on the `windows-2025` CI leg.

### Known pre-existing flake (not introduced by this branch)
`tests/sap-bw-query/query-runtime.test.mjs` "local drafts can be recovered from an append-only journal" occasionally fails in ISOLATED runs under parallel-scheduling pressure. It passes in the full suite. `draft-state.mjs` was NOT touched by this branch. Flagged for separate follow-up.

---

## Per-finding detail (evidence + fix)

### Finding #1 — Bridge pipe auth (High)
**Evidence:** `bridge-broker.mjs:43,60` created the pipe with `net.createServer().listen(pipePath)` and accepted the first connector with no token check; no SDDL/DACL/`NT AUTHORITY` anywhere.
**Fix:** `BridgeBroker` now generates `crypto.randomBytes(32).toString("hex")` (or reads `BW_AUTOMATION_BRIDGE_TOKEN`), publishes it to `process.env` so BwStudio.ps1 inherits it, and requires the first JSON frame `{"authToken":"<token>"}` from a connecting socket. Unauthorized → `BRIDGE_UNAUTHORIZED` + close. Silent-client timeout. Single-slot + `#pendingAuth` race-safe (auth-success→`#socket` assignment is synchronous). `BwStudio.ps1 Start-Studio` forwards the inherited env var to the JVM as `-Dbw.automation.bridgeToken=$env:BW_AUTOMATION_BRIDGE_TOKEN` (final-review critical fix), and Java `BridgeLoop` reads that property and sends the auth frame on connect (`625d0f1`).
**Minor residuals (for triage):** (a) `authBuffer` unbounded growth on malicious pre-auth garbage stream (bounded by 15s timeout in practice; cheap fix: cap at 8KB); (b) non-constant-time token compare (documented, local-only threat model, revisit if transport becomes networked).

### Finding #2 — Unsigned-bundle deploy → RCE (High)
**Evidence:** `BwStudio.ps1:314-316` accepted `keyId === "LOCAL-UNSIGNED"` from any local path; `config/trusted-publishers.json` ships `"keys": []` so signed mode was unusable; `bw_studio_launch` then executes the bundle's `eclipse.exe`.
**Fix (defense in depth, 3 layers):**
1. Node gate (`bb8db00`): `bw_studio_deploy` reclassified `destructive` + `approvalRequired:true`; handler reads the manifest's `keyId`, throws `UNSIGNED_BUNDLE_NOT_ALLOWED` unless `BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE=1`.
2. **Critical fix (`6cc8957`):** the original gate was bypassable by omitting `manifestPath` — now throws `MANIFEST_UNREADABLE` if absent. Verified robust against 11 bypass vectors.
3. PS gate (`e2a39ef`): `Resolve-ManifestTrust` independently requires the env var (mirrors Node gate).

### Finding #3 — importLandscape arbitrary file read (High)
**Evidence:** `connection-store.mjs:88` did `fs.readFileSync(path.resolve(landscapePath))` with no confinement.
**Fix (`ebcfef9`):** `#resolveConfinedLandscapePath` allows only `<root>/landscapes` + opt-in `BW_AUTOMATION_LANDSCAPE_ALLOW_DIR`. Robust against rooted/UNC/`..`-escape; prefix-without-separator trap handled (`<root>/landscapes2/foo` rejected).

### Finding #4 — Prompt injection via raw BW content (Med)
**Evidence:** `ProviderMetadataGateway.java:128-135` and `QueryModelReader.java` return InfoObject names/descriptions/formula expressions raw to the AI.
**Fix (`6e39df1`):** new `untrusted-content.mjs` `markResponseUntrusted` adds a top-level `_untrustedContent: { source, warning }` marker (lossless — all data preserved) to the 5 read-only-tenant handlers (`bw_describe_provider`, `bw_list_queries`, `bw_read_query`, `bw_read_query_model`, `bw_review_query`).

### Finding #5 — secret-guard gaps (Med)
**Evidence:** `secret-guard.mjs:1-9` keylist missed `authorization`, `accesstoken`, `accesskey`, `bearer`, `authtoken`, `refreshtoken`; `LABELED_SECRET` regex required `label=value` so bare `"Bearer …"` passed; no zero-width/compat-form handling.
**Fix (`023535c`):** extended keylist + suffix list; new `BEARER_TOKEN_PATTERN` for bare `Bearer/Basic/Token …` values (applied in both `visit` and `sanitizeForLog`); `normalizedKey` now does NFKC → strip zero-width (`\u200B-\u200D,\uFEFF,\u2060`) → strip non-alphanumerics → lowercase. Java `BridgeLoop.SECRET_KEYS` + `StepJournal.LABELED_SECRET` mirrored (`625d0f1`).

### Finding #6 — Release-channel SSRF (Med)
**Evidence:** `Save-HttpsDownload` (`BwStudio.ps1:82-91`) checked HTTPS scheme only; the 4 channel-URL fetches had no host validation.
**Fix (`e544d40` + `a6f0613`):** `Test-ReleaseHostAllowed` default-denies RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127/8, ::1), link-local (169.254/16, **fe80::/10**), ULA (fc00::/7), 0.0.0.0, `.local`/`.internal`; DNS fail-closed; `BW_AUTOMATION_RELEASE_HOST_ALLOWLIST` (semicolon-separated) enables strict-allowlist mode. Applied via `-RestrictToReleaseAllowlist` at all 4 download sites. **Critical fix (`a6f0613`):** the original `fe80::/10` check was wrong (comment claimed it was a subset of `fc00::/7` — mathematically false); added explicit `byte0==0xFE && (byte1 & 0xC0)==0x80` check, verified against 5 test vectors.

### Finding #7 — Inert provenance pin (Med)
**Evidence:** `.mcp.json:13` set `BW_AUTOMATION_PLUGIN_COMMIT="source-commit"` — a literal placeholder nothing read.
**Fix (`0a30d7f`):** `build.mjs` resolves the real commit (env override if 40-hex & ≠ placeholder → `git rev-parse --verify HEAD` → THROW if neither) and writes `dist/provenance.json`; `server.mjs` `loadProvenance()` loads it once, surfaces via `bw_studio_status`. Never returns the literal `"source-commit"`.

### Finding #8 — Forced `-ExecutionPolicy Bypass` (Low) — NO CODE CHANGE
Args are array-spawned (`spawn("powershell.exe", args, …)` with no `shell:true`), so metacharacters aren't interpreted. `Bypass` is required for the launcher to run on Windows systems with restrictive ExecutionPolicy; removing it would break deployment on locked-down machines. Documented as an accepted design choice.

### Finding #9 — Desktop .lnk out-of-home write (Low)
**Evidence:** `Set-DesktopShortcuts` (`BwStudio.ps1:331-367`) wrote `.lnk` to the visible Desktop (possibly OneDrive-synced) on every deploy unless `BW_STUDIO_NO_SHORTCUT`/`$env:CI`.
**Fix (`e544d40`):** now opt-IN — shortcuts created only if `BW_AUTOMATION_CREATE_SHORTCUTS=1`. `$env:CI` still skips; `BW_STUDIO_NO_SHORTCUT` retained as secondary. Intentional breaking change for AI-driven deploys (no more surprise desktop clutter).

---

## Commits (chronological)

```
ebcfef9 fix(bw-query): confine importLandscape to allow-listed roots (finding #3)
023535c fix(bw-query): widen secret-guard keylist and bare-token coverage (finding #5)
0a30d7f fix(bw-query): emit real commit provenance at build time (finding #7)
6e39df1 fix(bw-query): mark BW-originated responses as untrusted content (finding #4)
bb8db00 fix(bw-query): gate unsigned-bundle deploy and reclassify deploy/rollback (finding #2)
6cc8957 fix(bw-query): reject deploy when manifestPath is omitted (finding #2 critical fix)
2ad6c0d fix(bw-query): require per-session auth token on bridge connection (finding #1)
e544d40 fix(bw-query): add release-host SSRF allowlist and make desktop shortcuts opt-in (findings #6,#9)
a6f0613 fix(bw-query): reject IPv6 link-local fe80::/10 in SSRF allowlist (finding #6 critical fix)
625d0f1 fix(bw-query): mirror pipe auth token and widened secret keylist on Java side (findings #1,#5)
e2a39ef fix(bw-query): require explicit opt-in for unsigned bundle deploy on PowerShell side (finding #2)
```

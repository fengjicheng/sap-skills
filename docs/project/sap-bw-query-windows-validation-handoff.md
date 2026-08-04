# SAP BW Query Plugin — Windows Validation Handoff

This is a self-contained runbook for validating the **Windows-only halves** of the security hardening in branch `fix/sap-bw-query-security-hardening`. The Node-side logic is fully TDD-covered on macOS, but several fixes touch PowerShell and Java that can only be runtime-validated on Windows (the `windows-2025` CI leg, or a real Windows box with the deployed BW Modeling Tools bundle).

Companion document: [Security audit & hardening summary](sap-bw-query-security-audit-2026-08-05.md).

---

## What CANNOT be validated on macOS

| Layer | Why it needs Windows |
|-------|----------------------|
| **MCP server `main()` end-to-end** | `server.mjs:main()` requires `LOCALAPPDATA`/`BW_AUTOMATION_HOME` and binds a Windows named pipe (`\\.\pipe\…`). UNIX sockets work for unit-testing the auth handshake, but the real launch path is Windows. |
| **PowerShell launchers** (`scripts/Start-BwMcp.ps1`, `scripts/BwStudio.ps1`) | `powershell.exe`, `$env:LOCALAPPDATA`, `\\?\` long-path prefix, `curl.exe`/`tar.exe`, COM `WScript.Shell`, `eclipse.exe`. `pwsh` on Mac does NOT rescue these — they bottom out in Windows binaries/env. |
| **Eclipse plugin (Java/OSGi)** | Java 21, BWMT 1.27.36 from the Windows-only SAP update site, win32 Eclipse SDK, SapMachine win-x64. No `pom.xml`/Tycho — compiled imperatively inside `Build-BwStudio.ps1` via `javac --release 21`. |
| **Bundle builder + signed release round-trip** | `Build-BwStudio.ps1` shells to `eclipsec.exe` p2 director, `javac.exe`, `jar.exe`. |
| **Java `StandaloneSmoke` round-trip** | Needs the BWMT model jars from a deployed bundle. |

The 7 pre-existing macOS test failures + 2 skips are exactly these — they spawn `powershell.exe` or test Windows named pipes. They are **expected** to fail on macOS and **must pass** on Windows.

---

## What this branch added that needs Windows runtime validation

### Finding #1 — Bridge pipe auth (Node `2ad6c0d` + Java `625d0f1`)
**To validate on Windows:**
1. Deploy a signed bundle (or unsigned with the opt-in, see below) into `%LOCALAPPDATA%\BWAutomationStudio`.
2. Launch Eclipse via `BwStudio.ps1 -Action Launch` — it reads `BW_AUTOMATION_BRIDGE_TOKEN` (set by the Node server) and passes `-Dbw.automation.bridgeToken=<token>`.
3. Confirm the Node MCP server (`Start-BwMcp.ps1`) starts, generates a token, and Eclipse's `BridgeLoop` connects + sends the auth frame successfully (sidebar journal shows "Bridge authenticated" in GREEN).
4. **Negative test:** kill Eclipse, start a rogue `net.createConnection` to the pipe with a WRONG token → expect `BRIDGE_UNAUTHORIZED` + socket close; confirm `broker.call(...)` rejects.
5. The existing Windows-only test `named-pipe request and response stay local and correlate by id` (`tests/sap-bw-query/bridge-runtime.test.mjs`, `{ skip: process.platform !== "win32" }`) now includes the auth handshake — it must pass on Windows.

### Finding #2 — Unsigned-bundle gate (Node `bb8db00`+`6cc8957`, PS `e2a39ef`)
**To validate on Windows:**
1. Confirm `bw_studio_deploy` with `keyId=LOCAL-UNSIGNED` + NO env var → `UNSIGNED_BUNDLE_NOT_ALLOWED` (Node) and the PS deploy never runs.
2. Set `BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE=1`, redeploy the unsigned local bundle → succeeds. The updated test `local bundle deploys without signing...` (`deployer-contract.test.mjs`) exercises this end-to-end and must pass on Windows.
3. Confirm `bw_studio_deploy` with `manifestPath` omitted → `MANIFEST_UNREADABLE` (the critical fix).

### Finding #5 — Java secret keylist mirror (`625d0f1`)
**To validate on Windows:** the source-text assertions in `eclipse-plugin.test.mjs` confirm the keylist is present, but the Java must still COMPILE. Run `Build-BwStudio.ps1` and confirm `javac` succeeds (the widened `Set.of(...)` with 13 args and the extended `LABELED_SECRET` regex must compile under Java 21). Then run `StandaloneSmoke` to confirm runtime regex behavior.

### Finding #6 — SSRF allowlist (PS `e544d40`+`a6f0613`)
**To validate on Windows:** the source-text test confirms `Test-ReleaseHostAllowed` + the 4 `-RestrictToReleaseAllowlist` sites + `fe80` are present. Runtime: craft a release channel JSON pointing `artifactUrl` at `http://169.254.169.254/` (metadata) or `https://10.0.0.1/` and confirm the deploy REJECTS with "Release download host failed the allow-list check". Confirm a public host (or one in `BW_AUTOMATION_RELEASE_HOST_ALLOWLIST`) still downloads.

### Finding #8 — `-ExecutionPolicy Bypass` (documented, no change)
**No validation needed** — intentionally unchanged. See the audit doc for rationale (array-spawned args, no shell; required for locked-down Windows policies).

### Finding #9 — Desktop .lnk opt-in (PS `e544d40`)
**To validate on Windows:** deploy with `BW_AUTOMATION_CREATE_SHORTCUTS` UNSET → confirm NO `.lnk` files appear on the Desktop. Set `BW_AUTOMATION_CREATE_SHORTCUTS=1`, redeploy → confirm the two shortcuts appear. (Existing `deploy with BW_STUDIO_NO_SHORTCUT creates no launch shortcuts` test still covers the CI skip path.)

---

## Exact Windows validation steps (CI or manual)

### 1. Full test suite (must be 159 pass / 0 fail / 0 skip on Windows)
```powershell
cd <repo>
npm ci --ignore-scripts        # or: bun install
node --test tests/sap-bw-query/*.test.mjs
```
On Windows the 7 previously-failing `deployer-contract.test.mjs` tests (deploy/rollback/signature flows that spawn `powershell.exe`) and the 2 skipped `bridge-runtime`/`windows-validator-regression` tests MUST PASS — they are the runtime validation for findings #1, #2, #6, #9.

### 2. MCP build
```powershell
cd plugins\sap-bw-query\mcp
npm run build                  # esbuild → dist/server.mjs + dist/provenance.json
```
Confirm `dist/provenance.json` contains a 40-hex `commit` (finding #7). If git is unavailable, the build throws "cannot establish provenance" — do NOT ship the placeholder.

### 3. Bundle build + Java compile (findings #1, #5 Java halves)
```powershell
cd plugins\sap-bw-query
.\bundle\Build-BwStudio.ps1    # builds the signed Windows bundle; runs javac --release 21
```
Confirm `javac` succeeds (the widened `Set.of(...)` 13-arg + extended regex compile). Confirm `com.sap.bw.automation_0.3.0.jar` is produced and the BWMT 1.27.36 exact-version check passes.

### 4. Deploy + StandaloneSmoke round-trip
```powershell
# Deploy the freshly-built signed bundle (signed mode — the default-secure path)
$home = "$env:LOCALAPPDATA\BWAutomationStudio"
.\scripts\BwStudio.ps1 -Action Deploy -ArtifactPath <bundle.zip> -ManifestPath <manifest.json> -SignaturePath <sig> -TrustPolicyPath <trusted-publishers.json> -Json

# OR, for unsigned local testing (opt-in required after finding #2):
$env:BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE = "1"
.\scripts\BwStudio.ps1 -Action Deploy -ArtifactPath <bundle.zip> -ManifestPath <manifest.json> -Json

# Java smoke round-trip against the deployed BWMT jars:
java -cp <deployed version>\plugins\* com.sap.bw.automation.core.StandaloneSmoke
```
`StandaloneSmoke` verifies the Query EMF model round-trips without a live BW system. Must exit 0.

### 5. Live bridge auth handshake (finding #1 end-to-end)
```powershell
# Start the MCP server (sets BW_AUTOMATION_BRIDGE_TOKEN)
.\scripts\Start-BwMcp.ps1    # in one terminal

# Launch Eclipse (inherits the token, BridgeLoop sends auth frame)
.\scripts\BwStudio.ps1 -Action Launch    # in another terminal
```
Confirm the BW Automation sidebar shows "Bridge authenticated" (GREEN). Run any read tool (e.g. `bw_inspect_capabilities`) and confirm a response. Then kill Eclipse, connect a rogue socket with a wrong token → confirm `BRIDGE_UNAUTHORIZED`.

---

## Environment variables introduced by this hardening

| Variable | Purpose | Default |
|----------|---------|---------|
| `BW_AUTOMATION_BRIDGE_TOKEN` | Per-session auth token for the named pipe. Set by the Node server; inherited by BwStudio.ps1 → Eclipse. | auto-generated 32-byte hex |
| `BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE` | Opt-in for `LOCAL-UNSIGNED` bundle deploy (Node gate + PS gate). | unset (deny) |
| `BW_AUTOMATION_LANDSCAPE_ALLOW_DIR` | Extends the importLandscape confinement root beyond `<home>/landscapes`. | unset |
| `BW_AUTOMATION_RELEASE_HOST_ALLOWLIST` | Semicolon-separated strict allowlist for release-channel download hosts. | unset (default-deny private ranges) |
| `BW_AUTOMATION_CREATE_SHORTCUTS` | Opt-in for desktop `.lnk` creation on deploy. | unset (no shortcuts) |
| `BW_AUTOMATION_PLUGIN_COMMIT` | Build-time provenance override (40-hex). The literal `"source-commit"` is the dev placeholder and is NEVER surfaced by the server. | `"source-commit"` in source `.mcp.json`; real hash in built `dist/provenance.json` |

---

## Open items for follow-up (not blocking this branch)

1. **`config/trusted-publishers.json` ships `keys: []`** — signed release mode is still unusable until a real publisher key is added. This is the root cause of finding #2's "unsigned is the only working path". With the opt-in gates now in place, unsigned-local is safe-by-default, but production should populate a signed key.
2. **`authBuffer` unbounded growth** (finding #1 Minor) — a malicious pre-auth client streaming garbage could hold memory until the 15s timeout. Cheap fix: cap `authBuffer` at ~8KB in `bridge-broker.mjs` `#onAuthData`.
3. **Non-constant-time token compare** (finding #1 Minor) — acceptable for local-only transport; switch to `crypto.timingSafeEqual` if the transport ever becomes networked.
4. **Pre-existing `query-runtime.test.mjs` "append-only journal" isolated-run flake** — unrelated to this branch (`draft-state.mjs` untouched); flagged for separate investigation.
5. **ISO-8859-1→UTF-8 pipe decode** (`BridgeLoop.java:60`) — minor fragility for non-ASCII query descriptions; functional today.

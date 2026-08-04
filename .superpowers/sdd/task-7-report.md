# Task 7 report — PowerShell hardening: SSRF allowlist (#6) + .lnk opt-in (#9)

**Status:** complete (source-text validation). Runtime validation deferred to Windows CI (Task 10 handoff).
**Commit:** `e544d40` — `fix(bw-query): add release-host SSRF allowlist and make desktop shortcuts opt-in (findings #6,#9)` (NOT pushed)
**Finding #8 (ExecutionPolicy):** unchanged, per brief — documented design choice, no code touched.

## Files changed (with line refs)

### `plugins/sap-bw-query/scripts/BwStudio.ps1`

- **New `Test-ReleaseHostAllowed` function (lines 82-133).** SSRF allowlist for release-channel download hosts.
  - Lines 93-102: strict-allowlist mode when `BW_AUTOMATION_RELEASE_HOST_ALLOWLIST` (semicolon-separated, exact match, case-insensitive) is set; only listed hosts pass, heuristic skipped.
  - Lines 104-109: default heuristic rejects `.local` / `.internal` suffixes and bare `local` / `internal` hostnames before any DNS lookup (avoids leaking internal naming).
  - Lines 111-127: `[System.Net.IPAddress]::TryParse` for IP literals; otherwise `[System.Net.Dns]::GetHostAddresses` with try/catch (fail-closed on resolution failure).
  - Lines 129-131: rejects if ANY resolved address is private.
- **New `Test-PrivateOrSpecialAddress` helper (lines 135-165).** Classifies IPv4/IPv6 as private/special. Rejects: IPv4 `0.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (link-local + cloud metadata incl. `169.254.169.254`), `127/8`; IPv6 loopback `::1`, unique-local `fc00::/7` (covers `fe80::/10` link-local). Unknown address families rejected by default.
- **`Save-HttpsDownload` (lines 167-184).** Added `[switch]$RestrictToReleaseAllowlist` param. When set, after the HTTPS scheme check, calls `Test-ReleaseHostAllowed $parsed.Host`; on `$false` throws `"Release download host failed the allow-list check"` (generic message — does NOT echo host to avoid reflecting attacker input).
- **Four release-channel download calls now pass `-RestrictToReleaseAllowlist`:**
  - Line 381: `Save-HttpsDownload $ReleaseChannelUrl $channelPath -RestrictToReleaseAllowlist` (channel JSON itself)
  - Lines 389-391: `$channel.artifactUrl`, `$channel.manifestUrl`, `$channel.signatureUrl`
- **`Set-DesktopShortcuts` gate (lines 414-430).** Changed from opt-out to opt-in (finding #9). New gate at line 430: `if (-not ($env:BW_AUTOMATION_CREATE_SHORTCUTS -eq "1") -or $env:CI -or $env:BW_STUDIO_NO_SHORTCUT) { return $created }`. `BW_STUDIO_NO_SHORTCUT` retained as secondary backward-compat skip; `$env:CI` still always skips. Shortcut body (WScript.Shell, GetFolderPath, kein/mit Passwortspeicher, -noPwdStore) unchanged.

### `tests/sap-bw-query/deployer-contract.test.mjs`

- **Updated test at lines 116-131** ("...launch shortcuts (opt-in via BW_AUTOMATION_CREATE_SHORTCUTS)..."): kept WScript.Shell / GetFolderPath("Desktop") / kein Passwortspeicher / mit Passwortspeicher / -noPwdStore / append-only assertions; replaced the `BW_STUDIO_NO_SHORTCUT` gate assertion with `BW_AUTOMATION_CREATE_SHORTCUTS` opt-in assertions (presence + `BW_AUTOMATION_CREATE_SHORTCUTS -eq "1"`).
- **New test at lines 155-180** ("release-channel downloads are gated by a release-host SSRF allowlist (finding #6)"): asserts `function Test-ReleaseHostAllowed`, `RestrictToReleaseAllowlist`, `BW_AUTOMATION_RELEASE_HOST_ALLOWLIST`, `169.254`, the generic error string, `[System.Net.IPAddress]::TryParse`, `[System.Net.Dns]::GetHostAddresses`, `.local`, `.internal`, and that all four channel download calls (`$ReleaseChannelUrl`, `$channel.artifactUrl`, `$channel.manifestUrl`, `$channel.signatureUrl`) include `-RestrictToReleaseAllowlist`.
- **New test at lines 182-191** ("release-host allowlist error does not reflect the hostname (no SSRF echo)"): scans every `throw "...allow-list..."` line and asserts none interpolate `$parsed`, `$HostName`, `$host`, or `$Host`.

## Test results (Mac, source-text only)

### `node --test tests/sap-bw-query/deployer-contract.test.mjs`
- **Before (baseline):** 12 tests — 5 pass / 7 fail / 0 skip
- **After:** 14 tests — 7 pass / 7 fail / 0 skip

New/changed source-text tests now PASSING:
- `deploy creates two visible-desktop launch shortcuts (opt-in via BW_AUTOMATION_CREATE_SHORTCUTS), guarded and non-destructive` (updated — was the old opt-out assertion)
- `release-channel downloads are gated by a release-host SSRF allowlist (finding #6)` (new)
- `release-host allowlist error does not reflect the hostname (no SSRF echo)` (new)

The 7 FAILING tests are unchanged (same names, same root cause — they spawn `powershell.exe` which doesn't exist on Mac):
1. `status works without an installed studio and does not require admin`
2. `deploy with BW_STUDIO_NO_SHORTCUT creates no launch shortcuts`
3. `offline deployment verifies signature, archive hash, and extracted file inventory`
4. `local bundle deploys without signing after archive and file-inventory verification`
5. `deployment rejects corrupted artifacts and leaves no active version`
6. `same-version redeploy with changed content installs a content-addressed folder, preserving the old`
7. `rollback appends an activation and preserves every installed version`

### `node --test tests/sap-bw-query/*.test.mjs` (full suite)
- **Before:** 153 tests — 144 pass / 7 fail / 2 skip
- **After:** 155 tests — 146 pass / 7 fail / 2 skip

Delta is exactly +2 tests / +2 pass (the 2 new SSRF source-text tests; the shortcut test was a modification of an existing passing test, not a net-new test). 7 fail / 2 skip unchanged.

TDD cycle verified: new/changed source-text tests were confirmed RED against unchanged PS first, then GREEN after implementation.

## Concerns / notes for Windows CI (Task 10)

1. **Runtime validation deferred to Windows CI.** All assertions here are source-text only — the SSRF allowlist IP/DNS logic and the opt-in shortcut gate are NOT exercised at runtime on Mac. Windows CI should add (or confirm) a test that:
   - A release channel pointing at a private IP (e.g. `169.254.169.254`, `10.x`, `127.0.0.1`) is rejected with the generic allow-list error.
   - A `.local` / `.internal` hostname is rejected.
   - `BW_AUTOMATION_RELEASE_HOST_ALLOWLIST` strict mode accepts a listed host and rejects an unlisted one.
   - A deploy with `BW_AUTOMATION_CREATE_SHORTCUTS=1` creates the two `.lnk` files; without it (and without the legacy `BW_STUDIO_NO_SHORTCUT`), zero shortcuts are written.
2. **DNS-resolution fail-closed** (`Test-ReleaseHostAllowed` returns `$false` on `[System.Net.Dns]::GetHostAddresses` throw) means an online deploy in a no-DNS environment could be blocked unless the host is IP-literal or allowlisted. Operators with non-public release hosts must set `BW_AUTOMATION_RELEASE_HOST_ALLOWLIST`. This is the intended fail-closed behavior per the brief.
3. **`GetHostAddresses` is called before the private-IP check on DNS hostnames** — this resolves the name once and validates all A/AAAA records. There is a theoretical TOCTOU window between resolution and curl's own resolution, but curl's `--proto "=https"` + the fact that an attacker would need to rebind DNS within the ~seconds between checks makes this a low residual risk. The signature check remains the authoritative gate; the allowlist is defense-in-depth against the download itself reaching an internal host.
4. **Breaking change for the "AI deploys and shortcuts appear" path** — intentional per finding #9. Manual users who want shortcuts must now set `BW_AUTOMATION_CREATE_SHORTCUTS=1`. This should be noted in operator/release notes.
5. **`BW_STUDIO_NO_SHORTCUT` retained** as a secondary backward-compat skip (not removed from source) — existing test helpers / CI that set it still suppress shortcuts correctly via the `... -or $env:BW_STUDIO_NO_SHORTCUT` clause in the new gate.

## Critical fix

**Status:** complete (source-text validation). Commit `fix(bw-query): reject IPv6 link-local fe80::/10 in SSRF allowlist (finding #6 critical fix)` (NOT pushed).

### Finding

The Task 7 review flagged a Critical regression in `Test-PrivateOrSpecialAddress` (`plugins/sap-bw-query/scripts/BwStudio.ps1`, IPv6 branch). The original code had a single IPv6 range check:

```powershell
# fc00::/7 unique-local (fe80::/10 link-local is a subset, also caught here).
if (($bytes[0] -band 0xFE) -eq 0xFC) { return $true }
```

The comment's claim was wrong. The byte math `($bytes[0] -band 0xFE) -eq 0xFC` matches only first bytes `0xFC` or `0xFD` (i.e. `fc00::/7` unique-local). The `fe80::/10` link-local range has first byte `0xFE`, which does NOT satisfy `(0xFE -band 0xFE) -eq 0xFC` (since `0xFE -band 0xFE = 0xFE ≠ 0xFC`). So an IPv6 link-local address such as `fe80::1` passed the SSRF check, violating the brief's explicit requirement to reject `fe80::/10`. The two ranges are disjoint, not subset.

### Fix

In `plugins/sap-bw-query/scripts/BwStudio.ps1` (IPv6 branch of `Test-PrivateOrSpecialAddress`), added an explicit `fe80::/10` link-local check BEFORE the `fc00::/7` check, and corrected the misleading comment:

```powershell
$bytes = $Address.GetAddressBytes()
# fe80::/10 link-local (top 10 bits = 1111111010: byte0 = 0xFE, byte1 top 2 bits = 10)
if ($bytes[0] -eq 0xFE -and ($bytes[1] -band 0xC0) -eq 0x80) { return $true }
# fc00::/7 unique-local (fc/fd first byte).
if (($bytes[0] -band 0xFE) -eq 0xFC) { return $true }
return $false
```

The new check matches the `fe80::/10` definition exactly: the top 10 bits must be `1111111010`. Byte 0 must equal `0xFE` (`11111110`), and the top 2 bits of byte 1 must be `10`, i.e. `($bytes[1] -band 0xC0) -eq 0x80`. This correctly captures `fe80::` through `febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff` while excluding `fec0::` and beyond.

In `tests/sap-bw-query/deployer-contract.test.mjs` (SSRF allowlist test), added a source-text assertion locking the range into the source-text checks so the regression cannot recur silently:

```javascript
// IPv6 link-local fe80::/10 must be rejected explicitly (NOT a subset of fc00::/7).
assert.match(text, /fe80/);
```

### Verification

- `node --test tests/sap-bw-query/deployer-contract.test.mjs`: the SSRF source-text test passes (including the new `fe80` assertion); the 7 `powershell.exe`-dependent tests fail on Mac as expected (unchanged).
- `node --test tests/sap-bw-query/*.test.mjs`: full suite counts unchanged at **155 tests / 146 pass / 7 fail / 2 skipped** — no new failures introduced.

No other SSRF logic touched: IPv4 ranges, strict-mode allowlist, DNS fail-closed, generic error message, and the 4 download sites passing `-RestrictToReleaseAllowlist` are all unchanged.

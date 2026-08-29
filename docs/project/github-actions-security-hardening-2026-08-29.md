# GitHub Actions Security Hardening (2026-08-29)

**Scope:** all 8 workflow files under `.github/workflows/`
**Branch:** `chore/gh-actions-security-hardening` (off `main`)
**Commits:** `3af29a7`, `f4958a5`, `7a70e07`, `f97880f`, plus the final cache fix (`78e4ca2`)
**Result:** `npm run lint:workflows` exits 0 with zero findings and zero suppression annotations.

---

## Background: the words this document uses

- A **workflow** is a file under `.github/workflows/` that describes automated steps. GitHub runs these steps on its own computers when events happen, for example a push or a new release.
- **GITHUB_TOKEN** is an automatic login pass that GitHub gives to each workflow run. It can read the repository and, if allowed, change things in it. A workflow should get only the small set of rights it needs. This is the least-privilege rule.
- An **action** is a reusable step that a workflow can call, for example `actions/checkout`. A workflow names an action plus a version, for example `actions/checkout@v4`. That version part is a **tag**.
- A **mutable tag** is a name like `v4` that a repository owner can move to point at different code at any time. If an attacker moves it, every workflow that names `v4` runs the attacker's code.
- **SHA pinning** replaces the tag with the exact commit fingerprint (a 40-character SHA, for example `3d3c42e5...`) of one immutable piece of code. A commit cannot change. With SHA pinning, a moved tag does not affect the workflow. A comment like `# v4.0.1` records which release the SHA stands for.
- **`persist-credentials: false`** is a checkout setting. It stops the checkout action from leaving the GITHUB_TOKEN inside the job's `.git` folder. Without it, any later step can read the token from disk.
- **Cache poisoning** is an attack on GitHub's build caches. An attacker writes hostile files into a cache. A later workflow, often a release workflow, restores the cache and runs the hostile files.

## Why: what happened to other projects in 2025–2026

Attackers no longer attack only application code; they now also attack the CI setup itself. These incidents shaped the fixes in this repository.

### tj-actions/changed-files (March 2025) — CVE-2025-30066

An attacker stole a maintainer's personal access token, rewrote the `v1` tag of a helper action, and then rewrote every `tj-actions/changed-files` tag from `v1` to `v45.0.7` to point at code that dumped runner memory, including CI secrets, into build logs. About 23,000 repositories were affected (Wiz estimate). The lesson: a mutable tag can be hijacked after the fact. Pin actions to commit SHAs.

- https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction
- https://github.com/tj-actions/changed-files/security/advisories/GHSA-mw4p-6x4p-x5m5
- https://www.wiz.io/blog/github-action-tj-actions-changed-files-supply-chain-attack-cve-2025-30066

### GhostAction (September 2025)

Attackers with write access pushed look-alike malicious workflow files to 817 repositories. The workflows stole 3,325 secrets for npm, PyPI, Docker Hub, and cloud services. The lesson: a workflow file is a secret-stealing program. A repository should review workflow changes with the same care as code changes, and a linter gate makes odd workflow content visible in review.

- https://blog.gitguardian.com/ghostaction-campaign-3-325-secrets-stolen/
- https://www.stepsecurity.io/blog/ghostaction-campaign-over-3-000-secrets-stolen-through-malicious-github-workflows

### Trivy ecosystem compromise (March 2026) — CVE-2026-33634

Stolen credentials published one malicious Trivy release and force-pushed 76 of the project's 77 version tags. The scanning action became an information stealer. The lesson repeats the tj-actions lesson with a different victim: force-pushed tags are a live delivery channel. SHA pinning blocks it.

- https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23
- https://www.aquasec.com/blog/trivy-supply-chain-attack-what-you-need-to-know/

### prt-scan campaign (March–April 2026)

One attacker ran six attack waves against more than 500 repositories. Every attack abused the `pull_request_target` trigger, which runs a workflow from a pull request with write access. AI tooling automated the exploitation. The lesson: avoid `pull_request_target`. This repository never used it; an audit confirmed this.

- https://www.wiz.io/blog/six-accounts-one-actor-inside-the-prt-scan-supply-chain-campaign

### Megalodon (May 2026)

Attackers used trusted bot accounts to forge more than 5,700 commits and backdoored 5,561 repositories in about 6 hours. The forged commits replaced workflow files with base64-obfuscated secret stealers. The lesson: automated changes to workflow files deserve their own review, and a static gate on workflow content catches low-effort obfuscation.

- https://www.stepsecurity.io/blog/megalodon-mass-github-actions-secret-exfiltration-across-5-500-public-repositories

A related npm worm, Shai-Hulud (September 2025), stole npm publish tokens and created malicious workflow files in victim repositories to spread further. npm publishing credentials are CI credentials (https://www.wiz.io/blog/shai-hulud-npm-supply-chain-attack).

**Attribution caution:** vendors disagree on some 2026 details, for example Shai-Hulud package counts. Third parties inferred a link between Megalodon and GitHub's own 2026 breach; GitHub has not confirmed it. The lessons above do not depend on those disputed details.

## What we found and fixed

zizmor and actionlint audited the eight workflows. This table shows the main findings and the state now.

| Finding | Before | After |
|---|---|---|
| Mutable (tag-pinned) action refs | 17 of 20 `uses:` refs | 0; all 20 refs pinned to commit SHAs |
| Checkout steps leaking the token to disk (`persist-credentials`) | 2 of 9 checkouts opted out | 9 of 9 set `persist-credentials: false` |
| GITHUB_TOKEN permissions | Some workflows had no explicit `permissions:` | All 8 workflows declare least-privilege `permissions:` |
| Missing job timeouts | 5 of 9 jobs had none | All 9 jobs set `timeout-minutes` |
| Missing concurrency groups | 1 of 8 workflows had none | All 8 workflows set a concurrency group |
| Expressions (`${{ }}`) inside `run:` shell | 7 sites in 3 files | 0; all values now arrive through step `env:` |
| npm cache in the release workflow | Caching enabled | Disabled with `package-manager-cache: false` |

The only elevated token scope left anywhere is `security-events: write` in `codeql.yml`. CodeQL needs it to upload scan results. A comment in the file states this.

## The changes, task by task

1. **CI gate (commit `3af29a7`).** Added the `lint:workflows` script to `package.json` and two steps to `quality-checks.yml`: one installs the linters with checksum verification, one runs the gate. The gate failed at first by design (red baseline) to record the findings.
2. **SHA pinning and credential persistence (commit `f4958a5`).** Replaced all 17 tag-pinned refs with verified commit SHAs plus `# vX.Y.Z` comments. Each SHA was resolved with `git ls-remote` and cross-checked through the GitHub API, including the peeled commit for the annotated `github/codeql-action` tag. Added `persist-credentials: false` to the 7 checkouts that missed it.
3. **Token scopes, timeouts, concurrency (commit `7a70e07`).** Added a top-level `permissions: contents: read` where missing, an explicit permissions block on the CodeQL job, `timeout-minutes` to the 5 jobs that lacked one, and a concurrency group to `quality-checks.yml`.
4. **Expression hygiene (commit `f97880f`).** Moved 7 `${{ }}` interpolations out of `run:` shells in 3 files into step `env:` entries and quoted the shell uses. Also fixed 5 shellcheck style findings in `validate-frontmatter.yml`. The expressions can no longer write shell syntax into a command.
5. **Cache opt-out (this branch's final fix).** `actions/setup-node` v7 turns on package-manager caching by default. The release workflow now sets `package-manager-cache: false` to turn it off. See the next section.

## The CI gate

Every push and pull request to `main` now runs a workflow lint gate as part of `quality-checks.yml`.

**Tools**

- **actionlint** v1.7.12 checks workflow syntax, correctness, and embedded shell scripts (with shellcheck). https://github.com/rhysd/actionlint
- **zizmor** v1.29.0 checks GitHub Actions security rules, for example unpinned actions, over-broad token scopes, template injection, and cache poisoning. https://zizmor.sh/

**How the binaries are verified.** The install step downloads both release archives over HTTPS from their official GitHub releases. It checks each archive against a SHA-256 digest literal written inside the workflow step with `sha256sum -c -`. A mismatch fails the job. The actionlint digest was cross-checked against the official checksum file published with that release when the digest was added; CI itself checks only the embedded digest literal. zizmor publishes no checksum file, so its digest was computed once from the official release asset and recorded here. The step adds no new third-party actions; the repository deliberately does not use `zizmor-action` for this reason.

**How to run locally.** Install both tools (for example with Homebrew) and run:

```sh
npm run lint:workflows
```

This runs actionlint and zizmor over `.github/workflows/` and fails if either tool reports a finding. Both tools always run, so one pass shows every finding. The CI job runs the same script, so a finding fails the job too.

**Current result.** The gate is green: actionlint reports no findings, and zizmor reports no findings. Zero suppression annotations (`#! ignore`) exist in the repository. Dependabot keeps the pinned SHAs current with grouped weekly pull requests (`.github/dependabot.yml`), so pinning does not freeze the actions in time.

## The cache decision in the release workflow

`sap-bw-query-bundle.yml` builds and signs the BW Automation Studio release bundle, and it runs on `release: published` events. Release workflows are prime targets for cache poisoning: an attacker who poisons a cache reaches the signing environment, and the poisoned output reaches users.

zizmor flagged this workflow because `actions/setup-node` v7 enables package-manager caching by default. Removing the old `cache: npm` input was not enough, because the default turns caching back on. The workflow now sets `package-manager-cache: false` explicitly. A cold `npm ci` costs some seconds on one release job; a poisoned cache could steal the signing key. The trade-off is clear, so the cache stays off. The same reasoning applies to every future release or signing workflow in this repository.

## Platform changes and watch items

### Secure-by-default changes (December 8, 2025)

GitHub changed platform behavior for everyone. `pull_request_target` runs now anchor to the workflow file on the default branch, so an edited workflow in a pull request no longer runs with write access. Branch protection environment rules no longer match pull request events. `actions/checkout` v6 and later store the persisted token in the runner's temp directory instead of the `.git` folder. This repository's fixes stay necessary: explicit `permissions:` remains each repository's job, because the platform did not change default token scopes (https://github.com/orgs/community/discussions/179107, https://docs.github.com/actions/reference/authentication-in-a-workflow).

### Watch items (2026 roadmap)

GitHub announced further platform work (https://github.blog/news-insights/product-news/whats-coming-to-our-github-actions-2026-security-roadmap/):

- **Scoped secrets:** secrets that a job can read only in narrow, declared scopes. Adopt when available.
- **Egress firewall:** a layer-7 network allowlist for GitHub-hosted runners. Adopt for the release workflow when available.
- **Workflow dependency lockfile:** transitively SHA-pins nested action references. Adopt when available.

Also on the watch list: an organization-level policy that requires SHA pinning (announced August 2025, https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/), and runtime monitoring with egress control (the StepSecurity Harden-Runner class of tooling, which detected the tj-actions theft live).

## Verification record

- Before: `npm run lint:workflows` exited 1 with 19 high, 7 low, and 1 informational zizmor findings plus 5 actionlint (shellcheck) findings.
- After: the command exits 0. actionlint reports no findings. zizmor reports "No findings to report" (5 findings are suppressed by zizmor's own default persona rules, not by this repository).
- The full validation pipeline (`npm run validate`) passes on the final state.

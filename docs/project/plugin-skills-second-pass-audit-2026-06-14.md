# Plugin Skills Second-Pass Audit - 2026-06-14

## Scope

- Audited all 35 plugins under `plugins/*`.
- Excluded `.agents/skills`.
- Used docs-only/package-registry verification. No SAP tenant, SAP system, or production behavior verification was performed.
- Preserved existing user/repo changes and treated production-only checks as pending.
- Any ROI or time-savings wording in this audit is illustrative prioritization language, not repository-verified customer outcome evidence.

## Implemented Capability Changes

- Added manifest generation support for `hooks: "./hooks/hooks.json"` and `mcpServers: "./.mcp.json"`.
- Extended marketplace generation and schema to carry `hooks` and `mcpServers`.
- Added stricter validation for packaged artifacts, nested manifests, sidecar manifest consistency, and command/agent quality.
- Added `npm run audit:skills` for read-only per-plugin capability reporting.
- Removed generated hook bytecode artifacts from plugin packages and added ignore/validation coverage.
- Standardized the 29 existing commands with explicit `allowed-tools`, input hints, and prompt-style routing.
- Standardized the 24 existing agents with delegation guidance, first checks, MCP fallback behavior, and safety constraints.
- Added 18 targeted commands, 2 agents, and the `sap-dependency-security` hook profile.

## Public Package Evidence Checked

Checked via public npm registry on 2026-06-14:

| Package | Registry version | Repo handling |
|---------|------------------|---------------|
| `@ui5/linter` | `1.22.0` | Skill and moved audit docs updated to `1.22.0`. |
| `@ui5/cli` | `4.0.55` | Recorded as docs-only evidence; no package update performed. |
| `@ui5/mcp-server` | `0.2.12` | Existing MCP pin remains exact at `0.2.11`; upgrade should be planned separately. |
| `@cap-js/mcp-server` | `0.0.5` | Existing MCP pin remains current. |
| `@sap-ux/fiori-mcp-server` | `1.4.0` | Existing MCP pin remains current. |
| `hana-mcp-server` | `0.3.1` | Existing MCP pin remains current. |
| `@mariodefe/sap-datasphere-mcp` | `1.4.0` | Existing MCP pin remains exact at `1.2.1`; upgrade should be planned separately. |

Note: Web search snippets for `@ui5/linter` still showed stale `1.21.1` metadata, but `npm view @ui5/linter version` returned `1.22.0`. The audit notes use the npm registry CLI result as the decisive package evidence.

## Inventory After Implementation

`npm run audit:skills` reported:

- 35 plugins
- 47 commands
- 26 agents
- 8 hook-enabled plugins
- 6 MCP configs
- 1 LSP config
- 20 stale or missing `last_verified` values

## Per-Plugin Recommendations

| Plugin | Commands | Agents | Hooks | MCP | LSP | last_verified | Recommendation |
|--------|----------|--------|-------|-----|-----|---------------|----------------|
| sap-abap | 1 | 0 | 0 | no | no | 2026-04-02 | Maintain; new ABAP Cloud review command covers high-value workflow. |
| sap-abap-cds | 1 | 0 | 0 | no | no | 2026-04-02 | Maintain; new CDS model check command covers validation workflow. |
| sap-ai-core | 1 | 0 | 0 | no | no | 2026-06-12 | Maintain; deployment preflight command added. |
| sap-api-style | 0 | 0 | 0 | no | no | 2026-02-25 | Consider a template command for OpenAPI/API doc review in a later pass. |
| sap-btp-best-practices | 0 | 0 | 0 | no | no | 2025-11-27 | Docs-only verify before advancing metadata. |
| sap-btp-build-work-zone-advanced | 0 | 0 | 0 | no | no | 2025-11-27 | Consider a template command for workspace/site checks. |
| sap-btp-business-application-studio | 0 | 0 | 0 | no | no | 2025-11-27 | Consider a command for dev-space diagnostics. |
| sap-btp-cias | 0 | 0 | 0 | no | no | 2025-11-27 | Consider a command for automation-service readiness. |
| sap-btp-cloud-identity-services | 0 | 0 | 0 | no | no | 2026-06-12 | Maintain; no new artifact needed in this pass. |
| sap-btp-cloud-logging | 1 | 0 | 0 | no | no | 2025-11-27 | New ingestion-check command added; docs-only verify remains pending. |
| sap-btp-cloud-platform | 0 | 0 | 0 | no | no | 2025-11-27 | Docs-only verify before metadata updates; broad command deferred. |
| sap-btp-cloud-transport-management | 1 | 0 | 0 | no | no | 2025-11-27 | New transport-check command added; tenant import checks pending. |
| sap-btp-connectivity | 1 | 0 | 0 | no | no | 2025-11-27 | New destination-diagnose command added; live destination checks pending. |
| sap-btp-developer-guide | 0 | 0 | 0 | no | no | 2025-11-27 | Docs-only verify; avoid adding generic commands until repeat workflow is clear. |
| sap-btp-integration-suite | 0 | 0 | 0 | no | no | 2025-11-27 | Consider targeted integration-flow diagnostic command later. |
| sap-btp-intelligent-situation-automation | 0 | 0 | 0 | no | no | 2025-11-27 | Docs-only verify; no high-ROI artifact added. |
| sap-btp-job-scheduling | 0 | 0 | 0 | no | no | 2025-11-27 | Consider schedule/action endpoint command later. |
| sap-btp-master-data-integration | 0 | 0 | 0 | no | no | 2025-11-27 | Docs-only verify; production integration checks pending. |
| sap-btp-service-manager | 1 | 0 | 0 | no | no | 2025-11-27 | New troubleshoot command added; broker/platform checks pending. |
| sap-cap-capire | 5 | 4 | 1 | yes | yes | 2026-02-22 | Existing command/agent/hook set standardized; docs-only verify pending. |
| sap-cloud-sdk-ai | 1 | 0 | 0 | no | no | 2026-05-31 | New JavaScript/TypeScript chat template command added. |
| sap-cloud-sdk-ai-python | 1 | 0 | 0 | no | no | 2026-06-12 | New Python chat template command added. |
| sap-datasphere | 5 | 3 | 1 | yes | no | 2026-06-11 | Existing command/agent/hook set standardized; MCP pin upgrade should be planned separately. |
| sap-dependency-security | 1 | 0 | 1 | no | no | 2026-06-14 | New upgrade-plan command and dependency-security hook added. |
| sap-fiori-tools | 2 | 1 | 0 | yes | no | 2026-02-26 | New generate/preview commands and Fiori advisor agent added; docs-only verify pending. |
| sap-hana-cli | 2 | 1 | 0 | yes | no | 2025-11-26 | New connection/object commands and HANA advisor agent added; live DB checks pending. |
| sap-hana-cloud-data-intelligence | 0 | 0 | 0 | no | no | 2025-11-27 | Consider a pipeline/connection template command later. |
| sap-hana-ml | 0 | 0 | 0 | no | no | 2025-11-27 | Docs-only verify; no new artifact added. |
| sap-sac-custom-widget | 3 | 3 | 1 | no | no | 2026-06-12 | Existing command/agent/hook set standardized. |
| sap-sac-planning | 3 | 3 | 1 | no | no | 2026-06-11 | Existing command/agent/hook set standardized. |
| sap-sac-scripting | 4 | 4 | 1 | yes | no | 2026-06-11 | Existing command/agent/hook set standardized. |
| sap-sqlscript | 4 | 3 | 1 | no | no | 2026-05-31 | Existing command/agent/hook set standardized. |
| sapui5 | 5 | 4 | 1 | yes | no | 2026-05-31 | Existing command/agent/hook set standardized; `@ui5/mcp-server` upgrade should be planned separately. |
| sapui5-cli | 2 | 0 | 0 | no | no | 2026-05-31 | New build and troubleshoot commands added. |
| sapui5-linter | 2 | 0 | 0 | no | no | 2026-06-14 | New check and fix-plan commands added; package docs verified at `1.22.0`. |

## Production-Only Checks Still Pending

- SAP BTP destination, Cloud Connector, transport, Service Manager, and Cloud Logging behavior in live subaccounts.
- SAP AI Core deployment/resource/runtime behavior.
- Datasphere tenant metadata, live lineage, connection tests, and MCP tool execution.
- Fiori preview/deployment against HTML5 repository, Work Zone/launchpad, and real destinations.
- HANA connectivity, object metadata, privileges, and query behavior against real systems.
- SAC widget/planning/scripting runtime behavior in tenant stories/apps.
- CAP model search, deployment, and LSP behavior against representative CAP projects.

Do not advance these production/system verification dates without tenant/system evidence.

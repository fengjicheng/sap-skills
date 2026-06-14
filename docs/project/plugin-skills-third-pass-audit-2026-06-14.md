# Third-Pass Plugin Skills Audit - 2026-06-14

## Summary

- Scope: `plugins/*` only; `.agents/skills` was not inspected or modified.
- Inventory after implementation: 35 plugins, 61 commands, 30 agents, 8 hook-enabled plugins, 6 MCP configs, and 1 LSP config.
- New validation surface: `npm run audit:effectiveness` plus validation wiring through `npm run validate`.
- README drift: 0 plugin-local README capability indexes drift from filesystem inventory.
- Oversized reference routing: 6 reference files over 10k words now have SKILL.md search routing.
- Verification policy: no production or tenant `last_verified` dates were advanced without system evidence.

## Evidence Checked

Package and source checks were docs-only/public-registry checks:

| Source | Evidence |
|--------|----------|
| npm | `@ui5/linter` latest observed as 1.22.0 |
| npm | `@ui5/cli` latest observed as 4.0.55 |
| npm | `@ui5/mcp-server` latest observed as 0.2.12 |
| npm | `@cap-js/mcp-server` latest observed as 0.0.5 |
| npm | `@sap/cds` latest observed as 9.9.1 |
| npm | `@sap/cds-dk` latest observed as 9.9.2 |
| npm | `@sap-ux/fiori-mcp-server` latest observed as 1.4.0 |
| npm | `hana-cli` latest observed as 4.202605.2 |
| npm | `@sap/hana-client` latest observed as 2.28.21 |
| npm | `@sap/hdi-deploy` latest observed as 5.6.1 |
| npm | `@sap-ai-sdk/orchestration` latest observed as 2.11.0 |
| PyPI | `hana-ml` latest observed as 2.28.26042901 |

These checks identify freshness and upgrade candidates only. They do not prove runtime compatibility in a customer tenant, BTP subaccount, HANA database, or SAC story.

## Implemented Changes

- Added 14 non-mutating slash commands for previously thin plugins.
- Added 4 advisory agents: `api-style-reviewer`, `btp-platform-advisor`, `identity-security-advisor`, and `integration-flow-advisor`.
- Added `## Capability Index` to all 35 plugin-local README files.
- Added `## Output Contract` to all legacy commands that previously lacked one.
- Added explicit large-reference search routing for SAP API Style and SAC Scripting, plus MCP/LSP routing notes for CAP and Datasphere.
- Added `scripts/audit-effectiveness.mjs`, `npm run audit:effectiveness`, and `npm run validate:effectiveness`.
- Aligned README-only "Last Verified" text with existing SKILL metadata for same-evidence documentation records; did not advance metadata dates.

## New Commands

| Plugin | Command |
|--------|---------|
| `sap-api-style` | `/api-style-review` |
| `sap-btp-best-practices` | `/btp-architecture-review` |
| `sap-btp-build-work-zone-advanced` | `/work-zone-content-check` |
| `sap-btp-business-application-studio` | `/bas-dev-space-diagnose` |
| `sap-btp-cias` | `/cias-scenario-check` |
| `sap-btp-cloud-identity-services` | `/identity-trust-check` |
| `sap-btp-cloud-platform` | `/btp-subaccount-readiness` |
| `sap-btp-developer-guide` | `/btp-app-readiness-review` |
| `sap-btp-integration-suite` | `/integration-flow-review` |
| `sap-btp-intelligent-situation-automation` | `/isa-export-readiness` |
| `sap-btp-job-scheduling` | `/job-schedule-check` |
| `sap-btp-master-data-integration` | `/mdi-replication-check` |
| `sap-hana-cloud-data-intelligence` | `/data-intelligence-pipeline-check` |
| `sap-hana-ml` | `/hana-ml-experiment-plan` |

## Per-Plugin Findings

| Plugin | Third-pass result | Pending verification |
|--------|-------------------|----------------------|
| `sap-abap` | README capability index added; `/abap-cloud-review` exposed in docs. | ABAP Cloud released API checks need target system evidence. |
| `sap-abap-cds` | README capability index added; CDS activation/ATC notes aligned. | CDS activation and ATC behavior need ABAP system evidence. |
| `sap-ai-core` | README capability index added for `/ai-core-deployment-check`. | SAP AI Core deployment/runtime checks need tenant evidence. |
| `sap-api-style` | Added `/api-style-review`, `api-style-reviewer`, and large-reference search routing. | Upstream API style source refresh and API owner review remain pending. |
| `sap-btp-best-practices` | Added `/btp-architecture-review` and README capability index. | Docs-only BTP architecture guidance refresh remains pending. |
| `sap-btp-build-work-zone-advanced` | Added `/work-zone-content-check` and README capability index. | Work Zone content import/export and template freshness checks remain pending. |
| `sap-btp-business-application-studio` | Added `/bas-dev-space-diagnose` and README capability index. | BAS dev-space/runtime verification requires tenant access. |
| `sap-btp-cias` | Added `/cias-scenario-check` and README capability index. | Live CIAS scenario checks remain pending. |
| `sap-btp-cloud-identity-services` | Added `/identity-trust-check`, `identity-security-advisor`, and README capability index. | IAS/IPS trust, provisioning, and login checks require tenant evidence. |
| `sap-btp-cloud-logging` | README now exposes `/btp-logging-ingestion-check`. | Tenant log ingestion checks remain pending. |
| `sap-btp-cloud-platform` | Added `/btp-subaccount-readiness`, `btp-platform-advisor`, and README capability index. | BTP subaccount/entitlement checks require tenant access. |
| `sap-btp-cloud-transport-management` | README now exposes `/btp-transport-check`. | Import queue and transport execution checks remain pending. |
| `sap-btp-connectivity` | README now exposes `/btp-destination-diagnose`. | Destination, Cloud Connector, and network checks require tenant/network evidence. |
| `sap-btp-developer-guide` | Added `/btp-app-readiness-review` and README capability index. | Deployment readiness requires target application and BTP access. |
| `sap-btp-integration-suite` | Added `/integration-flow-review`, `integration-flow-advisor`, and README capability index. | Tenant deployment and message-processing checks remain pending. |
| `sap-btp-intelligent-situation-automation` | Added `/isa-export-readiness`; archived-service warning remains prominent. | Current tenant export/runtime checks require access. |
| `sap-btp-job-scheduling` | Added `/job-schedule-check` and README capability index. | Live scheduler service checks remain pending. |
| `sap-btp-master-data-integration` | Added `/mdi-replication-check` and README capability index. | Live replication and subscription checks remain pending. |
| `sap-btp-service-manager` | README now exposes `/btp-service-manager-troubleshoot`. | SMCTL/BTP CLI references need docs-only refresh; live checks require access. |
| `sap-cap-capire` | README capability index added; CAP MCP/LSP routing note added. | CAP MCP package upgrade candidate and live deployment checks remain pending. |
| `sap-cloud-sdk-ai` | README now exposes `/cloud-sdk-ai-chat-template`. | AI Core execution checks require tenant evidence. |
| `sap-cloud-sdk-ai-python` | README now exposes `/cloud-sdk-ai-python-chat-template`. | AI Core Python execution checks require tenant evidence. |
| `sap-datasphere` | README capability index added; MCP use-case routing added. | Datasphere MCP package upgrade candidate and live tenant checks remain pending. |
| `sap-dependency-security` | README capability index covers command plus hook behavior. | Current registry checks depend on target lockfiles and package manifests. |
| `sap-fiori-tools` | README now exposes two commands, Fiori advisor, and MCP config. | BAS/Fiori preview/deploy checks require target app and tenant evidence. |
| `sap-hana-cli` | README now exposes two commands, HANA advisor, and MCP config. | HANA database connectivity and object inspection require safe credentials. |
| `sap-hana-cloud-data-intelligence` | Added `/data-intelligence-pipeline-check` and README capability index. | Product lifecycle/source refresh and live graph checks remain pending. |
| `sap-hana-ml` | Added `/hana-ml-experiment-plan`; package freshness noted. | HANA connection, PAL, and APL checks remain pending. |
| `sap-sac-custom-widget` | README capability index covers commands, agents, and hooks. | Live SAC upload/runtime checks remain pending. |
| `sap-sac-planning` | README capability index added; progressive disclosure remains under 5k words. | Live SAC planning/model checks remain pending. |
| `sap-sac-scripting` | README capability index added; oversized OSE reference search routing added. | Live SAC story/runtime checks remain pending. |
| `sap-sqlscript` | README capability index covers current commands and hook behavior. | Live HANA execution-plan and SQLScript runtime checks remain pending. |
| `sapui5` | README capability index covers commands, agents, hook, and MCP. | Project-specific UI5 preview/build checks require a target app. |
| `sapui5-cli` | README now exposes `/ui5-cli-build` and `/ui5-cli-troubleshoot`. | Project-specific build checks require a target UI5 app. |
| `sapui5-linter` | README references `@ui5/linter` 1.22.0 and both linter commands. | Project-specific lint runs require target app evidence. |

## Validator Expectations

`npm run validate` now includes the effectiveness validation and fails when:

- A plugin-local README capability index is missing or drifts from filesystem inventory.
- An oversized reference over 10k words lacks SKILL.md search/routing guidance.
- A slash command lacks `## Output Contract`.
- A slash command with non-generation semantics does not state a read-only/non-mutating default.

## Unresolved Production-Only Checks

The following categories remain intentionally pending:

- SAP BTP subaccount, entitlement, role, destination, transport, and service-instance checks.
- SAP AI Core deployment and runtime behavior.
- SAP Integration Suite deployment/message processing behavior.
- SAP Cloud Identity Services trust, provisioning, and SSO behavior.
- SAP Datasphere tenant, MCP, data integration, and transport operations.
- SAP HANA connection, object inspection, PAL/APL, and SQLScript execution-plan checks.
- SAP Analytics Cloud story, planning, custom widget upload, and OSE runtime checks.
- SAPUI5/Fiori preview, deployment, and project-specific lint/build behavior.

## Commands Run

```bash
npm run audit:skills
npm run audit:effectiveness
npm run validate:effectiveness
```

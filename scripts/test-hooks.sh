#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required for hook tests" >&2
  exit 1
fi

failures=0

fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

run_hook() {
  local plugin="$1"
  local payload="$2"
  printf '%s' "$payload" | "$REPO_ROOT/plugins/$plugin/hooks/dispatch.sh"
}

assert_contains() {
  local name="$1"
  local haystack="$2"
  local needle="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "$name did not include expected text: $needle"
    echo "$haystack" >&2
  else
    echo "PASS: $name"
  fi
}

assert_empty_json() {
  local name="$1"
  local output="$2"
  if ! jq -e '. == {}' >/dev/null 2>&1 <<< "$output"; then
    fail "$name expected empty JSON object"
    echo "$output" >&2
  else
    echo "PASS: $name"
  fi
}

sql_delete_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "db/procedures/cleanup.sql",
    "content": "SELECT * FROM BOOKS WHERE ID = 1; DELETE FROM BOOKS;"
  }
}'

sql_update_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "models/sales.sql",
    "content": "SELECT * FROM SALES WHERE REGION = '\''EMEA'\''; UPDATE SALES SET AMOUNT = 0;"
  }
}'

safe_sql_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "db/procedures/cleanup.sql",
    "content": "DELETE FROM BOOKS WHERE ID = 1;"
  }
}'

secret_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "webapp/controller/Main.controller.js",
    "content": "sap.ui.define([], function () { const password = \"real-secret-value\"; });"
  }
}'

irrelevant_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Read",
  "tool_input": {
    "file_path": "webapp/controller/Main.controller.js",
    "content": "eval(\"alert(1)\");"
  }
}'

ui5_deploy_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "ui5 deploy --config ui5-deploy.yaml"
  }
}'

dependency_latest_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "plugins/sapui5/.mcp.json",
    "content": "{\"ui5-tooling\":{\"command\":\"npx\",\"args\":[\"-y\",\"@ui5/mcp-server@latest\"]}}"
  }
}'

dependency_bare_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "plugins/sap-hana-cli/.mcp.json",
    "content": "{\"hana-mcp-server\":{\"command\":\"npx\",\"args\":[\"-y\",\"hana-mcp-server\"]}}"
  }
}'

dependency_secret_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "plugins/sap-datasphere/.mcp.json",
    "content": "{\"sap-datasphere\":{\"command\":\"npx\",\"args\":[\"-y\",\"@mariodefe/sap-datasphere-mcp@1.2.1\"],\"env\":{\"DATASPHERE_CLIENT_SECRET\":\"super-secret-value\"}}}"
  }
}'

dependency_safe_payload='{
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "plugins/sapui5/.mcp.json",
    "content": "{\"ui5-tooling\":{\"command\":\"npx\",\"args\":[\"-y\",\"@ui5/mcp-server@0.2.11\"],\"env\":{\"TOKEN\":\"${TOKEN}\"}}}"
  }
}'

assert_contains "SQLScript DELETE without statement WHERE" "$(run_hook sap-sqlscript "$sql_delete_payload")" "DELETE statement appears without WHERE clause"
assert_contains "Datasphere UPDATE without statement WHERE" "$(run_hook sap-datasphere "$sql_update_payload")" "UPDATE statement appears without WHERE clause"
assert_empty_json "SQLScript DELETE with statement WHERE" "$(run_hook sap-sqlscript "$safe_sql_payload")"
assert_contains "UI5 hardcoded secret" "$(run_hook sapui5 "$secret_payload")" "Hardcoded credential/secret detected"
assert_empty_json "Irrelevant Read tool ignored" "$(run_hook sapui5 "$irrelevant_payload")"
assert_contains "UI5 deploy Bash guidance" "$(run_hook sapui5 "$ui5_deploy_payload")" "UI5 deployment command detected"
assert_contains "Dependency @latest blocked" "$(run_hook sap-dependency-security "$dependency_latest_payload")" "Floating dependency version detected"
assert_contains "Dependency bare MCP package blocked" "$(run_hook sap-dependency-security "$dependency_bare_payload")" "MCP executable is not exact-pinned"
assert_contains "Dependency credential literal blocked" "$(run_hook sap-dependency-security "$dependency_secret_payload")" "Credential-like literal detected"
assert_empty_json "Dependency exact pin and env placeholder allowed" "$(run_hook sap-dependency-security "$dependency_safe_payload")"

first_py=$(find "$REPO_ROOT/plugins" -path '*/hooks/validator.py' -type f ! -path '*/sap-dependency-security/*' | sort | head -n 1)
first_mjs=$(find "$REPO_ROOT/plugins" -path '*/hooks/validator.mjs' -type f ! -path '*/sap-dependency-security/*' | sort | head -n 1)

while IFS= read -r file; do
  diff -q "$first_py" "$file" >/dev/null || fail "Python hook validator differs from template: ${file#$REPO_ROOT/}"
done < <(find "$REPO_ROOT/plugins" -path '*/hooks/validator.py' -type f ! -path '*/sap-dependency-security/*' | sort)

while IFS= read -r file; do
  diff -q "$first_mjs" "$file" >/dev/null || fail "Node hook validator differs from template: ${file#$REPO_ROOT/}"
done < <(find "$REPO_ROOT/plugins" -path '*/hooks/validator.mjs' -type f ! -path '*/sap-dependency-security/*' | sort)

if [ "$failures" -gt 0 ]; then
  echo "Hook tests failed: $failures issue(s)." >&2
  exit 1
fi

echo "Hook tests passed."

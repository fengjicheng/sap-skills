#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARKETPLACE_JSON="$REPO_ROOT/.claude-plugin/marketplace.json"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

errors=0

fail() {
  echo -e "${RED}ERROR:${NC} $*"
  errors=$((errors + 1))
}

plugin_dirs=$(find "$REPO_ROOT/plugins" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
root_manifests=$(find "$REPO_ROOT/plugins" -path '*/.claude-plugin/plugin.json' -not -path '*/skills/*' -type f | wc -l | tr -d ' ')
nested_skill_manifests=$(find "$REPO_ROOT/plugins" -path '*/skills/*/.claude-plugin/plugin.json' -type f | wc -l | tr -d ' ')
packaged_artifacts=$(find "$REPO_ROOT/plugins" \( -type d -name '__pycache__' -o -type f \( -name '*.pyc' -o -name '*.backup' -o -name '*.bak' -o -name '*.tmp' -o -name '*~' -o -name '.DS_Store' \) \) -print)

if [ ! -f "$MARKETPLACE_JSON" ]; then
  fail "missing marketplace manifest: $MARKETPLACE_JSON"
else
  marketplace_count=$(jq -r '.plugins | length' "$MARKETPLACE_JSON")
  marketplace_total=$(jq -r '.metadata.total_skills' "$MARKETPLACE_JSON")
  marketplace_version=$(jq -r '.version' "$MARKETPLACE_JSON")
  metadata_version=$(jq -r '.metadata.version' "$MARKETPLACE_JSON")

  [ "$marketplace_count" = "$plugin_dirs" ] || fail "marketplace plugin count ($marketplace_count) does not match plugin directories ($plugin_dirs)"
  [ "$marketplace_total" = "$plugin_dirs" ] || fail "metadata.total_skills ($marketplace_total) does not match plugin directories ($plugin_dirs)"
  [ "$marketplace_version" = "$metadata_version" ] || fail "marketplace version ($marketplace_version) and metadata.version ($metadata_version) differ"
fi

[ "$root_manifests" = "$plugin_dirs" ] || fail "root plugin manifest count ($root_manifests) does not match plugin directories ($plugin_dirs)"
[ "$nested_skill_manifests" = "0" ] || fail "nested skill-level plugin manifests found ($nested_skill_manifests); this repo uses root manifests only"

if [ -n "$packaged_artifacts" ]; then
  while IFS= read -r artifact; do
    fail "packaged/generated artifact found under plugins: ${artifact#$REPO_ROOT/}"
  done <<< "$packaged_artifacts"
fi

for plugin_dir in "$REPO_ROOT/plugins"/*; do
  [ -d "$plugin_dir" ] || continue
  plugin_name="$(basename "$plugin_dir")"
  plugin_json="$plugin_dir/.claude-plugin/plugin.json"
  [ -f "$plugin_json" ] || continue

  if [ -f "$plugin_dir/hooks/hooks.json" ]; then
    actual_hooks="$(jq -r '.hooks // empty' "$plugin_json")"
    [ "$actual_hooks" = "./hooks/hooks.json" ] || fail "$plugin_name plugin.json must expose hooks: ./hooks/hooks.json"
  fi

  if [ -f "$plugin_dir/.mcp.json" ]; then
    actual_mcp="$(jq -r '.mcpServers // empty' "$plugin_json")"
    [ "$actual_mcp" = "./.mcp.json" ] || fail "$plugin_name plugin.json must expose mcpServers: ./.mcp.json"
  fi

  if [ -f "$MARKETPLACE_JSON" ]; then
    marketplace_hooks="$(jq -r --arg name "$plugin_name" '.plugins[] | select(.name == $name) | .hooks // empty' "$MARKETPLACE_JSON")"
    marketplace_mcp="$(jq -r --arg name "$plugin_name" '.plugins[] | select(.name == $name) | .mcpServers // empty' "$MARKETPLACE_JSON")"

    if [ -f "$plugin_dir/hooks/hooks.json" ]; then
      [ "$marketplace_hooks" = "./hooks/hooks.json" ] || fail "$plugin_name marketplace entry must expose hooks: ./hooks/hooks.json"
    fi

    if [ -f "$plugin_dir/.mcp.json" ]; then
      [ "$marketplace_mcp" = "./.mcp.json" ] || fail "$plugin_name marketplace entry must expose mcpServers: ./.mcp.json"
    fi
  fi
done

echo ""
echo "Repository inventory"
echo "--------------------"
echo -e "Plugins:              ${BLUE}$plugin_dirs${NC}"
echo -e "Root plugin manifests: ${BLUE}$root_manifests${NC}"
echo -e "Nested manifests:      ${BLUE}$nested_skill_manifests${NC}"
if [ -f "$MARKETPLACE_JSON" ]; then
  echo -e "Marketplace plugins:   ${BLUE}$marketplace_count${NC}"
  echo -e "Marketplace version:   ${BLUE}$marketplace_version${NC}"
fi

if [ "$errors" -gt 0 ]; then
  echo ""
  echo -e "${RED}Inventory validation failed: $errors issue(s).${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}Inventory validation passed.${NC}"

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

#!/bin/bash
set -euo pipefail

# validate-reserved-words.sh
# Validates marketplace/plugin names for reserved-name compatibility and applies
# this repository's stricter description style rule separately.
#
# Name compatibility: marketplace/plugin names must not impersonate reserved
# providers or documented marketplace names.
# Description style: this repo avoids "official", "anthropic", and "claude" in
# generated marketplace descriptions so public copy does not imply endorsement.
#
# Usage: ./scripts/validate-reserved-words.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Reserved name and repo style patterns (case-insensitive)
RESERVED_NAME_PATTERN="(^|[-_])(official|anthropic|claude)([-_]|$)"
DESCRIPTION_STYLE_PATTERN="(official|anthropic|claude)"

# Verify jq is installed
if ! command -v jq &> /dev/null; then
    echo -e "${RED}Error: jq is required but not installed.${NC}"
    echo "Install jq: apt-get install jq (Ubuntu) or brew install jq (macOS)"
    exit 1
fi

echo "🔍 Reserved Name and Description Style Validation"
echo "============================="
echo ""
echo "Checking names for reserved/impersonating terms and descriptions for repository style"
echo ""

ERRORS=0
MARKETPLACE_CHECKED=false

# Function to check a JSON file for reserved names and description style.
check_file() {
    local file="$1"
    local relpath="${file#$REPO_ROOT/}"

    local name_value desc_value
    if ! name_value=$(jq -r '.name // ""' "$file" 2>&1); then
        echo -e "${RED}✗${NC} $relpath"
        echo "  Failed to parse JSON: $name_value"
        return 1
    fi
    desc_value=$(jq -r '.description // ""' "$file")

    if echo "$name_value" | grep -iE "$RESERVED_NAME_PATTERN" > /dev/null 2>&1; then
        echo -e "${RED}✗${NC} $relpath"
        echo "  Reserved or impersonating term found in name: $name_value"
        return 1
    elif echo "$desc_value" | grep -iE "$DESCRIPTION_STYLE_PATTERN" > /dev/null 2>&1; then
        echo -e "${RED}✗${NC} $relpath"
        echo "  Repository description style violation (not a CLI reserved-name rule): $desc_value"
        return 1
    else
        echo -e "${GREEN}✓${NC} $relpath"
        return 0
    fi
}

check_marketplace_entries() {
    local file="$1"
    local relpath="${file#$REPO_ROOT/}"
    local failures=0

    local entries
    if ! entries=$(jq -r '
        .plugins // []
        | to_entries[]
        | select(
            ((.value.name // "") | test($namePattern; "i"))
            or ((.value.description // "") | test($descriptionPattern; "i"))
          )
        | "\(.key)\t\(.value.name // "")\t\(.value.description // "")"
      ' --arg namePattern "$RESERVED_NAME_PATTERN" --arg descriptionPattern "$DESCRIPTION_STYLE_PATTERN" "$file" 2>&1); then
        echo -e "${RED}✗${NC} $relpath"
        echo "  Failed to inspect marketplace plugin entries: $entries"
        return 1
    fi

    if [ -n "$entries" ]; then
        echo -e "${RED}✗${NC} $relpath plugins[]"
        while IFS=$'\t' read -r index name_value desc_value; do
            [ -z "$index" ] && continue
            echo "  plugins[$index] contains a reserved name term or description style violation"
            if echo "$name_value" | grep -iE "$RESERVED_NAME_PATTERN" > /dev/null 2>&1; then
                echo "    reserved/impersonating name: $name_value"
            fi
            if echo "$desc_value" | grep -iE "$DESCRIPTION_STYLE_PATTERN" > /dev/null 2>&1; then
                echo "    repository description style: $desc_value"
            fi
            failures=$((failures + 1))
        done <<< "$entries"
    else
        echo -e "${GREEN}✓${NC} $relpath plugins[]"
    fi

    [ "$failures" -eq 0 ]
}

# Check marketplace.json
echo "📋 Checking marketplace.json..."
MARKETPLACE_JSON="$REPO_ROOT/.claude-plugin/marketplace.json"
if [ -f "$MARKETPLACE_JSON" ]; then
    MARKETPLACE_CHECKED=true
    if ! check_file "$MARKETPLACE_JSON"; then
        ERRORS=$((ERRORS + 1))
    fi
    if ! check_marketplace_entries "$MARKETPLACE_JSON"; then
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${YELLOW}⚠${NC} marketplace.json not found at $MARKETPLACE_JSON"
fi
echo ""

# Check all plugin.json files
echo "🔧 Checking plugin.json files..."
PLUGIN_COUNT=0

while IFS= read -r -d '' plugin_json; do
    PLUGIN_COUNT=$((PLUGIN_COUNT + 1))
    if ! check_file "$plugin_json"; then
        ERRORS=$((ERRORS + 1))
    fi
done < <(find "$REPO_ROOT/plugins" -name "plugin.json" -path "*/\.claude-plugin/plugin.json" -print0 2>/dev/null)

echo ""
if [ "$MARKETPLACE_CHECKED" = true ]; then
    echo "Summary: Checked $PLUGIN_COUNT plugin.json files + marketplace.json"
else
    echo "Summary: Checked $PLUGIN_COUNT plugin.json files"
fi
echo ""

if [ $ERRORS -gt 0 ]; then
    echo -e "${RED}❌ Validation failed: $ERRORS reserved-name/style issue(s) found${NC}"
    echo ""
    echo "Marketplace/plugin names must not impersonate reserved providers."
    echo "Descriptions also follow this repo's stricter style rule. Use alternatives like:"
    echo "  - 'AI coding assistant' instead of 'Claude'"
    echo "  - 'the Code CLI' instead of 'Claude Code CLI'"
    exit 1
else
    echo -e "${GREEN}✅ All files passed validation${NC}"
    exit 0
fi

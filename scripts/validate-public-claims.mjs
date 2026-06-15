#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanRoots = [
  "README.md",
  "CLAUDE.md",
  ".claude-plugin/marketplace.json",
  "docs/project",
  "plugins",
];
const unsafeClaimPattern = /\b(production-ready|production-tested|ready for production|ready to ship|100%\s+(?:compliant|compliance|error prevention|backward compatible)|verified\s*-\s*ready to ship)\b/i;
const quantifiedOutcomePattern = /\b(ROI|time savings|hours saved|minutes saved|days saved|annual value|productivity gains|cost reduction|total ROI|\$[0-9][0-9,]*(?:\+)?(?:\/year| per year)?|\d+(?:\.\d+)?\s*(?:minutes?|hours?|days?)\s+saved)\b/i;
const historicalAllowPattern = /\bhistorical\/superseded claim\b/i;
const illustrativeAllowPattern = /\b(illustrative|planning assumption|not repository-verified|not repo-verified|source material|example only|examples? for planning discussion)\b/i;
const errors = [];

function walk(fileOrDir, out = []) {
  if (!fs.existsSync(fileOrDir)) return out;
  const stat = fs.statSync(fileOrDir);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(fileOrDir, { withFileTypes: true })) {
      walk(path.join(fileOrDir, entry.name), out);
    }
  } else if (stat.isFile() && /\.(md|json)$/.test(fileOrDir)) {
    out.push(fileOrDir);
  }
  return out;
}

function rel(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

for (const root of scanRoots) {
  for (const file of walk(path.join(repoRoot, root))) {
    const text = fs.readFileSync(file, "utf8");
    const fileAllowsHistoricalClaims = historicalAllowPattern.test(text);
    const fileAllowsIllustrativeClaims = illustrativeAllowPattern.test(text);
    const lines = text.split(/\r?\n/);
    const relativePath = rel(file);
    lines.forEach((line, index) => {
      if (!relativePath.startsWith("plugins/") && unsafeClaimPattern.test(line) && !historicalAllowPattern.test(line) && !fileAllowsHistoricalClaims) {
        errors.push(`${relativePath}:${index + 1}: unsupported production/compliance claim must be evidence-scoped or marked as historical/superseded`);
      }
      if (quantifiedOutcomePattern.test(line) && !illustrativeAllowPattern.test(line) && !fileAllowsIllustrativeClaims) {
        errors.push(`${relativePath}:${index + 1}: quantified ROI/time-savings claim must have provenance or be marked as illustrative`);
      }
    });
  }
}

if (errors.length > 0) {
  console.error("Public claim validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Public claim validation passed.");

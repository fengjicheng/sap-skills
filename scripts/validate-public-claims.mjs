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

// Exemption scoping: a line is exempt if EITHER:
//   1. The line itself carries an illustrative/historical marker, OR
//   2. The file's preamble (first 12 lines) declares the whole document
//      illustrative/historical (common for reference docs whose body is all
//      examples), OR
//   3. The nearest preceding markdown heading's section contains a marker.
// This prevents a stray mid-file marker from granting blanket immunity to
// unrelated sections while still allowing whole-document and section-level
// illustrative blocks.
const HEADER_SCAN_LINES = 12;

function isMarkdownHeading(line) {
  return /^#{1,6}\s/.test(line);
}

for (const root of scanRoots) {
  for (const file of walk(path.join(repoRoot, root))) {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    const relativePath = rel(file);
    const headerIllustrative = lines.slice(0, HEADER_SCAN_LINES).some((line) => illustrativeAllowPattern.test(line));
    const headerHistorical = lines.slice(0, HEADER_SCAN_LINES).some((line) => historicalAllowPattern.test(line));
    let sectionHasIllustrative = headerIllustrative;
    let sectionHasHistorical = headerHistorical;

    lines.forEach((line, index) => {
      if (isMarkdownHeading(line)) {
        let end = lines.length;
        for (let j = index + 1; j < lines.length; j++) {
          if (isMarkdownHeading(lines[j])) { end = j; break; }
        }
        sectionHasIllustrative = headerIllustrative
          || lines.slice(index, end).some((l) => illustrativeAllowPattern.test(l));
        sectionHasHistorical = headerHistorical
          || lines.slice(index, end).some((l) => historicalAllowPattern.test(l));
      }

      if (!relativePath.startsWith("plugins/") && unsafeClaimPattern.test(line)
        && !historicalAllowPattern.test(line) && !sectionHasHistorical) {
        errors.push(`${relativePath}:${index + 1}: unsupported production/compliance claim must be evidence-scoped or marked as historical/superseded`);
      }
      if (quantifiedOutcomePattern.test(line) && !illustrativeAllowPattern.test(line) && !sectionHasIllustrative) {
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

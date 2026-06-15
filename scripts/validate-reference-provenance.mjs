#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = path.join(repoRoot, "plugins");
const provenanceMarkerPattern = /^(?:#{1,6}\s*)?(?:\*\*)?(?:Official source excerpt|Derived summary|Synthetic example|Tenant-specific example|Historical\/archived|Vendored; excluded from content review|Official Sources|Sources|Documentation Source|Source)(?:\*\*)?\b\s*:?\s*(?:\S.*)?$/im;
const provenanceFrontmatterPattern = /^(?:source|sources|source_docs|documentation_source|full_api_docs|sap_help):\s*\S/im;
const errors = [];
const warnings = [];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function isReferenceMarkdown(file) {
  const segments = path.relative(pluginsRoot, file).split(path.sep);
  return segments.includes("references") && file.endsWith(".md");
}

function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] : "";
}

function hasProvenanceMarker(text) {
  return provenanceMarkerPattern.test(text) || provenanceFrontmatterPattern.test(frontmatter(text));
}

for (const file of walk(pluginsRoot).filter(isReferenceMarkdown)) {
  const rel = path.relative(repoRoot, file).replaceAll(path.sep, "/");
  const text = fs.readFileSync(file, "utf8");
  if (!hasProvenanceMarker(text)) {
    warnings.push(`${rel}: reference should include a source/provenance marker in a future manual pass`);
  }
  if (/READY FOR PRODUCTION|100% Compliant/i.test(text)) {
    errors.push(`${rel}: unsupported production/compliance claim requires explicit evidence`);
  }
}

if (errors.length > 0) {
  console.error("Reference provenance validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

console.log("Reference provenance validation passed.");

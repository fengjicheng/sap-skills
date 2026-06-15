#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { repoRootFrom } from "./lib/validation-utils.mjs";

const repoRoot = repoRootFrom(import.meta.url);
const pluginsRoot = path.join(repoRoot, "plugins");
const staleAfterDays = 90;

function exists(file) {
  return fs.existsSync(file);
}

function countFiles(dir, predicate = () => true) {
  if (!exists(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .length;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1] : "";
}

function metadataValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^  ${key}:\\s*["']?([^"'\n]+)["']?\\s*$`, "m"));
  return match ? match[1].trim() : "";
}

function daysSince(dateText, now = new Date()) {
  const parsed = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.floor((today.getTime() - parsed.getTime()) / 86_400_000);
}

function nextRecommendation(row) {
  if (row.hooks === 0 && ["sap-dependency-security"].includes(row.name)) return "add hook profile";
  if (row.commands === 0 && row.templates > 0) return "add template command";
  if (row.commands === 0 && row.mcp) return "add MCP helper command";
  if (row.agents === 0 && ["sap-fiori-tools", "sap-hana-cli"].includes(row.name)) return "add specialist agent";
  if (row.stale) return "docs-only verify";
  return "maintain";
}

const pluginNames = fs.readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const rows = [];
for (const name of pluginNames) {
  const root = path.join(pluginsRoot, name);
  const skillFile = path.join(root, "skills", name, "SKILL.md");
  const skillText = exists(skillFile) ? fs.readFileSync(skillFile, "utf8") : "";
  const frontmatter = parseFrontmatter(skillText);
  const lastVerified = metadataValue(frontmatter, "last_verified");
  const age = lastVerified ? daysSince(lastVerified) : null;

  const row = {
    name,
    words: skillText ? skillText.trim().split(/\s+/).filter(Boolean).length : 0,
    references: countFiles(path.join(root, "skills", name, "references"), (file) => file.endsWith(".md")),
    templates: countFiles(path.join(root, "skills", name, "templates")),
    scripts: countFiles(path.join(root, "skills", name, "scripts")),
    commands: countFiles(path.join(root, "commands"), (file) => file.endsWith(".md")),
    agents: countFiles(path.join(root, "agents"), (file) => file.endsWith(".md")),
    hooks: exists(path.join(root, "hooks", "hooks.json")) ? 1 : 0,
    mcp: exists(path.join(root, ".mcp.json")),
    lsp: exists(path.join(root, ".lsp.json")),
    lastVerified: lastVerified || "missing",
    stale: age === null || age > staleAfterDays,
  };
  row.next = nextRecommendation(row);
  rows.push(row);
}

const totals = rows.reduce((acc, row) => {
  acc.commands += row.commands;
  acc.agents += row.agents;
  acc.hooks += row.hooks;
  acc.mcp += row.mcp ? 1 : 0;
  acc.lsp += row.lsp ? 1 : 0;
  acc.stale += row.stale ? 1 : 0;
  return acc;
}, { commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0, stale: 0 });

console.log("SAP Skills capability audit");
console.log("===========================");
console.log(`plugins: ${rows.length}`);
console.log(`commands: ${totals.commands}`);
console.log(`agents: ${totals.agents}`);
console.log(`hook-enabled plugins: ${totals.hooks}`);
console.log(`mcp configs: ${totals.mcp}`);
console.log(`lsp configs: ${totals.lsp}`);
console.log(`stale or missing last_verified: ${totals.stale}`);
console.log("");

console.log([
  "plugin",
  "words",
  "refs",
  "templates",
  "scripts",
  "commands",
  "agents",
  "hooks",
  "mcp",
  "lsp",
  "last_verified",
  "next",
].join("\t"));

for (const row of rows) {
  console.log([
    row.name,
    row.words,
    row.references,
    row.templates,
    row.scripts,
    row.commands,
    row.agents,
    row.hooks,
    row.mcp ? "yes" : "no",
    row.lsp ? "yes" : "no",
    row.lastVerified,
    row.next,
  ].join("\t"));
}

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pluginsRoot = path.join(repoRoot, "plugins");
const validate = process.argv.includes("--validate");
const staleAfterDays = 90;
const referenceWordLimit = 10_000;

function exists(file) {
  return fs.existsSync(file);
}

function walk(dir, out = []) {
  if (!exists(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function rel(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

function read(file) {
  return exists(file) ? fs.readFileSync(file, "utf8") : "";
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? match[1] : "";
}

function scalarValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
  if (match && match[1].trim() !== "|" && match[1].trim() !== ">") {
    return match[1].trim();
  }

  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return "";

  const out = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(line)) break;
    const trimmed = line.replace(/^\s+/, "").trim();
    if (trimmed) out.push(trimmed);
  }
  return out.join(" ").trim();
}

function metadataValue(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^  ${key}:\\s*["']?([^"'\\n]+)["']?\\s*$`, "m"));
  return match ? match[1].trim() : "";
}

function daysSince(dateText, now = new Date()) {
  const parsed = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.floor((today.getTime() - parsed.getTime()) / 86_400_000);
}

function mdFiles(dir) {
  return walk(dir).filter((file) => file.endsWith(".md"));
}

function countMarkdownFiles(dir) {
  if (!exists(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .length;
}

function fileNames(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .sort();
}

function capabilityValue(readme, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = readme.match(new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|\\s*$`, "mi"));
  return match ? match[1].trim() : "";
}

function countFromValue(value) {
  if (!value) return null;
  const count = value.match(/^(\d+)\b/);
  if (count) return Number(count[1]);
  if (/^no\b/i.test(value)) return 0;
  if (/^yes\b/i.test(value)) return 1;
  return null;
}

function yesNoFromValue(value) {
  if (!value) return null;
  if (/^yes\b/i.test(value)) return true;
  if (/^no\b/i.test(value)) return false;
  return null;
}

function triggerQuality(frontmatter) {
  const description = scalarValue(frontmatter, "description");
  const hasWhen = /\bwhen\b|\buse this skill\b|\bshould be used\b/i.test(description);
  const hasSap = /\bSAP\b|\bBTP\b|\bUI5\b|\bCAP\b|\bHANA\b|\bSAC\b|\bABAP\b/i.test(description);
  const hasAction = /\b(review|diagnos|build|generate|lint|check|troubleshoot|develop|implement|model|deploy|configure)\b/i.test(description);
  const score = [description.length >= 80, hasWhen, hasSap, hasAction].filter(Boolean).length;
  if (score >= 4) return "strong";
  if (score >= 2) return "adequate";
  return "weak";
}

function nextArtifact(row) {
  if (row.readmeDrift.length > 0) return "fix README capability index";
  if (row.oversizedRefs.length > 0 && !row.routesOversizedRefs) return "add reference search routing";
  if (row.commandsMissingContract.length > 0) return "standardize command output contracts";
  if (row.triggerQuality === "weak") return "rewrite trigger description";
  if (row.stale) return "docs-only verify stale metadata";
  return "maintain";
}

const pluginNames = fs.readdirSync(pluginsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const errors = [];
const warnings = [];
const rows = [];

for (const pluginName of pluginNames) {
  const pluginRoot = path.join(pluginsRoot, pluginName);
  const skillRoot = path.join(pluginRoot, "skills", pluginName);
  const skillFile = path.join(skillRoot, "SKILL.md");
  const readmeFile = path.join(skillRoot, "README.md");
  const skillText = read(skillFile);
  const readmeText = read(readmeFile);
  const frontmatter = parseFrontmatter(skillText);
  const lastVerified = metadataValue(frontmatter, "last_verified");
  const age = lastVerified ? daysSince(lastVerified) : null;

  const commands = fileNames(path.join(pluginRoot, "commands"));
  const agents = fileNames(path.join(pluginRoot, "agents"));
  const hasHooks = exists(path.join(pluginRoot, "hooks", "hooks.json"));
  const hasMcp = exists(path.join(pluginRoot, ".mcp.json"));
  const hasLsp = exists(path.join(pluginRoot, ".lsp.json"));

  const referenceFiles = mdFiles(path.join(skillRoot, "references"));
  const oversizedRefs = referenceFiles
    .map((file) => ({ file, words: countWords(read(file)) }))
    .filter((item) => item.words > referenceWordLimit)
    .sort((a, b) => b.words - a.words);

  const routesOversizedRefs = oversizedRefs.every((item) => {
    const basename = path.basename(item.file);
    return skillText.includes(basename) && /\b(rg|grep|search routing|search pattern|search first)\b/i.test(skillText);
  });

  const commandsMissingContract = commands.filter((name) => {
    const file = path.join(pluginRoot, "commands", `${name}.md`);
    return !/^## Output Contract\b/m.test(read(file));
  });

  const mutatingRiskCommands = commands.filter((name) => {
    if (/(generate|template|fix|plan|setup|scaffold|convert)/i.test(name)) return false;
    const body = read(path.join(pluginRoot, "commands", `${name}.md`));
    return !/\b(default to|defaulting to|do not|non-mutating|read-only|analysis-only|inspection only)\b/i.test(body);
  });

  const readmeDrift = [];
  if (!readmeText) {
    readmeDrift.push("missing README.md");
  } else if (!/^## Capability Index\b/m.test(readmeText)) {
    readmeDrift.push("missing Capability Index");
  } else {
    const readmeCommands = countFromValue(capabilityValue(readmeText, "Commands"));
    const readmeAgents = countFromValue(capabilityValue(readmeText, "Agents"));
    const readmeHooks = yesNoFromValue(capabilityValue(readmeText, "Hooks"));
    const readmeMcp = yesNoFromValue(capabilityValue(readmeText, "MCP"));
    const readmeLsp = yesNoFromValue(capabilityValue(readmeText, "LSP"));
    const freshness = capabilityValue(readmeText, "Source Freshness");

    if (readmeCommands !== commands.length) readmeDrift.push(`Commands ${readmeCommands ?? "missing"} != ${commands.length}`);
    if (readmeAgents !== agents.length) readmeDrift.push(`Agents ${readmeAgents ?? "missing"} != ${agents.length}`);
    if (readmeHooks !== hasHooks) readmeDrift.push(`Hooks ${readmeHooks ?? "missing"} != ${hasHooks}`);
    if (readmeMcp !== hasMcp) readmeDrift.push(`MCP ${readmeMcp ?? "missing"} != ${hasMcp}`);
    if (readmeLsp !== hasLsp) readmeDrift.push(`LSP ${readmeLsp ?? "missing"} != ${hasLsp}`);
    if (lastVerified && !freshness.includes(lastVerified)) {
      readmeDrift.push(`Source Freshness missing metadata last_verified ${lastVerified}`);
    }
  }

  const bodyVerificationDates = [...readmeText.matchAll(/Last Verified[^0-9]*(\d{4}-\d{2}-\d{2})/gi)].map((match) => match[1]);
  const conflictingDates = [...new Set(bodyVerificationDates.filter((date) => lastVerified && date !== lastVerified))];
  if (conflictingDates.length > 0) {
    warnings.push(`${pluginName}: README/body Last Verified date(s) ${conflictingDates.join(", ")} differ from metadata ${lastVerified}; confirm before advancing dates.`);
  }

  const row = {
    pluginName,
    skillWords: countWords(skillText),
    triggerQuality: triggerQuality(frontmatter),
    references: referenceFiles.length,
    oversizedRefs,
    routesOversizedRefs,
    readmeDrift,
    commands,
    agents,
    hasHooks,
    hasMcp,
    hasLsp,
    commandsMissingContract,
    mutatingRiskCommands,
    lastVerified: lastVerified || "missing",
    stale: age === null || age > staleAfterDays,
  };
  row.next = nextArtifact(row);
  rows.push(row);

  if (validate) {
    for (const issue of readmeDrift) {
      errors.push(`${pluginName}: README capability drift: ${issue}`);
    }
    if (oversizedRefs.length > 0 && !routesOversizedRefs) {
      errors.push(`${pluginName}: oversized references require SKILL.md search routing (${oversizedRefs.map((item) => path.basename(item.file)).join(", ")})`);
    }
    for (const command of commandsMissingContract) {
      errors.push(`${pluginName}/commands/${command}.md: missing ## Output Contract`);
    }
    for (const command of mutatingRiskCommands) {
      errors.push(`${pluginName}/commands/${command}.md: command must state a read-only/non-mutating default or be an explicit generation/fix command`);
    }
  }
}

const totals = rows.reduce((acc, row) => {
  acc.commands += row.commands.length;
  acc.agents += row.agents.length;
  acc.hooks += row.hasHooks ? 1 : 0;
  acc.mcp += row.hasMcp ? 1 : 0;
  acc.lsp += row.hasLsp ? 1 : 0;
  acc.oversizedRefs += row.oversizedRefs.length;
  acc.readmeDrift += row.readmeDrift.length > 0 ? 1 : 0;
  acc.stale += row.stale ? 1 : 0;
  return acc;
}, { commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0, oversizedRefs: 0, readmeDrift: 0, stale: 0 });

console.log("SAP Skills effectiveness audit");
console.log("==============================");
console.log(`plugins: ${rows.length}`);
console.log(`commands: ${totals.commands}`);
console.log(`agents: ${totals.agents}`);
console.log(`hook-enabled plugins: ${totals.hooks}`);
console.log(`mcp configs: ${totals.mcp}`);
console.log(`lsp configs: ${totals.lsp}`);
console.log(`oversized references: ${totals.oversizedRefs}`);
console.log(`README drift: ${totals.readmeDrift}`);
console.log(`stale or missing last_verified: ${totals.stale}`);
console.log("");
console.log([
  "plugin",
  "trigger",
  "skill_words",
  "oversized_refs",
  "readme_drift",
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
    row.pluginName,
    row.triggerQuality,
    row.skillWords,
    row.oversizedRefs.length,
    row.readmeDrift.length,
    row.commands.length,
    row.agents.length,
    row.hasHooks ? "yes" : "no",
    row.hasMcp ? "yes" : "no",
    row.hasLsp ? "yes" : "no",
    row.lastVerified,
    row.next,
  ].join("\t"));
}

if (warnings.length > 0) {
  console.log("");
  console.log("Warnings");
  console.log("--------");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length > 0) {
  console.error("");
  console.error("Effectiveness validation failed:");
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

if (validate) {
  console.log("");
  console.log(`Effectiveness validation passed for ${rows.length} plugin(s).`);
}

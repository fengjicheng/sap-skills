#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginsRoot = path.join(repoRoot, "plugins");
const validate = process.argv.includes("--validate");
const jsonOutput = process.argv.includes("--json");
const reportIndex = process.argv.indexOf("--report");
const reportPath = reportIndex === -1 ? null : process.argv[reportIndex + 1];
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
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
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
  const lines = frontmatter.split(/\r?\n/);
  const metadataStart = lines.findIndex((line) => /^metadata:\s*$/.test(line));
  if (metadataStart === -1) return "";

  for (let index = metadataStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line)) break;
    const match = line.match(new RegExp(`^  ${key}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`));
    if (match) return match[1].trim();
  }

  return "";
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
  const hasAction = /\b(review|diagnos(?:e|es|ed|ing|is|tic|tics)|build|generate|lint|check|troubleshoot|develop|implement|model|deploy|configure)\b/i.test(description);
  const score = [description.length >= 80, hasWhen, hasSap, hasAction].filter(Boolean).length;
  if (score >= 4) return "strong";
  if (score >= 2) return "adequate";
  return "weak";
}

function triggerPrecisionIssues(frontmatter) {
  const description = scalarValue(frontmatter, "description");
  const issues = [];
  const productTerms = description.match(/\b(SAP|BTP|UI5|OpenUI5|CAP|HANA|SAC|ABAP|Fiori|Datasphere|Integration Suite|Cloud SDK|AI Core|Analytics Cloud)\b/gi) ?? [];
  const uniqueProductTerms = new Set(productTerms.map((term) => term.toLowerCase()));
  const actionTerms = description.match(/\b(review(?:ing)?|diagnos(?:e|es|ing|is|tic|tics)|debug(?:ging)?|build(?:ing)?|generate|lint(?:ing)?|check(?:ing)?|troubleshoot(?:ing)?|develop(?:ing)?|implement(?:ing)?|model(?:ing)?|deploy(?:ing)?|configure|migrate|secure|plan(?:ning)?|validate|optimize|manage|create|run(?:ning)?)\b/gi) ?? [];
  const repeatedTerms = repeatedTriggerTerms(description);

  if (description.length > 800) {
    issues.push(`long description (${description.length} chars)`);
  }
  if (uniqueProductTerms.size > 8) {
    issues.push(`broad product list (${uniqueProductTerms.size} SAP terms)`);
  }
  if (actionTerms.length < 2 && uniqueProductTerms.size >= 5) {
    issues.push("product-heavy description with few task/action triggers");
  }
  if (repeatedTerms.length > 0) {
    issues.push(`repeated trigger terms (${repeatedTerms.join(", ")})`);
  }
  if (/\bSAP\b/i.test(description) && !/\bwhen|use this skill|use when|for\b/i.test(description)) {
    issues.push("generic SAP wording without clear activation context");
  }

  return issues;
}

function repeatedTriggerTerms(text) {
  const counts = new Map();
  for (const term of text.toLowerCase().match(/\b[a-z][a-z0-9-]{4,}\b/g) ?? []) {
    if (["sapui5", "openui5", "fiori", "hana", "datasphere", "integration", "cloud", "analytics"].includes(term)) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 6)
    .map(([term]) => term)
    .sort();
}

function nextArtifact(row) {
  if (row.readmeDrift.length > 0) return "fix README capability index";
  if (row.oversizedRefs.length > 0 && !row.routesOversizedRefs) return "add reference search routing";
  if (row.commandsMissingContract.length > 0) return "standardize command output contracts";
  if (row.triggerPrecisionIssues.length > 0) return "tighten trigger precision";
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
    const hasSafeDefault = /\b(non-mutating|read-only|analysis-only|inspection only|inspect only|advisory only)\b/i.test(body)
      || /\bdefault(?:s|ing)?\s+to\b[^.\n]*(?:read-only|non-mutating|analysis|inspection|advisory|planning|guidance)/i.test(body)
      || /\bdo not\b[^.\n]*(?:write|edit|modify|change|create|delete|mutate|apply|deploy|execute|run|publish|upload|alter|trigger)/i.test(body);
    return !hasSafeDefault;
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
    triggerPrecisionIssues: triggerPrecisionIssues(frontmatter),
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

  for (const issue of row.triggerPrecisionIssues) {
    warnings.push(`${pluginName}: trigger precision risk: ${issue}`);
  }

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
  acc.triggerPrecision += row.triggerPrecisionIssues.length > 0 ? 1 : 0;
  return acc;
}, { commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: 0, oversizedRefs: 0, readmeDrift: 0, stale: 0, triggerPrecision: 0 });

const report = {
  schemaVersion: 1,
  totals,
  warnings,
  validationErrors: errors,
  plugins: rows.map((row) => ({
    pluginName: row.pluginName,
    triggerQuality: row.triggerQuality,
    triggerPrecisionIssues: row.triggerPrecisionIssues,
    skillWordCount: row.skillWords,
    oversizedReferences: row.oversizedRefs.map((item) => ({
      file: rel(item.file),
      words: item.words,
    })),
    routesOversizedReferences: row.routesOversizedRefs,
    readmeDrift: row.readmeDrift,
    commandCount: row.commands.length,
    agentCount: row.agents.length,
    hasHooks: row.hasHooks,
    hasMcp: row.hasMcp,
    hasLsp: row.hasLsp,
    lastVerified: row.lastVerified,
    staleOrMissingLastVerified: row.stale,
    nextRecommendedArtifact: row.next,
    validationErrors: [
      ...row.readmeDrift.map((issue) => `README capability drift: ${issue}`),
      ...row.commandsMissingContract.map((command) => `commands/${command}.md missing output contract`),
      ...row.mutatingRiskCommands.map((command) => `commands/${command}.md missing safe default`),
    ],
    warnings: row.triggerPrecisionIssues.map((issue) => `trigger precision risk: ${issue}`),
  })),
};

if (reportPath) {
  const target = path.resolve(repoRoot, reportPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  printHumanReport();
}

function printHumanReport() {
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
  console.log(`trigger precision warnings: ${totals.triggerPrecision}`);
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
}

if (!jsonOutput && warnings.length > 0) {
  console.log("");
  console.log("Warnings");
  console.log("--------");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (errors.length > 0) {
  if (!jsonOutput) console.error("");
  console.error("Effectiveness validation failed:");
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

if (validate && !jsonOutput) {
  console.log("");
  console.log(`Effectiveness validation passed for ${rows.length} plugin(s).`);
}

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const rules = {
  commands: {
    pattern: /^plugins\/[^/]+\/commands\/[^/]+\.md$/,
    required: ["name", "description"],
    allowed: new Set(["name", "description", "arguments", "args", "allowed-tools", "argument-hint"]),
  },
  agents: {
    pattern: /^plugins\/[^/]+\/agents\/[^/]+\.md$/,
    required: ["name", "description"],
    allowed: new Set(["name", "description", "model", "color", "tools"]),
  },
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function parseFrontmatter(file) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  if (lines[0] !== "---") {
    return { error: "missing opening frontmatter marker" };
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    return { error: "missing closing frontmatter marker" };
  }

  const frontmatter = lines.slice(1, end);
  const keys = [];
  const values = new Map();
  for (const line of frontmatter) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/);
    if (match) {
      keys.push(match[1]);
      values.set(match[1], line.slice(match[0].length).trim());
    }
  }

  return { keys, values, frontmatter: frontmatter.join("\n"), body: lines.slice(end + 1).join("\n") };
}

function stringValue(parsed, key) {
  const inline = parsed.values.get(key);
  if (inline && inline !== "|" && inline !== ">") {
    return inline.replace(/^["']|["']$/g, "").trim();
  }

  const lines = parsed.frontmatter.split(/\r?\n/);
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

function listValueCount(parsed, key) {
  if (!parsed.values.has(key)) return 0;
  const inline = parsed.values.get(key);
  if (inline && inline !== "|" && inline !== ">") {
    if (inline.startsWith("[") && inline.endsWith("]")) {
      return inline.split(",").filter((item) => item.trim().replace(/[\[\]"']/g, "")).length;
    }
    return inline.length > 0 ? 1 : 0;
  }

  const lines = parsed.frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return 0;

  let count = 0;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(line)) break;
    if (/^\s+-\s+/.test(line)) count += 1;
  }
  return count;
}

const files = walk(path.join(repoRoot, "plugins")).sort().filter((file) => {
  const rel = path.relative(repoRoot, file).replaceAll(path.sep, "/");
  return rules.commands.pattern.test(rel) || rules.agents.pattern.test(rel);
});

let errors = 0;
for (const file of files) {
  const rel = path.relative(repoRoot, file).replaceAll(path.sep, "/");
  const kind = rules.commands.pattern.test(rel) ? "commands" : "agents";
  const rule = rules[kind];
  const parsed = parseFrontmatter(file);

  if (parsed.error) {
    console.error(`${rel}: ${parsed.error}`);
    errors += 1;
    continue;
  }

  const keys = new Set(parsed.keys);
  for (const required of rule.required) {
    if (!keys.has(required)) {
      console.error(`${rel}: missing required frontmatter key '${required}'`);
      errors += 1;
    }
  }

  for (const key of keys) {
    if (!rule.allowed.has(key)) {
      console.error(`${rel}: unsupported frontmatter key '${key}'`);
      errors += 1;
    }
  }

  if (kind === "commands" && keys.has("args") && keys.has("arguments")) {
    console.error(`${rel}: use either 'args' or 'arguments', not both`);
    errors += 1;
  }

  const description = stringValue(parsed, "description");
  if (description.length < 50) {
    console.error(`${rel}: description must be trigger-rich (at least 50 characters)`);
    errors += 1;
  }

  if (kind === "commands") {
    if (!keys.has("allowed-tools")) {
      console.error(`${rel}: commands must declare allowed-tools`);
      errors += 1;
    }

    const hasTemplateInputs = /{{[^}]+}}/.test(parsed.body);
    if (hasTemplateInputs && !keys.has("arguments") && !keys.has("args") && !keys.has("argument-hint")) {
      console.error(`${rel}: command uses template inputs but declares no arguments/args/argument-hint`);
      errors += 1;
    }
  } else {
    if (!keys.has("tools") || listValueCount(parsed, "tools") === 0) {
      console.error(`${rel}: agents must declare a non-empty tools list`);
      errors += 1;
    }

    if (!/use (this )?(agent|when)|examples?:/i.test(description)) {
      console.error(`${rel}: agent description should include trigger language or examples`);
      errors += 1;
    }
  }
}

if (errors > 0) {
  console.error(`\nCommand/agent frontmatter validation failed: ${errors} issue(s).`);
  process.exit(1);
}

console.log(`Command/agent frontmatter validation passed for ${files.length} file(s).`);

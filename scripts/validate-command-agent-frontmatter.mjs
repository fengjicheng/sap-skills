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
  for (const line of frontmatter) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/);
    if (match) {
      keys.push(match[1]);
    }
  }
  return { keys };
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
}

if (errors > 0) {
  console.error(`\nCommand/agent frontmatter validation failed: ${errors} issue(s).`);
  process.exit(1);
}

console.log(`Command/agent frontmatter validation passed for ${files.length} file(s).`);

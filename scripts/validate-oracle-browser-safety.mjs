#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function fail(message) {
  errors.push(message);
}

const packageJson = JSON.parse(read("package.json"));
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (!/^\s*oracle(\s|$)/.test(command)) continue;
  if (name === "oracle:status" || name === "oracle:mcp") continue;
  if (!command.includes("--browser-archive never")) {
    fail(`package.json script ${name} must include --browser-archive never`);
  }
  if (command.includes("--browser-hide-window")) {
    fail(`package.json script ${name} must not hide important Oracle browser runs`);
  }
}

const docsToScan = ["CLAUDE.md", "AGENTS.md", "package.json"];
for (const relativePath of docsToScan) {
  const text = read(relativePath);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!/\boracle\b/i.test(line)) return;
    if (/--browser-archive\s+(auto|always)\b/.test(line)) {
      fail(`${relativePath}:${index + 1}: do not recommend Oracle browser auto/always archiving`);
    }
    if (/--browser-hide-window\b/.test(line)) {
      fail(`${relativePath}:${index + 1}: do not recommend hidden Oracle browser runs for reviews`);
    }
  });
}

if (errors.length > 0) {
  console.error("Oracle browser safety validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Oracle browser safety validation passed.");

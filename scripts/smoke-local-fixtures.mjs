#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRootFrom } from "./lib/validation-utils.mjs";

const repoRoot = repoRootFrom(import.meta.url);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sap-skills-local-fixtures-"));
const capFixture = path.join(tmpRoot, "cap-local");
const ui5Fixture = path.join(tmpRoot, "ui5-local");
const failures = [];

function copyFixture(name, target) {
  fs.cpSync(path.join(repoRoot, "tests/fixtures", name), target, { recursive: true });
}

function run(name, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
  });

  if (result.status !== 0) {
    failures.push([
      `${name} failed with exit ${result.status ?? "unknown"}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join("\n"));
  } else {
    console.log(`PASS: ${name}`);
  }
}

try {
  copyFixture("cap-local", capFixture);
  copyFixture("ui5-local", ui5Fixture);

  run("CAP fixture npm install", "npm", ["install", "--ignore-scripts"], { cwd: capFixture });
  run("CAP cds compile", "npx", ["cds", "compile", "srv/", "--to", "csn"], { cwd: capFixture });
  run("CAP MCP help", "npx", ["-y", "@cap-js/mcp-server@0.0.5", "--help"]);

  run("UI5 fixture npm install", "npm", ["install", "--ignore-scripts"], { cwd: ui5Fixture });
  run("UI5 CLI help", "npx", ["ui5", "--help"], { cwd: ui5Fixture });
  run("UI5 build", "npx", ["ui5", "build", "--all"], { cwd: ui5Fixture });
  run("UI5 linter help", "npx", ["ui5lint", "--help"], { cwd: ui5Fixture });
  run("UI5 MCP package discovery", "npm", ["view", "@ui5/mcp-server@0.2.11", "version", "bin", "--json"]);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error("Local fixture smoke tests failed:");
  for (const failure of failures) {
    console.error(`\n${failure}`);
  }
  process.exit(1);
}

console.log("Local fixture smoke tests passed.");

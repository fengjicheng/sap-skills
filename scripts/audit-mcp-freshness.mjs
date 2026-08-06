#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { repoRootFrom } from "./lib/validation-utils.mjs";

const repoRoot = repoRootFrom(import.meta.url);
const inventoryPath = path.join(repoRoot, "plugins/sap-dependency-security/skills/sap-dependency-security/references/sap-mcp-inventory.json");
const enforce = process.argv.includes("--enforce");
const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));

function npmLatest(name) {
  const output = execFileSync("npm", ["view", name, "version", "--json"], { encoding: "utf8" }).trim();
  return JSON.parse(output);
}

const rows = [];
const drifted = [];

for (const [name, policy] of Object.entries(inventory.npmPackages ?? {})) {
  const latest = npmLatest(name);
  const status = latest === policy.approvedVersion ? "current" : "upgrade_candidate";
  rows.push({ name, approved: policy.approvedVersion, latest, status });
  if (status !== "current") drifted.push({ name, approved: policy.approvedVersion, latest });
}

console.log("SAP MCP freshness audit");
console.log("=======================");
for (const row of rows) {
  console.log(`${row.name}\tapproved=${row.approved}\tlatest=${row.latest}\t${row.status}`);
}

if (drifted.length > 0) {
  console.error(`\n${drifted.length} pinned MCP package(s) have drifted from their approved version:`);
  for (const entry of drifted) {
    console.error(`- ${entry.name}: approved=${entry.approved}, latest=${entry.latest}`);
  }
  console.error("\nReview tenant-safe masking and tool compatibility before advancing approvedVersion in sap-mcp-inventory.json.");
  if (enforce) process.exit(1);
}

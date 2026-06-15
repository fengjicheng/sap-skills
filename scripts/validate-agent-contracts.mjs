#!/usr/bin/env node
import path from "node:path";
import {
  frontmatterList,
  hasAny,
  parseFrontmatter,
  readText,
  relPath,
  repoRootFrom,
  walk,
} from "./lib/validation-utils.mjs";

const repoRoot = repoRootFrom(import.meta.url);
const pluginsRoot = path.join(repoRoot, "plugins");
const errors = [];

function toolsFor(text) {
  return frontmatterList(parseFrontmatter(text).raw, "tools");
}

function isToolAware(text, tools) {
  return tools.some((tool) => /^(Write|Edit|MultiEdit|Bash)$/.test(tool) || tool.startsWith("mcp__"))
    || /\b(deploy|publish|tenant|credential|token|secret|drop|revoke|assign|unassign|mutat(?:e|ing|ion))\b/i.test(text);
}

function needsMutationSafety(text, tools) {
  return tools.some((tool) => /^(Write|Edit|MultiEdit)$/.test(tool))
    || tools.some((tool) => /^mcp__.*(?:create|update|delete|reset|deploy|publish|trigger)/i.test(tool));
}

function needsLiveEvidenceBoundary(text, tools) {
  return tools.some((tool) => tool.startsWith("mcp__"))
    || /\b(live\s+SAP|SAP\s+tenant|tenant|deployment|deploy|publish|credential|token|secret)\b/i.test(text);
}

for (const file of walk(pluginsRoot).filter((item) => /\/agents\/[^/]+\.md$/.test(item))) {
  const rel = relPath(repoRoot, file);
  const text = readText(file);
  const tools = toolsFor(text);
  if (!hasAny(text, [/## When to Delegate/i, /Use this agent/i, /Core Responsibilities/i])) {
    errors.push(`${rel}: agent must describe when to delegate/use it`);
  }
  if (!hasAny(text, [/## First Checks/i, /Step 1/i, /Workflow/i, /Process/i, /Approach/i, /Core Responsibilities/i])) {
    errors.push(`${rel}: agent must define first checks or workflow`);
  }
  if (!hasAny(text, [/MCP Fallback/i, /fallback/i, /If MCP/i])) {
    errors.push(`${rel}: agent must define MCP/tool fallback behavior`);
  }
  if (!hasAny(text, [/Safety Constraints/i, /Do not/i, /explicit user approval/i])) {
    errors.push(`${rel}: agent must define safety constraints`);
  }
  if (!hasAny(text, [/## Output/i, /Return:/i, /Expected output/i, /Deliverable/i, /Provide\b/i, /Response Format/i, /Output Format/i, /Format:/i])) {
    errors.push(`${rel}: agent must define output format`);
  }

  if (!isToolAware(text, tools)) continue;

  if (!hasAny(text, [/## When to Delegate/i, /Use this agent/i, /Use when/i])) {
    errors.push(`${rel}: tool-capable agent must define delegation scope`);
  }
  if (!hasAny(text, [/\b(inspect|read|review|check|analy[sz]e|audit|identify|verify)\b/i, /## First Checks/i])) {
    errors.push(`${rel}: tool-capable agent must state what it inspects or checks first`);
  }
  if (!hasAny(text, [/## Output/i, /Return:/i, /Expected output/i, /Deliverable/i, /Deliverables/i, /Response Format/i, /Output Format/i, /Format:/i, /Display Results/i, /Generate Report/i, /Format and Present/i, /Summary of Changes/i])) {
    errors.push(`${rel}: tool-capable agent must define expected output`);
  }
  if (needsMutationSafety(text, tools) && !hasAny(text, [/\b(do not|must not|never)\b[^.\n]*(?:modify|write|edit|change|create|delete|deploy|publish|mutate|run|alter|add|upgrade|remove)/i, /\bwithout explicit\b/i, /\badvisory\b/i])) {
    errors.push(`${rel}: tool-capable agent must state what it must not modify automatically`);
  }
  if (needsMutationSafety(text, tools) && !hasAny(text, [/\bexplicit (?:user )?(?:approval|confirmation|request)\b/i, /\buser explicitly asks\b/i, /\bAskUserQuestion\b/i, /\bconfirm(?:ation)? before\b/i, /\bwithout explicit\b/i, /\bGet approval\b/i])) {
    errors.push(`${rel}: tool-capable agent must define when explicit user approval is required`);
  }
  if (!hasAny(text, [/\b(local-only|read-only|analysis-only|advisory|tenant-affecting|non-production|MCP|tenant|live SAP)\b/i])) {
    errors.push(`${rel}: tool-capable agent must state whether work is local-only, advisory, or tenant-affecting`);
  }
  if (needsLiveEvidenceBoundary(text, tools) && !hasAny(text, [/\blive (?:SAP )?(?:tenant|system) checks? (?:remain|are|as )?pending\b/i, /\blive (?:SAP )?(?:tenant|system) verification\b/i, /\bwithout (?:user-provided )?evidence\b/i, /\bdocs-only evidence\b/i, /\bMCP Fallback\b/i, /\bMCP.*unavailable\b/i])) {
    errors.push(`${rel}: tenant/MCP-capable agent must keep live SAP verification out of scope without evidence`);
  }
}

if (errors.length > 0) {
  console.error("Agent contract validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Agent contract validation passed.");

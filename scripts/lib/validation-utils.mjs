import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function repoRootFrom(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), "..");
}

export function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

export function relPath(repoRoot, file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

export function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
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

export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return {
    raw: match ? match[1] : "",
    body: match ? content.slice(match[0].length) : content,
  };
}

export function frontmatterScalar(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${escapeRegExp(key)}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, "m"));
  if (match && !["|", ">"].includes(match[1].trim())) {
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
    if (trimmed && !trimmed.startsWith("- ")) out.push(trimmed);
  }
  return out.join(" ").trim();
}

export function frontmatterMetadata(frontmatter, key) {
  const lines = frontmatter.split(/\r?\n/);
  const metadataStart = lines.findIndex((line) => /^metadata:\s*$/.test(line));
  if (metadataStart === -1) return "";

  for (let index = metadataStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line)) break;
    const match = line.match(new RegExp(`^  ${escapeRegExp(key)}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`));
    if (match) return match[1].trim();
  }

  return "";
}

export function frontmatterList(frontmatter, key) {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return [];

  const inline = lines[start].slice(lines[start].indexOf(":") + 1).trim();
  if (inline) return parseInlineList(inline);

  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Za-z][A-Za-z0-9_-]*:/.test(line)) break;
    const item = line.match(/^\s*-\s+(.+?)\s*$/);
    if (item) values.push(stripQuotes(item[1].trim()));
  }
  return values;
}

export function stripCodeFences(content) {
  const lines = content.split(/\r?\n/);
  const kept = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      kept.push("");
      continue;
    }
    kept.push(inFence ? "" : line);
  }
  return kept.join("\n");
}

export function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function parseInlineList(value) {
  const trimmed = value.trim();
  const withoutBrackets = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  return splitCommaList(withoutBrackets)
    .map((item) => stripQuotes(item.trim()))
    .filter(Boolean);
}

function splitCommaList(value) {
  const items = [];
  let current = "";
  let quote = "";
  for (const char of value) {
    if ((char === "\"" || char === "'") && !quote) {
      quote = char;
      current += char;
      continue;
    }
    if (char === quote) {
      quote = "";
      current += char;
      continue;
    }
    if (char === "," && !quote) {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  items.push(current);
  return items;
}

function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, "").trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

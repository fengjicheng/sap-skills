#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const resourceRoots = new Set(["references", "templates", "scripts", "assets"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "__pycache__") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function skillBaseFor(markdownFile) {
  const relative = path.relative(repoRoot, markdownFile).replaceAll(path.sep, "/");
  const pluginMatch = relative.match(/^plugins\/([^/]+)\/skills\/([^/]+)\//);
  if (pluginMatch) {
    return path.join(repoRoot, "plugins", pluginMatch[1], "skills", pluginMatch[2]);
  }

  const pluginCommandOrAgentMatch = relative.match(/^plugins\/([^/]+)\/(?:commands|agents)\//);
  if (pluginCommandOrAgentMatch) {
    const pluginName = pluginCommandOrAgentMatch[1];
    const skillDir = path.join(repoRoot, "plugins", pluginName, "skills", pluginName);
    return fs.existsSync(skillDir) ? skillDir : path.dirname(markdownFile);
  }

  const agentMatch = relative.match(/^\.agents\/([^/]+)\//);
  if (agentMatch) {
    return path.join(repoRoot, ".agents", agentMatch[1]);
  }

  return path.dirname(markdownFile);
}

function stripForScanning(line) {
  return line.replace(/https?:\/\/\S+/g, "");
}

function escapeRegex(text) {
  return text.replace(/[|\\{}()[\]^$+.:]/g, "\\$&");
}

function globToRegex(glob) {
  let source = "^";
  for (const char of glob) {
    if (char === "*") {
      source += ".*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += escapeRegex(char);
    }
  }
  source += "$";
  return new RegExp(source);
}

function globExists(targetPath) {
  const dir = path.dirname(targetPath);
  const basename = path.basename(targetPath);
  if (!fs.existsSync(dir)) {
    return false;
  }

  const pattern = globToRegex(basename);
  return fs.readdirSync(dir).some((entry) => pattern.test(entry));
}

function resolveReference(markdownFile, ref) {
  const cleanRef = ref
    .split("#")[0]
    .replace(/[)\].,;:!?]+$/g, "")
    .replace(/^`|`$/g, "");

  if (!cleanRef || cleanRef.includes("<") || cleanRef.includes(">")) {
    return null;
  }

  const basename = path.basename(cleanRef);
  if (!basename.includes(".") && !cleanRef.includes("*") && !cleanRef.includes("?")) {
    return null;
  }

  const firstSegment = cleanRef.replace(/^\.\//, "").replace(/^\.\.\//, "").split("/")[0];
  if (!resourceRoots.has(firstSegment)) {
    return null;
  }

  const baseDir = cleanRef.startsWith("./") || cleanRef.startsWith("../")
    ? path.dirname(markdownFile)
    : skillBaseFor(markdownFile);

  return path.resolve(baseDir, cleanRef);
}

function findResourceRefs(markdownFile) {
  const content = fs.readFileSync(markdownFile, "utf8");
  const refs = [];
  let inFence = false;

  content.split(/\r?\n/).forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }

    const scanned = stripForScanning(line);
    const regex = /(^|[^A-Za-z0-9_.:/-])((?:\.{1,2}\/)?(?:references|templates|scripts|assets)\/[^\s`'")\]}<>,;:]+)/g;
    let match;
    while ((match = regex.exec(scanned)) !== null) {
      refs.push({ ref: match[2], line: index + 1 });
    }
  });

  return refs;
}

const markdownFiles = [
  ...walk(path.join(repoRoot, "plugins")),
].sort();

let errors = 0;
for (const file of markdownFiles) {
  for (const { ref, line } of findResourceRefs(file)) {
    const target = resolveReference(file, ref);
    if (!target) {
      continue;
    }

    const exists = ref.includes("*") || ref.includes("?")
      ? globExists(target)
      : fs.existsSync(target);

    if (!exists) {
      errors += 1;
      const relFile = path.relative(repoRoot, file);
      const relTarget = path.relative(repoRoot, target);
      console.error(`${relFile}:${line}: missing bundled resource '${ref}' (resolved: ${relTarget})`);
    }
  }
}

if (errors > 0) {
  console.error(`\nBundled resource validation failed: ${errors} missing reference(s).`);
  process.exit(1);
}

console.log(`Bundled resource validation passed for ${markdownFiles.length} markdown file(s).`);

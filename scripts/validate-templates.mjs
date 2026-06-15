#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pluginsRoot = path.join(repoRoot, "plugins");
const errors = [];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function stripPlaceholders(text) {
  return text.replace(/\{\{[^}]+\}\}/g, "PLACEHOLDER").replace(/\$\{[^}]+\}/g, "PLACEHOLDER");
}

function looksLikeSecret(text) {
  return /\b(password|client_secret|api[_-]?key|access[_-]?token)\b\s*[:=]\s*["'](?!\$\{|\{\{|PLACEHOLDER|your-|your_|changeme|example|dummy)[^"']{8,}["']/i.test(text);
}

function validateHttpsToSftpIflowTemplate() {
  const templateRoot = path.join(
    pluginsRoot,
    "sap-btp-integration-suite",
    "skills",
    "sap-btp-integration-suite",
    "templates",
    "https-to-sftp-iflow-package",
  );

  if (!fs.existsSync(templateRoot)) {
    errors.push("sap-btp-integration-suite HTTPS-to-SFTP iFlow template is missing");
    return;
  }

  const requiredFiles = [
    ".project",
    "META-INF/MANIFEST.MF",
    "metainfo.prop",
    "src/main/resources/parameters.prop",
    "src/main/resources/parameters.propdef",
  ];

  for (const relativeFile of requiredFiles) {
    const file = path.join(templateRoot, relativeFile);
    if (!fs.existsSync(file)) {
      errors.push(`sap-btp-integration-suite HTTPS-to-SFTP iFlow template missing ${relativeFile}`);
    }
  }

  const iflowDir = path.join(templateRoot, "src", "main", "resources", "scenarioflows", "integrationflow");
  const iflowFiles = fs.existsSync(iflowDir)
    ? fs.readdirSync(iflowDir).filter((entry) => entry.endsWith(".iflw"))
    : [];

  if (iflowFiles.length !== 1) {
    errors.push("sap-btp-integration-suite HTTPS-to-SFTP iFlow template must contain exactly one .iflw file");
    return;
  }

  const manifestFile = path.join(templateRoot, "META-INF", "MANIFEST.MF");
  if (fs.existsSync(manifestFile)) {
    const manifest = fs.readFileSync(manifestFile, "utf8");
    for (const requiredLine of ["SAP-RuntimeProfile: iflmap", "SAP-NodeType: IFLMAP", "SAP-BundleType: IntegrationFlow"]) {
      if (!manifest.includes(requiredLine)) {
        errors.push(`sap-btp-integration-suite HTTPS-to-SFTP iFlow manifest missing '${requiredLine}'`);
      }
    }
  }

  const projectFile = path.join(templateRoot, ".project");
  if (fs.existsSync(projectFile)) {
    const project = fs.readFileSync(projectFile, "utf8");
    if (!project.includes("com.sap.ide.ifl.project.support.project.nature")) {
      errors.push("sap-btp-integration-suite HTTPS-to-SFTP iFlow .project missing SAP iFlow project nature");
    }
  }

  const iflowFile = path.join(iflowDir, iflowFiles[0]);
  const iflow = fs.readFileSync(iflowFile, "utf8");
  const requiredFragments = [
    "bpmn2:definitions",
    "EndpointSender",
    "EndpointRecevier",
    "IntegrationProcess",
    "sap:HTTPS",
    "sap:SFTP",
    "{{HTTPS_ENDPOINT_PATH}}",
    "{{SFTP_HOST}}",
    "{{SFTP_DIRECTORY}}",
    "{{SFTP_FILENAME}}",
    "{{SFTP_CREDENTIAL_ALIAS}}",
  ];

  for (const fragment of requiredFragments) {
    if (!iflow.includes(fragment)) {
      errors.push(`sap-btp-integration-suite HTTPS-to-SFTP iFlow missing '${fragment}'`);
    }
  }

  const iflowWithoutNamespaces = iflow
    .replace(/\s+xmlns(?::\w+)?="[^"]+"/g, "")
    .replace(/\s+targetNamespace="[^"]+"/g, "");
  if (/https?:\/\/|sftp:\/\/|[A-Za-z0-9-]+\.(?:com|net|org|io|de|cloud|local)\b/i.test(iflowWithoutNamespaces)) {
    errors.push("sap-btp-integration-suite HTTPS-to-SFTP iFlow template must not contain real hostnames or URLs");
  }

  const xmlFiles = [projectFile, iflowFile].filter((file) => fs.existsSync(file));
  for (const xmlFile of xmlFiles) {
    const result = spawnSync("xmllint", ["--noout", xmlFile], { encoding: "utf8" });
    if (result.error?.code === "ENOENT") {
      errors.push("xmllint is required to validate iFlow XML templates");
      break;
    }
    if (result.status !== 0) {
      const relPath = path.relative(repoRoot, xmlFile).replaceAll(path.sep, "/");
      errors.push(`${relPath}: malformed XML: ${(result.stderr || result.stdout).trim()}`);
    }
  }
}

for (const file of walk(pluginsRoot).filter((item) => item.includes("/templates/"))) {
  const rel = path.relative(repoRoot, file).replaceAll(path.sep, "/");
  const text = fs.readFileSync(file, "utf8");
  if (looksLikeSecret(text)) {
    errors.push(`${rel}: template appears to contain a literal secret`);
  }
  if (file.endsWith(".json")) {
    try {
      JSON.parse(stripPlaceholders(text));
    } catch (error) {
      errors.push(`${rel}: invalid JSON template after placeholder normalization: ${error.message}`);
    }
  }
}

validateHttpsToSftpIflowTemplate();

if (errors.length > 0) {
  console.error("Template validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Template validation passed.");

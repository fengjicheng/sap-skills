import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const pluginRoot = path.join(repoRoot, "plugins/sap-bw-query");
const mcpDir = path.join(pluginRoot, "mcp");
const distDir = path.join(mcpDir, "dist");

const HEX40 = /^[0-9a-f]{40}$/;
const TEST_SHA = "0".repeat(40);

async function loadServer() {
  const url = pathToFileURL(path.join(mcpDir, "src/server.mjs")).href;
  return import(url);
}

test("loadProvenance reads dist/provenance.json when present (via injected dir)", async () => {
  const server = await loadServer();
  assert.equal(typeof server.loadProvenance, "function", "loadProvenance must be exported");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prov-present-"));
  try {
    const sha = "1".repeat(40);
    fs.writeFileSync(
      path.join(tmp, "provenance.json"),
      JSON.stringify({ commit: sha, source: "git-head", builtAt: "2026-08-05T00:00:00.000Z", note: "x" }),
    );
    const prevCommit = process.env.BW_AUTOMATION_PLUGIN_COMMIT;
    delete process.env.BW_AUTOMATION_PLUGIN_COMMIT;
    try {
      const result = server.loadProvenance(tmp);
      assert.equal(result.commit, sha);
      assert.equal(result.source, "git-head");
      assert.equal(result.trusted, true);
      assert.equal(typeof result.builtAt, "string");
    } finally {
      if (prevCommit !== undefined) process.env.BW_AUTOMATION_PLUGIN_COMMIT = prevCommit;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadProvenance falls back to env override when no file is present", async () => {
  const server = await loadServer();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prov-env-"));
  try {
    const prevCommit = process.env.BW_AUTOMATION_PLUGIN_COMMIT;
    process.env.BW_AUTOMATION_PLUGIN_COMMIT = TEST_SHA;
    try {
      const result = server.loadProvenance(tmp);
      assert.equal(result.commit, TEST_SHA);
      assert.equal(result.source, "env-override");
      assert.equal(result.trusted, true);
    } finally {
      if (prevCommit === undefined) delete process.env.BW_AUTOMATION_PLUGIN_COMMIT;
      else process.env.BW_AUTOMATION_PLUGIN_COMMIT = prevCommit;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadProvenance never returns the literal 'source-commit' placeholder", async () => {
  const server = await loadServer();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prov-placeholder-"));
  try {
    const cases = [undefined, "source-commit"];
    for (const value of cases) {
      const prevCommit = process.env.BW_AUTOMATION_PLUGIN_COMMIT;
      if (value === undefined) delete process.env.BW_AUTOMATION_PLUGIN_COMMIT;
      else process.env.BW_AUTOMATION_PLUGIN_COMMIT = value;
      try {
        const result = server.loadProvenance(tmp);
        assert.equal(result.commit, null, `commit must be null for env=${value}`);
        assert.equal(result.trusted, false, `trusted must be false for env=${value}`);
        assert.notEqual(result.commit, "source-commit", "must never leak the literal placeholder");
        assert.match(result.source, /^(dev-unpinned|env-placeholder-ignored|parse-error)$/);
      } finally {
        if (prevCommit === undefined) delete process.env.BW_AUTOMATION_PLUGIN_COMMIT;
        else process.env.BW_AUTOMATION_PLUGIN_COMMIT = prevCommit;
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadProvenance returns parse-error on malformed json and never throws", async () => {
  const server = await loadServer();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prov-malformed-"));
  try {
    fs.writeFileSync(path.join(tmp, "provenance.json"), "{ not json");
    const prevCommit = process.env.BW_AUTOMATION_PLUGIN_COMMIT;
    delete process.env.BW_AUTOMATION_PLUGIN_COMMIT;
    try {
      const result = server.loadProvenance(tmp);
      assert.equal(result.commit, null);
      assert.equal(result.source, "parse-error");
      assert.equal(result.trusted, false);
    } finally {
      if (prevCommit !== undefined) process.env.BW_AUTOMATION_PLUGIN_COMMIT = prevCommit;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("loadProvenance rejects a provenance.json whose commit is not 40-hex (treats as parse-error)", async () => {
  const server = await loadServer();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prov-badhash-"));
  try {
    fs.writeFileSync(
      path.join(tmp, "provenance.json"),
      JSON.stringify({ commit: "not-a-sha", source: "git-head", builtAt: "2026-08-05T00:00:00.000Z" }),
    );
    const prevCommit = process.env.BW_AUTOMATION_PLUGIN_COMMIT;
    delete process.env.BW_AUTOMATION_PLUGIN_COMMIT;
    try {
      const result = server.loadProvenance(tmp);
      assert.equal(result.commit, null);
      assert.equal(result.source, "parse-error");
      assert.equal(result.trusted, false);
    } finally {
      if (prevCommit !== undefined) process.env.BW_AUTOMATION_PLUGIN_COMMIT = prevCommit;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Snapshot and restore the real mcp/dist so build tests never wipe a prior
// build output. Each test builds into the real dist (build.mjs is hardcoded to
// it), asserts, then restores the snapshot.
function snapshotDist() {
  if (!fs.existsSync(distDir)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prov-dist-snapshot-"));
  for (const entry of fs.readdirSync(distDir)) {
    fs.renameSync(path.join(distDir, entry), path.join(tmp, entry));
  }
  return tmp;
}
function restoreDist(snapshot) {
  fs.rmSync(distDir, { recursive: true, force: true });
  if (snapshot && fs.existsSync(snapshot)) {
    fs.mkdirSync(distDir, { recursive: true });
    for (const entry of fs.readdirSync(snapshot)) {
      fs.renameSync(path.join(snapshot, entry), path.join(distDir, entry));
    }
    fs.rmSync(snapshot, { recursive: true, force: true });
  }
}

test("build.mjs emits dist/provenance.json from env override", () => {
  const snapshot = snapshotDist();
  try {
    const res = spawnSync(process.execPath, ["build.mjs"], {
      cwd: mcpDir,
      env: { ...process.env, BW_AUTOMATION_PLUGIN_COMMIT: TEST_SHA },
      encoding: "utf8",
    });
    if (res.status !== 0) {
      console.error("build stdout:", res.stdout);
      console.error("build stderr:", res.stderr);
    }
    assert.equal(res.status, 0, "build must succeed with a valid env override");
    const provPath = path.join(distDir, "provenance.json");
    assert.equal(fs.existsSync(provPath), true, "dist/provenance.json must exist after build");
    const prov = JSON.parse(fs.readFileSync(provPath, "utf8"));
    assert.match(prov.commit, HEX40);
    assert.equal(prov.commit, TEST_SHA);
    assert.equal(prov.source, "env-override");
    assert.equal(typeof prov.builtAt, "string");
    assert.equal(Number.isNaN(Date.parse(prov.builtAt)), false, "builtAt must be a valid ISO date");
    assert.equal(typeof prov.note, "string");
  } finally {
    restoreDist(snapshot);
  }
});

test("build.mjs fails loudly when env is the placeholder and git is unavailable", () => {
  // build.mjs resolves git from the plugin/mcp dir (always a git repo here), so
  // force git failure by pointing GIT_DIR at a non-existent path + disabling
  // discovery. This simulates "git unavailable / not a repo" without moving cwd.
  const buildScript = path.join(mcpDir, "build.mjs");
  const res = spawnSync(process.execPath, [buildScript], {
    cwd: mcpDir,
    env: {
      ...process.env,
      BW_AUTOMATION_PLUGIN_COMMIT: "source-commit",
      GIT_DIR: path.join(os.tmpdir(), `prov-no-git-${process.pid}-${Date.now()}`),
      GIT_DISCOVERY_ACROSS_FILESYSTEM: "0",
      GIT_CEILING_DIRECTORIES: os.tmpdir(),
    },
    encoding: "utf8",
  });
  assert.notEqual(res.status, 0, "build must exit non-zero when provenance cannot be established");
  const stderr = res.stderr ?? "";
  assert.match(stderr, /provenance/i, "stderr must mention provenance");
});

test("build.mjs uses git HEAD when env is unset in a real git repo", (t) => {
  // The sap-skills repo IS a git repo; running build from the plugin mcp dir
  // without an env override should resolve HEAD via `git rev-parse`.
  // Skip if HEAD cannot be resolved for any reason (CI shallow clones, etc).
  let headSha = null;
  try {
    const gitCheck = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: mcpDir,
      encoding: "utf8",
    });
    if (gitCheck.status === 0 && HEX40.test(gitCheck.stdout.trim())) headSha = gitCheck.stdout.trim();
  } catch { /* fall through to skip */ }
  if (!headSha) {
    t.skip();
    return;
  }

  const snapshot = snapshotDist();
  const envWithoutCommit = { ...process.env };
  delete envWithoutCommit.BW_AUTOMATION_PLUGIN_COMMIT;
  // Ensure the placeholder is not inherited from any wrapper env
  envWithoutCommit.BW_AUTOMATION_PLUGIN_COMMIT = "";
  try {
    const res = spawnSync(process.execPath, ["build.mjs"], {
      cwd: mcpDir,
      env: envWithoutCommit,
      encoding: "utf8",
    });
    if (res.status !== 0) {
      console.error("build stdout:", res.stdout);
      console.error("build stderr:", res.stderr);
    }
    assert.equal(res.status, 0, "build must succeed in a real git repo without env override");
    const provPath = path.join(distDir, "provenance.json");
    assert.equal(fs.existsSync(provPath), true);
    const prov = JSON.parse(fs.readFileSync(provPath, "utf8"));
    assert.match(prov.commit, HEX40);
    assert.equal(prov.commit, headSha);
    assert.equal(prov.source, "git-head");
    // dirty is a boolean when git status succeeds; the worktree state is
    // whatever it is at test time, so just assert the field is present.
    assert.equal(typeof prov.dirty, "boolean");
  } finally {
    restoreDist(snapshot);
  }
});

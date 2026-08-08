import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const subjectUrl = pathToFileURL(path.resolve(here, "../../plugins/sap-bw-query/mcp/src/connection-store.mjs"));

async function loadSubject() {
  try { return await import(subjectUrl); } catch { return null; }
}

const directConnection = {
  alias: "BWD-100",
  systemId: "BWD",
  client: "100",
  language: "EN",
  userId: "BW_READER",
  mode: "applicationServer",
  applicationServer: "127.0.0.1",
  systemNumber: "00",
  sncEnabled: true,
  ssoEnabled: true,
};

test("connection metadata is append-only and contains no authentication material", async () => {
  const subject = await loadSubject();
  assert.ok(subject, "connection store is not implemented");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bw-connection-store-"));
  const store = new subject.ConnectionStore({ root, now: () => "2026-07-13T12:00:00.000Z" });
  const first = store.prepare(directConnection);
  const second = store.prepare({ ...directConnection, language: "DE" });
  assert.equal(first.alias, "BWD-100");
  assert.equal(second.language, "DE");
  const files = fs.readdirSync(path.join(root, "connections/BWD-100"));
  assert.equal(files.length, 2);
  const stored = files.map((file) => fs.readFileSync(path.join(root, "connections/BWD-100", file), "utf8")).join("\n");
  assert.doesNotMatch(stored, /password|passwd|\bpwd\b|secret|token|apiKey|credential/i);
  assert.throws(() => store.prepare({ ...directConnection, password: "do-not-store" }), { code: "SECRET_REJECTED" });
});

test("SAP UI landscape import extracts connection metadata without credentials", async () => {
  const subject = await loadSubject();
  assert.ok(subject, "connection store is not implemented");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bw-landscape-store-"));
  // The landscape file must live under <root>/landscapes/ to be accepted.
  const landscapesDir = path.join(root, "landscapes");
  fs.mkdirSync(landscapesDir, { recursive: true });
  const landscapePath = path.join(landscapesDir, "SAPUILandscape.xml");
  fs.writeFileSync(landscapePath, `<?xml version="1.0"?><Landscape><Services><Service name="BWP Production" systemid="BWP" client="200" server="bw.example.invalid" systemnumber="01" language="EN" sncop="1"/></Services></Landscape>`);
  const store = new subject.ConnectionStore({ root });
  const imported = store.importLandscape(landscapePath, "BWP-200");
  assert.equal(imported.alias, "BWP-200");
  assert.equal(imported.systemId, "BWP");
  assert.equal(imported.applicationServer, "bw.example.invalid");
  assert.equal(imported.sncEnabled, true);
  assert.doesNotMatch(JSON.stringify(imported), /password|secret|token|credential/i);
});

test("importLandscape rejects absolute paths outside the confined landscapes root (/etc/passwd)", async () => {
  const subject = await loadSubject();
  assert.ok(subject, "connection store is not implemented");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bw-landscape-confine-"));
  const store = new subject.ConnectionStore({ root });
  assert.throws(
    () => store.importLandscape("/etc/passwd", "BWP-200"),
    { code: "LANDSCAPE_PATH_NOT_CONFINED" },
  );
  // Nothing should have been written for this alias.
  assert.equal(fs.existsSync(path.join(root, "connections", "BWP-200")), false);
});

test("importLandscape rejects Windows-style rooted paths outside the confined root", async () => {
  const subject = await loadSubject();
  assert.ok(subject, "connection store is not implemented");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bw-landscape-confine-"));
  const store = new subject.ConnectionStore({ root });
  assert.throws(
    () => store.importLandscape("C:\\windows\\system32\\drivers\\etc\\hosts", "BWP-200"),
    { code: "LANDSCAPE_PATH_NOT_CONFINED" },
  );
});

test("importLandscape rejects parent-directory escape attempts from the landscapes root", async () => {
  const subject = await loadSubject();
  assert.ok(subject, "connection store is not implemented");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bw-landscape-confine-"));
  const store = new subject.ConnectionStore({ root });
  // A path that textually starts with <root>/landscapes/ but escapes via ..
  const escapePath = path.join(root, "landscapes", "..", "..", "etc", "passwd");
  assert.throws(
    () => store.importLandscape(escapePath, "BWP-200"),
    { code: "LANDSCAPE_PATH_NOT_CONFINED" },
  );
});

test("importLandscape accepts a file under BW_AUTOMATION_LANDSCAPE_ALLOW_DIR when the env var is set", async () => {
  const subject = await loadSubject();
  assert.ok(subject, "connection store is not implemented");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bw-landscape-confine-"));
  const allowDir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-landscape-allowdir-"));
  process.env.BW_AUTOMATION_LANDSCAPE_ALLOW_DIR = allowDir;
  try {
    const landscapePath = path.join(allowDir, "SAPUILandscape.xml");
    fs.writeFileSync(landscapePath, `<?xml version="1.0"?><Landscape><Services><Service name="BWP Production" systemid="BWP" client="200" server="bw.example.invalid" systemnumber="01" language="EN" sncop="1"/></Services></Landscape>`);
    const store = new subject.ConnectionStore({ root });
    const imported = store.importLandscape(landscapePath, "BWP-200");
    assert.equal(imported.alias, "BWP-200");
    assert.equal(imported.systemId, "BWP");
  } finally {
    delete process.env.BW_AUTOMATION_LANDSCAPE_ALLOW_DIR;
  }
});

test("reachability performs a TCP check without authentication", async () => {
  const subject = await loadSubject();
  assert.ok(subject, "connection store is not implemented");
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const result = await subject.testReachability({ host: "127.0.0.1", port, timeoutMs: 1000 });
    assert.equal(result.reachable, true);
    assert.equal(result.authenticated, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("connectionEndpoint derives the dispatcher port from systemNumber for messageServer mode", async () => {
  const subject = await loadSubject();
  assert.ok(subject, "connection store is not implemented");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bw-msg-endpoint-"));
  const store = new subject.ConnectionStore({ root, now: () => "2026-07-13T12:00:00.000Z" });
  const stored = store.status(
    store.prepare({
      alias: "BWP-MS",
      systemId: "BWP",
      client: "200",
      mode: "messageServer",
      messageServer: "msg.bw.example.invalid",
      logonGroup: "PUBLIC",
      systemNumber: "07",
    }).alias,
  );
  const endpoint = subject.connectionEndpoint(stored);
  // messageServer host is preserved; port 36NN uses the persisted systemNumber.
  assert.equal(endpoint.host, "msg.bw.example.invalid");
  assert.equal(endpoint.port, 3607);
});

test("connectionEndpoint falls back to port 3600 when systemNumber is absent for messageServer mode", async () => {
  const subject = await loadSubject();
  assert.ok(subject, "connection store is not implemented");
  const stored = {
    configured: true,
    alias: "BWP-MS",
    mode: "messageServer",
    messageServer: "msg.bw.example.invalid",
    logonGroup: "PUBLIC",
  };
  const endpoint = subject.connectionEndpoint(stored);
  assert.equal(endpoint.host, "msg.bw.example.invalid");
  assert.equal(endpoint.port, 3600);
});

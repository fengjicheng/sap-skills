import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeUrl = pathToFileURL(path.resolve(here, "../../plugins/sap-bw-query/mcp/src/bridge-broker.mjs"));
const stepsUrl = pathToFileURL(path.resolve(here, "../../plugins/sap-bw-query/mcp/src/step-store.mjs"));

async function load(url) {
  try { return await import(url); } catch { return null; }
}

test("bridge accepts only allow-listed Eclipse methods", async () => {
  const subject = await load(bridgeUrl);
  assert.ok(subject, "bridge broker is not implemented");
  const broker = new subject.BridgeBroker({ pipePath: `\\\\.\\pipe\\bw-test-${process.pid}-${Date.now()}` });
  await assert.rejects(() => broker.call("saveQuery", {}), /not allow-listed/i);
  await assert.rejects(() => broker.call("deleteQuery", {}), /not allow-listed/i);
});

test("named-pipe request and response stay local, correlate by id, and require auth", { skip: process.platform !== "win32" }, async () => {
  const subject = await load(bridgeUrl);
  assert.ok(subject, "bridge broker is not implemented");
  const pipePath = `\\\\.\\pipe\\bw-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const broker = new subject.BridgeBroker({ pipePath, timeoutMs: 2000 });
  await broker.start();
  const eclipse = net.createConnection(pipePath);
  await new Promise((resolve, reject) => eclipse.once("connect", resolve).once("error", reject));
  // Auth frame MUST be the first line; Eclipse learns the token from BW_AUTOMATION_BRIDGE_TOKEN env var.
  eclipse.write(`${JSON.stringify({ authToken: broker.authToken })}\n`);
  let buffer = "";
  eclipse.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    const request = JSON.parse(buffer.slice(0, newline));
    buffer = buffer.slice(newline + 1);
    eclipse.write(`${JSON.stringify({ id: request.id, result: { bwmtAvailable: true, echoedMethod: request.method } })}\n`);
  });
  const result = await broker.call("inspectCapabilities", {});
  assert.deepEqual(result, { bwmtAvailable: true, echoedMethod: "inspectCapabilities" });
  eclipse.end();
  await broker.close();
});

test("validateAuthFrame accepts only the exact matching token", async () => {
  const subject = await load(bridgeUrl);
  assert.ok(subject, "bridge broker is not implemented");
  const { validateAuthFrame } = subject;
  assert.equal(typeof validateAuthFrame, "function");
  assert.equal(validateAuthFrame({ authToken: "abc" }, "abc"), true);
  assert.equal(validateAuthFrame({ authToken: "wrong" }, "abc"), false);
  assert.equal(validateAuthFrame({}, "abc"), false);
  assert.equal(validateAuthFrame(null, "abc"), false);
  assert.equal(validateAuthFrame({ authToken: "abc" }, ""), false, "empty expected token must reject");
});

test("BridgeBroker constructor generates a 32-byte hex token and exposes it via authToken getter", async () => {
  const subject = await load(bridgeUrl);
  assert.ok(subject, "bridge broker is not implemented");
  const savedEnv = process.env.BW_AUTOMATION_BRIDGE_TOKEN;
  try {
    delete process.env.BW_AUTOMATION_BRIDGE_TOKEN;
    const broker = new subject.BridgeBroker({ pipePath: `/tmp/bw-test-authtoken-${process.pid}-${Date.now()}` });
    const token = broker.authToken;
    assert.equal(typeof token, "string");
    assert.equal(token.length, 64, "32 bytes hex = 64 chars");
    assert.match(token, /^[0-9a-f]{64}$/);
    assert.equal(process.env.BW_AUTOMATION_BRIDGE_TOKEN, token, "env var must be populated for child processes");
  } finally {
    if (savedEnv === undefined) delete process.env.BW_AUTOMATION_BRIDGE_TOKEN;
    else process.env.BW_AUTOMATION_BRIDGE_TOKEN = savedEnv;
  }
});

test("BridgeBroker honors explicit authToken option and still publishes env var", async () => {
  const subject = await load(bridgeUrl);
  assert.ok(subject, "bridge broker is not implemented");
  const savedEnv = process.env.BW_AUTOMATION_BRIDGE_TOKEN;
  try {
    delete process.env.BW_AUTOMATION_BRIDGE_TOKEN;
    const broker = new subject.BridgeBroker({ pipePath: `/tmp/bw-test-tok-${process.pid}-${Date.now()}`, authToken: "test-token" });
    assert.equal(broker.authToken, "test-token");
    assert.equal(process.env.BW_AUTOMATION_BRIDGE_TOKEN, "test-token");
  } finally {
    if (savedEnv === undefined) delete process.env.BW_AUTOMATION_BRIDGE_TOKEN;
    else process.env.BW_AUTOMATION_BRIDGE_TOKEN = savedEnv;
  }
});

test("BridgeBroker constructor honors pre-set BW_AUTOMATION_BRIDGE_TOKEN env var", async () => {
  const subject = await load(bridgeUrl);
  assert.ok(subject, "bridge broker is not implemented");
  const savedEnv = process.env.BW_AUTOMATION_BRIDGE_TOKEN;
  try {
    process.env.BW_AUTOMATION_BRIDGE_TOKEN = "env-token";
    const broker = new subject.BridgeBroker({ pipePath: path.join(os.tmpdir(), `bw-test-envtok-${process.pid}-${Date.now()}`) });
    assert.equal(broker.authToken, "env-token");
  } finally {
    if (savedEnv === undefined) delete process.env.BW_AUTOMATION_BRIDGE_TOKEN;
    else process.env.BW_AUTOMATION_BRIDGE_TOKEN = savedEnv;
  }
});

test("UNIX-socket bridge rejects wrong auth token then accepts correct one (handshake)", { skip: process.platform === "win32" }, async () => {
  const subject = await load(bridgeUrl);
  assert.ok(subject, "bridge broker is not implemented");
  const socketPath = path.join(os.tmpdir(), `bw-test-auth-${process.pid}-${Date.now()}`);
  const broker = new subject.BridgeBroker({ pipePath: socketPath, timeoutMs: 500 });
  await broker.start();
  try {
    // First connect: send WRONG token. Expect BRIDGE_UNAUTHORIZED error + close.
    const badClient = net.createConnection(socketPath);
    await new Promise((resolve, reject) => badClient.once("connect", resolve).once("error", reject));
    const badOutcome = await new Promise((resolve) => {
      let buf = "";
      const guard = setTimeout(() => resolve(`<timeout buf="${buf}">`), 1500);
      badClient.on("data", (chunk) => { buf += chunk.toString("utf8"); });
      badClient.on("end", () => { clearTimeout(guard); resolve(buf); });
      badClient.on("close", () => { clearTimeout(guard); resolve(buf); });
      badClient.write(`${JSON.stringify({ authToken: "definitely-wrong" })}\n`);
    });
    assert.match(badOutcome, /BRIDGE_UNAUTHORIZED/, "wrong token must yield BRIDGE_UNAUTHORIZED");

    // Second connect: send CORRECT token. Handshake succeeds and a call flows through.
    const token = broker.authToken;
    const eclipse = net.createConnection(socketPath);
    await new Promise((resolve, reject) => eclipse.once("connect", resolve).once("error", reject));
    eclipse.write(`${JSON.stringify({ authToken: token })}\n`);
    let buffer = "";
    eclipse.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      eclipse.write(`${JSON.stringify({ id: request.id, result: { ok: true, method: request.method } })}\n`);
    });
    const result = await broker.call("inspectCapabilities", {});
    assert.deepEqual(result, { ok: true, method: "inspectCapabilities" });
    eclipse.end();
  } finally {
    await broker.close();
    try { fs.unlinkSync(socketPath); } catch { /* socket may be cleaned by close */ }
  }
});

test("UNIX-socket bridge rejects a connector that sends no auth frame within timeout", { skip: process.platform === "win32" }, async () => {
  const subject = await load(bridgeUrl);
  assert.ok(subject, "bridge broker is not implemented");
  const socketPath = path.join(os.tmpdir(), `bw-test-noauth-${process.pid}-${Date.now()}`);
  const broker = new subject.BridgeBroker({ pipePath: socketPath, timeoutMs: 300 });
  await broker.start();
  try {
    const silent = net.createConnection(socketPath);
    await new Promise((resolve, reject) => silent.once("connect", resolve).once("error", reject));
    // Send nothing. The broker should reject a subsequent call after its connection timeout.
    await assert.rejects(() => broker.call("inspectCapabilities", {}), /unavailable|timed out|unauthorized/i);
    silent.end();
  } finally {
    await broker.close();
    try { fs.unlinkSync(socketPath); } catch { /* may already be cleaned */ }
  }
});

test("step journal sanitizes content and marks password rejection sticky red", async () => {
  const subject = await load(stepsUrl);
  assert.ok(subject, "step store is not implemented");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bw-step-store-"));
  const store = new subject.StepStore({ root, now: () => "2026-07-13T12:30:00.000Z" });
  const entry = store.append({ tool: "bw_connection_prepare", status: "BLOCKED", sticky: true, message: "pwd=do-not-log" });
  assert.equal(entry.visualClass, "red");
  assert.equal(entry.sticky, true);
  const content = fs.readFileSync(entry.journalPath, "utf8");
  assert.doesNotMatch(content, /do-not-log/);
  assert.match(content, /REDACTED/);
});

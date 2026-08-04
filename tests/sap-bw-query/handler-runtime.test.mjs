import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const subjectUrl = pathToFileURL(path.resolve(here, "../../plugins/sap-bw-query/mcp/src/tool-handlers.mjs"));
const draftsUrl = pathToFileURL(path.resolve(here, "../../plugins/sap-bw-query/mcp/src/draft-state.mjs"));

async function load(url) {
  try { return await import(url); } catch { return null; }
}

const spec = {
  version: 1,
  target: { system: "BWD", client: "100", project: "BWD_100", provider: "ZCUBE_SALES" },
  technicalName: "Z_SALES_NEW",
  axes: { rows: [{ technicalName: "0CUSTOMER" }], columns: [{ technicalName: "0NETSALES", kind: "keyFigure" }] },
  businessPurpose: "Analyze net sales by customer",
  acceptanceCriteria: ["Reconciles to monthly control total"],
  evidence: [],
};

function dependencies(draftStore) {
  const calls = [];
  return {
    calls,
    deps: {
      studio: { run: async (action, input) => ({ action, input }) },
      connections: {
        prepare: (input) => input,
        importLandscape: () => ({}),
        status: () => ({ ssoEnabled: true }),
        reachability: async () => ({ reachable: true, authenticated: false }),
      },
      drafts: draftStore,
      bridge: { call: async (method, input) => { calls.push({ method, input }); return method === "listQueries" ? { technicalNames: [] } : { method }; } },
      steps: { append: () => undefined },
    },
  };
}

test("handlers reject secret input before invoking dependencies", async () => {
  const subject = await load(subjectUrl);
  const drafts = await load(draftsUrl);
  assert.ok(subject && drafts, "tool handlers are not implemented");
  const fixture = dependencies(new drafts.DraftStore());
  const handlers = subject.createToolHandlers(fixture.deps);
  await assert.rejects(() => handlers.bw_connection_prepare({ connection: { alias: "BWD", password: "do-not-use" } }), { code: "SECRET_REJECTED" });
  assert.equal(fixture.calls.length, 0);
});

test("query read operations use only allow-listed bridge methods", async () => {
  const subject = await load(subjectUrl);
  const drafts = await load(draftsUrl);
  assert.ok(subject && drafts, "tool handlers are not implemented");
  const fixture = dependencies(new drafts.DraftStore());
  const handlers = subject.createToolHandlers(fixture.deps);
  await handlers.bw_inspect_capabilities({});
  await handlers.bw_describe_provider({ alias: "BWD", project: "BWD_100", provider: "ZCUBE_SALES" });
  await handlers.bw_list_queries({ alias: "BWD", project: "BWD_100", provider: "ZCUBE_SALES" });
  await handlers.bw_read_query({ alias: "BWD", project: "BWD_100", technicalName: "Z_EXISTING" });
  assert.deepEqual(fixture.calls.map((call) => call.method), ["inspectCapabilities", "describeProvider", "listQueries", "readQuery"]);
});

test("prepare-save checks collisions and asks Eclipse only to prepare human confirmation", async () => {
  const subject = await load(subjectUrl);
  const drafts = await load(draftsUrl);
  assert.ok(subject && drafts, "tool handlers are not implemented");
  const store = new drafts.DraftStore();
  const draft = store.create(spec);
  const fixture = dependencies(store);
  const handlers = subject.createToolHandlers(fixture.deps);
  const result = await handlers.bw_prepare_new_query_save({ draftId: draft.id });
  assert.equal(result.requiresEclipseHumanConfirmation, true);
  assert.deepEqual(fixture.calls.map((call) => call.method), ["listQueries", "prepareNewQuerySave"]);
  assert.equal(fixture.calls.some((call) => /save|delete|overwrite/i.test(call.method) && call.method !== "prepareNewQuerySave"), false);
});

test("spec validation with alias fetches provider metadata read-only and verifies names", async () => {
  const subject = await load(subjectUrl);
  const drafts = await load(draftsUrl);
  assert.ok(subject && drafts, "tool handlers are not implemented");
  const fixture = dependencies(new drafts.DraftStore());
  fixture.deps.bridge = {
    call: async (method, input) => {
      fixture.calls.push({ method, input });
      assert.equal(method, "describeProvider");
      return {
        provider: input.provider,
        openQueries: [],
        readOnly: true,
        metadata: {
          available: true,
          characteristics: [{ name: "0CUSTOMER", description: "Customer" }],
          keyFigures: [{ name: "0NETSALES", description: "Net sales" }],
        },
      };
    },
  };
  const handlers = subject.createToolHandlers(fixture.deps);
  const result = await handlers.bw_resolve_and_validate_spec({ spec, alias: "BWD" });
  assert.equal(result.metadataChecked, true);
  assert.equal(result.readyForDraft, true);
  assert.ok(Array.isArray(result.bestPractices), "valid spec result carries a bestPractices array");
  assert.deepEqual(fixture.calls.map((call) => call.method), ["describeProvider"]);
  const failing = await handlers.bw_resolve_and_validate_spec({
    spec: { ...spec, axes: { rows: [{ technicalName: "0NOT_THERE" }], columns: spec.axes.columns } },
    alias: "BWD",
  });
  assert.equal(failing.readyForDraft, false);
  assert.ok(failing.gaps.some((gap) => gap.code === "UNKNOWN_CHARACTERISTIC"));
});

test("spec validation degrades to metadata-less review when the bridge is unavailable", async () => {
  const subject = await load(subjectUrl);
  const drafts = await load(draftsUrl);
  assert.ok(subject && drafts, "tool handlers are not implemented");
  const fixture = dependencies(new drafts.DraftStore());
  fixture.deps.bridge = { call: async () => { throw new Error("studio offline"); } };
  const handlers = subject.createToolHandlers(fixture.deps);
  const result = await handlers.bw_resolve_and_validate_spec({ spec, alias: "BWD" });
  assert.equal(result.valid, true);
  assert.equal(result.metadataChecked, false);
  assert.ok(result.gaps.some((gap) => gap.code === "METADATA_UNAVAILABLE"));
  const withoutAlias = await handlers.bw_resolve_and_validate_spec({ spec });
  assert.equal(withoutAlias.metadataChecked, false);
});

test("handler map exactly matches the public tool registry", async () => {
  const subject = await load(subjectUrl);
  const drafts = await load(draftsUrl);
  assert.ok(subject && drafts, "tool handlers are not implemented");
  const fixture = dependencies(new drafts.DraftStore());
  const handlers = subject.createToolHandlers(fixture.deps);
  assert.equal(Object.hasOwn(handlers, "save"), false);
  assert.equal(Object.keys(handlers).some((name) => /delete|remove|cleanup|uninstall|overwrite|transport|raw/i.test(name)), false);
  assert.equal(Object.keys(handlers).length, 22);
});

test("bw_studio_status surfaces the injected provenance object", async () => {
  const subject = await load(subjectUrl);
  const drafts = await load(draftsUrl);
  assert.ok(subject && drafts, "tool handlers are not implemented");
  const fixture = dependencies(new drafts.DraftStore());
  const injected = { commit: "a".repeat(40), source: "env-override", trusted: true };
  const handlers = subject.createToolHandlers({ ...fixture.deps, provenance: injected });
  const result = await handlers.bw_studio_status({});
  assert.deepEqual(result.provenance, injected);
});

test("bw_studio_status surfaces a default dev-unpinned provenance when none is injected", async () => {
  const subject = await load(subjectUrl);
  const drafts = await load(draftsUrl);
  assert.ok(subject && drafts, "tool handlers are not implemented");
  const fixture = dependencies(new drafts.DraftStore());
  const handlers = subject.createToolHandlers(fixture.deps);
  const result = await handlers.bw_studio_status({});
  assert.ok(result.provenance, "bw_studio_status must always carry a provenance object");
  assert.equal(result.provenance.commit, null);
  assert.equal(result.provenance.trusted, false);
  assert.notEqual(result.provenance.commit, "source-commit");
});

test("editor population requires a prepared save and never saves itself", async () => {
  const subject = await load(subjectUrl);
  const drafts = await load(draftsUrl);
  assert.ok(subject && drafts, "tool handlers are not implemented");
  const store = new drafts.DraftStore();
  const draft = store.create(spec);
  const fixture = dependencies(store);
  fixture.deps.bridge = {
    call: async (method, input) => {
      fixture.calls.push({ method, input });
      if (method === "listQueries") return { technicalNames: [] };
      if (method === "populateQueryEditor") {
        assert.equal(input.confirmationBinding.technicalName, spec.technicalName);
        assert.ok(input.confirmationBinding.specHash);
        assert.ok(input.spec);
        return { populated: true, saved: false, applyReport: [{ path: "axes.rows[0CUSTOMER]", status: "APPLIED" }] };
      }
      if (method === "readQueryModel") {
        assert.equal(input.technicalName, spec.technicalName);
        assert.equal(input.project, spec.target.project);
        return {
          found: true,
          technicalName: spec.technicalName,
          axes: {
            rows: [{ kind: "characteristic", infoObjectName: "0CUSTOMER" }],
            columns: [{
              kind: "structure", technicalName: "", members: [
                { type: "selection", description: "0NETSALES", groups: [{ infoObject: "0NETSALES", tokens: [] }] },
              ],
            }],
            free: [],
          },
          filter: { selections: [] },
          conditions: [],
          exceptions: [],
          settings: {},
          serializationIssues: [],
        };
      }
      return { method };
    },
  };
  const handlers = subject.createToolHandlers(fixture.deps);
  await assert.rejects(() => handlers.bw_populate_query_editor({ draftId: draft.id }), /bw_prepare_new_query_save first/i);
  await handlers.bw_prepare_new_query_save({ draftId: draft.id });
  const result = await handlers.bw_populate_query_editor({ draftId: draft.id });
  assert.equal(result.populated, true);
  assert.equal(result.saved, false);
  assert.equal(result.applyReport.length, 1);
  assert.equal(result.verification.status, "VERIFIED");
  assert.deepEqual(fixture.calls.map((call) => call.method), ["listQueries", "prepareNewQuerySave", "populateQueryEditor", "readQueryModel"]);
});

// --- Finding #4: BW-originated responses must be marked as untrusted content ---

function readDependencies() {
  const calls = [];
  return {
    calls,
    deps: {
      studio: { run: async (action, input) => ({ action, input }) },
      connections: {
        prepare: (input) => input,
        importLandscape: () => ({}),
        status: () => ({ ssoEnabled: true }),
        reachability: async () => ({ reachable: true, authenticated: false }),
      },
      drafts: { create: () => ({ id: "d1" }), get: () => ({ id: "d1", spec: {} }), apply: () => ({ id: "d1", spec: {} }), prepareSave: () => ({}) },
      bridge: {
        call: async (method, input) => {
          calls.push({ method, input });
          if (method === "listQueries") return { technicalNames: ["Z_A"] };
          return { method, echo: input };
        },
      },
      steps: { append: () => undefined },
    },
  };
}

test("read-only-tenant handlers mark BW-originated responses as untrusted (lossless)", async () => {
  const subject = await load(subjectUrl);
  assert.ok(subject, "tool handlers are not implemented");
  const fixture = readDependencies();
  const handlers = subject.createToolHandlers(fixture.deps);

  const describe = await handlers.bw_describe_provider({ alias: "BWD", project: "BWD_100", provider: "ZCUBE_SALES" });
  assert.equal(describe.method, "describeProvider", "original field preserved");
  assert.ok(describe._untrustedContent, "bw_describe_provider must mark response untrusted");
  assert.equal(describe._untrustedContent.source, "sap-bw");
  assert.equal(typeof describe._untrustedContent.warning, "string");
  assert.ok(describe._untrustedContent.warning.length > 0);

  const list = await handlers.bw_list_queries({ alias: "BWD", project: "BWD_100", provider: "ZCUBE_SALES" });
  assert.deepEqual(list.technicalNames, ["Z_A"], "original field preserved");
  assert.ok(list._untrustedContent, "bw_list_queries must mark response untrusted");
  assert.equal(list._untrustedContent.source, "sap-bw");

  const read = await handlers.bw_read_query({ alias: "BWD", project: "BWD_100", technicalName: "Z_EXISTING" });
  assert.equal(read.method, "readQuery", "original field preserved");
  assert.ok(read._untrustedContent, "bw_read_query must mark response untrusted");
  assert.equal(read._untrustedContent.source, "sap-bw");

  const model = await handlers.bw_read_query_model({ alias: "BWD", project: "BWD_100", technicalName: "Z_EXISTING" });
  assert.equal(model.method, "readQueryModel", "original field preserved");
  assert.ok(model._untrustedContent, "bw_read_query_model must mark response untrusted");
  assert.equal(model._untrustedContent.source, "sap-bw");
});

test("bw_review_query marks the response untrusted only when found === true", async () => {
  const subject = await load(subjectUrl);
  assert.ok(subject, "tool handlers are not implemented");

  // found === true path: bridge returns a full model; the final review object must be marked.
  const foundFixture = readDependencies();
  foundFixture.deps.bridge = {
    call: async (method, input) => {
      foundFixture.calls.push({ method, input });
      return {
        found: true,
        technicalName: input.technicalName,
        provider: "ZCUBE_SALES",
        axes: { rows: [], columns: [], free: [] },
        filter: { selections: [] },
        conditions: [],
        exceptions: [],
        settings: {},
        serializationIssues: [],
      };
    },
  };
  const handlersHit = subject.createToolHandlers(foundFixture.deps);
  const hit = await handlersHit.bw_review_query({ alias: "BWD", project: "BWD_100", technicalName: "Z_EXISTING" });
  assert.equal(hit.found, true);
  assert.ok(hit._untrustedContent, "bw_review_query must mark response untrusted when found === true");
  assert.equal(hit._untrustedContent.source, "sap-bw");
  assert.equal(hit.technicalName, "Z_EXISTING", "original field preserved alongside marker");

  // found !== true path: NO _untrustedContent (no BW content was read).
  const missFixture = readDependencies();
  missFixture.deps.bridge = {
    call: async () => ({ found: false, userActionRequired: true, instruction: "open the query" }),
  };
  const handlersMiss = subject.createToolHandlers(missFixture.deps);
  const miss = await handlersMiss.bw_review_query({ alias: "BWD", project: "BWD_100", technicalName: "Z_MISSING" });
  assert.equal(miss.found, false);
  assert.equal(miss._untrustedContent, undefined, "must NOT mark response when found !== true");
});

test("untrusted marking does not alter the bridge call surface for read operations", async () => {
  const subject = await load(subjectUrl);
  assert.ok(subject, "tool handlers are not implemented");
  const fixture = readDependencies();
  const handlers = subject.createToolHandlers(fixture.deps);
  await handlers.bw_inspect_capabilities({});
  await handlers.bw_describe_provider({ alias: "BWD", project: "BWD_100", provider: "ZCUBE_SALES" });
  await handlers.bw_list_queries({ alias: "BWD", project: "BWD_100", provider: "ZCUBE_SALES" });
  await handlers.bw_read_query({ alias: "BWD", project: "BWD_100", technicalName: "Z_EXISTING" });
  await handlers.bw_read_query_model({ alias: "BWD", project: "BWD_100", technicalName: "Z_EXISTING" });
  // The marker is additive on the response only; bridge call methods must be unchanged.
  assert.deepEqual(
    fixture.calls.map((call) => call.method),
    ["inspectCapabilities", "describeProvider", "listQueries", "readQuery", "readQueryModel"],
  );
});

// --- Finding #2: unsigned-bundle deploy gate (Node side) ---

function writeManifest(keyId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-manifest-"));
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ keyId, artifact: "bundle.zip", version: "1.0.0" }));
  return manifestPath;
}

function writeMalformedManifest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bw-manifest-"));
  const manifestPath = path.join(dir, "manifest.json");
  fs.writeFileSync(manifestPath, "{ not valid json");
  return manifestPath;
}

function studioSpy() {
  const calls = [];
  return {
    calls,
    studio: {
      run: async (action, input) => {
        calls.push({ action, input });
        return { deployed: true, action, input };
      },
    },
  };
}

test("bw_studio_deploy rejects an unsigned manifest when the env opt-in is not set", async () => {
  const subject = await load(subjectUrl);
  assert.ok(subject, "tool handlers are not implemented");
  const manifestPath = writeManifest("LOCAL-UNSIGNED");
  const prev = process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
  delete process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
  try {
    const spy = studioSpy();
    const handlers = subject.createToolHandlers({
      studio: spy.studio,
      connections: { prepare: () => ({}), importLandscape: () => ({}), status: () => ({}), reachability: async () => ({}) },
      drafts: { create: () => ({}), get: () => ({}), apply: () => ({}), prepareSave: () => ({}) },
      bridge: { call: async () => ({}) },
      steps: { append: () => undefined },
    });
    await assert.rejects(
      () => handlers.bw_studio_deploy({ manifestPath }),
      (err) => err.code === "UNSIGNED_BUNDLE_NOT_ALLOWED",
    );
    assert.equal(spy.calls.length, 0, "studio.run must not be called when the gate rejects");
  } finally {
    if (prev === undefined) delete process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
    else process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE = prev;
  }
});

test("bw_studio_deploy proceeds on an unsigned manifest when BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE=1", async () => {
  const subject = await load(subjectUrl);
  assert.ok(subject, "tool handlers are not implemented");
  const manifestPath = writeManifest("LOCAL-UNSIGNED");
  const prev = process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
  process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE = "1";
  try {
    const spy = studioSpy();
    const handlers = subject.createToolHandlers({
      studio: spy.studio,
      connections: { prepare: () => ({}), importLandscape: () => ({}), status: () => ({}), reachability: async () => ({}) },
      drafts: { create: () => ({}), get: () => ({}), apply: () => ({}), prepareSave: () => ({}) },
      bridge: { call: async () => ({}) },
      steps: { append: () => undefined },
    });
    const input = { manifestPath, artifactPath: "/tmp/artifact.zip" };
    const result = await handlers.bw_studio_deploy(input);
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].action, "Deploy");
    assert.deepEqual(spy.calls[0].input, input);
    assert.equal(result.deployed, true);
  } finally {
    if (prev === undefined) delete process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
    else process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE = prev;
  }
});

test("bw_studio_deploy proceeds on a signed manifest without the env opt-in", async () => {
  const subject = await load(subjectUrl);
  assert.ok(subject, "tool handlers are not implemented");
  const manifestPath = writeManifest("sap-skills-release-2026");
  const prev = process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
  delete process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
  try {
    const spy = studioSpy();
    const handlers = subject.createToolHandlers({
      studio: spy.studio,
      connections: { prepare: () => ({}), importLandscape: () => ({}), status: () => ({}), reachability: async () => ({}) },
      drafts: { create: () => ({}), get: () => ({}), apply: () => ({}), prepareSave: () => ({}) },
      bridge: { call: async () => ({}) },
      steps: { append: () => undefined },
    });
    const result = await handlers.bw_studio_deploy({ manifestPath });
    assert.equal(spy.calls.length, 1);
    assert.equal(spy.calls[0].action, "Deploy");
    assert.equal(result.deployed, true);
  } finally {
    if (prev === undefined) delete process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
    else process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE = prev;
  }
});

test("bw_studio_deploy rejects with MANIFEST_UNREADABLE when the manifest cannot be parsed", async () => {
  const subject = await load(subjectUrl);
  assert.ok(subject, "tool handlers are not implemented");
  const manifestPath = writeMalformedManifest();
  const prev = process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
  delete process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
  try {
    const spy = studioSpy();
    const handlers = subject.createToolHandlers({
      studio: spy.studio,
      connections: { prepare: () => ({}), importLandscape: () => ({}), status: () => ({}), reachability: async () => ({}) },
      drafts: { create: () => ({}), get: () => ({}), apply: () => ({}), prepareSave: () => ({}) },
      bridge: { call: async () => ({}) },
      steps: { append: () => undefined },
    });
    await assert.rejects(
      () => handlers.bw_studio_deploy({ manifestPath }),
      (err) => err.code === "MANIFEST_UNREADABLE",
    );
    assert.equal(spy.calls.length, 0, "studio.run must not be called when the manifest is unreadable");
  } finally {
    if (prev === undefined) delete process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
    else process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE = prev;
  }
});

test("bw_studio_deploy rejects when manifestPath is omitted", async () => {
  const subject = await load(subjectUrl);
  assert.ok(subject, "tool handlers are not implemented");
  const prev = process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
  delete process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
  try {
    const spy = studioSpy();
    const handlers = subject.createToolHandlers({
      studio: spy.studio,
      connections: { prepare: () => ({}), importLandscape: () => ({}), status: () => ({}), reachability: async () => ({}) },
      drafts: { create: () => ({}), get: () => ({}), apply: () => ({}), prepareSave: () => ({}) },
      bridge: { call: async () => ({}) },
      steps: { append: () => undefined },
    });
    await assert.rejects(
      () => handlers.bw_studio_deploy({}),
      (err) => err.code === "MANIFEST_UNREADABLE",
    );
    assert.equal(spy.calls.length, 0, "studio.run must not be called when manifestPath is omitted");
  } finally {
    if (prev === undefined) delete process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE;
    else process.env.BW_AUTOMATION_ALLOW_UNSIGNED_BUNDLE = prev;
  }
});

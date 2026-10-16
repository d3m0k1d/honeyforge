import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { computed, reactive, ref, watch } from "vue";
import { createPinia, defineStore, disposePinia, setActivePinia } from "pinia";

// Execute actual store/cache source, injecting Nuxt auto-imports and the HTTP boundary.
function load(file, exports, bindings = {}) {
  const source = stripTypeScriptTypes(readFileSync(new URL(`../app/${file}.ts`, import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "")
    .replace(/^export /gm, "").replaceAll("import.meta.client", "false");
  return vm.runInNewContext(`${source}\n({ ${exports} })`, {
    defineStore, ref, computed, watch, setTimeout, clearTimeout, ...bindings,
  });
}

const permissions = ["agents:read", "deployments:read", "deployments:manage"];
const agent = (id = "agent-a") => ({ agent_id: id, online: true });
const row = (id = "deployment-a") => ({
  id, name: id, agent_id: "agent-a", honeypot_type: "ftp-low", level: "low",
  config: { listen: "0.0.0.0:2121" }, desired_state: "running", observed_state: "stopped",
  last_error: null, created_at: "2026-10-16T00:00:00Z",
});
const catalogue = [{ slug: "ftp-low", level: "low", driver: "imitor" }];
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(t, granted = permissions) {
  const pinia = createPinia();
  setActivePinia(pinia);
  t.after(() => disposePinia(pinia));
  const auth = reactive({
    user: { id: "user-a", permissions: [...granted] },
    can(permission) { return this.user?.permissions.includes(permission) ?? false; },
  });
  const cache = load("api/cache", "clearCache, dedupe");
  let clears = 0;
  const calls = [];
  const api = {
    agents: async () => [agent(), agent()], catalogue: async () => catalogue,
    deployments: async () => [row()], create: async () => row("created"),
    action: async (id) => ({ ...row(id), desired_state: "deleted" }),
  };
  const list = (name) => (...args) => cache.dedupe(`${name}:${JSON.stringify(args)}`, async () => {
    calls.push({ name, args });
    return api[name](...args);
  });
  const resources = {
    agents: { list: list("agents") }, honeypotTypes: { list: list("catalogue") },
    deployments: { list: list("deployments"), create: (...args) => api.create(...args), action: (...args) => api.action(...args) },
  };
  const bindings = {
    resources, useAuthStore: () => auth, toApiError: (error) => error,
    clearCache: () => { clears++; cache.clearCache(); },
  };
  const { useAgentsStore } = load("stores/agents", "useAgentsStore", bindings);
  const agents = useAgentsStore();
  const { useTrapsStore } = load("stores/traps", "useTrapsStore", {
    ...bindings, useAgentsStore,
    TRAP_FIELDS: [{ key: "name", defaultVisible: true, locked: true }], LEVEL_BY_KEY: {},
  });
  return { auth, api, calls, agents, traps: useTrapsStore(), clears: () => clears };
}

test("pagination, real agent IDs, distinct online count and unavailable deployment events", async (t) => {
  const { traps, agents, api, calls } = setup(t);
  api.deployments = async ({ offset }) => offset === 0
    ? Array.from({ length: 100 }, (_, id) => row(String(id))) : [row("last")];
  await Promise.all([traps.load(), traps.load()]);
  assert.equal(traps.traps.length, 101);
  assert.equal(agents.onlineCount, 1);
  assert.equal(traps.traps[0].agentId, "agent-a");
  assert.equal(traps.traps[0].services[0].key, "ftp");
  assert.equal(traps.traps[0].services[0].port, 2121);
  assert.equal(traps.traps[0].eventsCount, null);
  assert.equal(traps.traps[0].events.length, 0);
  assert.equal(traps.totalEvents, null);
  assert.equal(traps.profiles[0].id, "ftp-low");
  assert.equal(calls.filter(({ name }) => name === "deployments").length, 2);
  for (const { name, args } of calls) {
    const options = args[name === "deployments" ? 1 : 0];
    assert.equal(options.cache.force, true);
    assert.equal(options.cache.swr, false);
    assert.equal(options.cache.persist, false);
    if (name === "deployments") assert.equal(args[0].limit, 100);
  }
});

test("failed reads clear data; catalogue 403 remains an explicit error, not a successful zero", async (t) => {
  const { traps, agents, api } = setup(t);
  await traps.load();
  api.catalogue = async () => { throw Object.assign(Error("catalogue forbidden"), { status: 403 }); };
  await traps.load();
  assert.equal(traps.loaded, true, "deployment list can succeed independently");
  assert.equal(traps.profiles.length, 0);
  assert.match(traps.catalogueError, /forbidden/);
  api.agents = async () => { throw Error("agents failed"); };
  api.deployments = async () => { throw Error("deployments failed"); };
  await traps.load();
  assert.equal(agents.agents.length, 0);
  assert.equal(agents.onlineCount, null);
  assert.match(agents.error, /failed/);
  assert.equal(traps.traps.length, 0);
  assert.equal(traps.loaded, false);
  assert.match(traps.error, /failed/);
});

test("manage without read does not issue reads or mutations", async (t) => {
  const { traps, agents, calls } = setup(t, ["deployments:manage"]);
  await traps.load();
  assert.equal(calls.length, 0);
  assert.equal(traps.canManage, false);
  assert.equal(traps.loaded, false);
  assert.equal(agents.onlineCount, null);
  assert.match(traps.error, /deployments:read/);
  assert.equal(await traps.createTrap({}), null);
  assert.equal(await traps.runAction("id", "start"), null);
  assert.match(traps.actionError, /deployments:read/);
});

for (const boundary of ["agents", "catalogue", "deployments"]) {
  test(`${boundary}: logout clears data and dedup; late response cannot replace the new session`, async (t) => {
    const { traps, agents, auth, api, clears } = setup(t);
    await traps.load();
    const old = deferred();
    api[boundary] = () => old.promise;
    const previous = traps.load();
    await tick();
    auth.user = null;
    assert.equal(traps.traps.length, 0);
    assert.equal(traps.profiles.length, 0);
    assert.equal(agents.agents.length, 0);
    assert.equal(traps.pending, false);
    assert.equal(agents.loaded, false);
    assert.equal(agents.onlineCount, null);
    assert.ok(clears() >= 2);
    auth.user = { id: "user-b", permissions: [...permissions] };
    const current = deferred();
    api[boundary] = () => current.promise;
    const latest = traps.load();
    await tick();
    old.resolve(boundary === "agents" ? [agent("old")] : boundary === "catalogue" ? catalogue : [row("old")]);
    await previous;
    assert.equal(traps.pending, true, "old finally must not reset the new load");
    assert.equal(traps.error, null);
    current.resolve(boundary === "agents" ? [agent("new")] : boundary === "catalogue" ? catalogue : [row("new")]);
    await latest;
    assert.equal(traps.loaded, true);
    assert.notEqual(agents.agents[0].agent_id, "old");
    assert.notEqual(traps.traps[0].id, "old");
  });
}

test("same-user replacement and in-place permission revocation reject stale reads", async (t) => {
  const { traps, agents, auth, api, calls } = setup(t);
  await traps.load();
  auth.user = { ...auth.user };
  assert.equal(traps.traps.length, 0);
  assert.equal(agents.agents.length, 0);
  const old = deferred();
  api.deployments = () => old.promise;
  const pending = traps.load();
  await tick();
  auth.user.permissions.splice(0);
  assert.equal(traps.profiles.length, 0);
  assert.equal(traps.pending, false);
  old.reject(Error("old session failed"));
  await pending;
  assert.equal(traps.error, null);
  const count = calls.length;
  await traps.load();
  assert.equal(calls.length, count);
  assert.match(traps.error, /deployments:read/);
});

for (const mutation of ["create", "action"]) {
  test(`${mutation}: stale mutations cannot insert rows, errors or reset current pending state`, async (t) => {
    const { traps, auth, api } = setup(t);
    await traps.load();
    const invoke = () => mutation === "create" ? traps.createTrap({}) : traps.runAction("deployment-a", "stop");
    const old = deferred();
    api[mutation] = () => old.promise;
    const previous = invoke();
    auth.user = { ...auth.user };
    assert.equal(traps.actionPending, null);
    const current = deferred();
    api[mutation] = () => current.promise;
    const latest = invoke();
    old.resolve(row("old"));
    assert.equal(await previous, null);
    assert.notEqual(traps.actionPending, null);
    assert.equal(traps.traps.length, 0);
    assert.equal(traps.actionError, null);
    auth.user.permissions.splice(0);
    current.reject(Error("late mutation failed"));
    assert.equal(await latest, null);
    assert.equal(traps.actionError, null);
    assert.equal(traps.actionPending, null);
  });
}

test("destroy retains the server row and mutation failures preserve confirmation for retry", async (t) => {
  const { traps, api } = setup(t);
  await traps.load();
  const created = await traps.createTrap({ name: "new", agent_id: "agent-a", honeypot_type: "ftp-low", config: {} });
  assert.equal(created.id, "created");
  assert.equal(traps.getTrap("created").eventsCount, null);
  traps.requestDelete("deployment-a");
  api.action = async () => { throw Error("destroy failed"); };
  assert.equal(await traps.confirmDelete(), null);
  assert.equal(traps.pendingDeleteId, "deployment-a");
  assert.match(traps.actionError, /destroy failed/);
  api.action = async () => ({ ...row(), desired_state: "deleted" });
  await traps.confirmDelete();
  assert.equal(traps.traps.length, 2);
  assert.equal(traps.getTrap("deployment-a").desiredState, "deleted");
  assert.equal(traps.pendingDeleteId, null);
});

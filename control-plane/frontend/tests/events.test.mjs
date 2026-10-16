import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { computed, reactive, ref, watch } from "vue";
import { createPinia, defineStore, disposePinia, setActivePinia } from "pinia";
import { compileScript, compileTemplate, parse } from "@vue/compiler-sfc";

// Run the actual store source with only Nuxt's auto-imports and HTTP boundary injected.
function loadStore(file, name, bindings) {
  const source = readFileSync(new URL(`../app/stores/${file}.ts`, import.meta.url), "utf8")
    .replace(/^import .*;\n/gm, "")
    .replace(/^export /gm, "");
  return vm.runInNewContext(`${stripTypeScriptTypes(source)}\n${name}`, {
    defineStore, ref, computed, watch, ...bindings,
  });
}

const event = (overrides = {}) => ({
  id: 1, event_id: "event-1", agent_id: "agent-a", ts: new Date().toISOString(),
  service: "new-protocol", src: "192.0.2.1", event: "new-event", level: "high",
  severity: null, data: { message: "hello" }, ...overrides,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup(t) {
  const pinia = createPinia();
  setActivePinia(pinia);
  t.after(() => disposePinia(pinia));
  const auth = reactive({
    user: { id: "user-a", permissions: ["events:read"] },
    can(permission) { return this.user?.permissions.includes(permission) ?? false; },
  });
  const calls = [];
  let cacheClears = 0;
  const api = {
    list: async () => [event()],
    stats: async () => ({ total: 5000 }),
  };
  const resources = { events: {
    list(...args) { calls.push(args); return api.list(...args); },
    stats(...args) {
      assert.equal(Object.keys(args[0]).length, 0, "stats must remain global");
      return api.stats(...args);
    },
  } };
  const useEventsStore = loadStore("events", "useEventsStore", {
    resources, toApiError: (error) => error, useAuthStore: () => auth,
    clearCache: () => { cacheClears++; },
  });
  const store = useEventsStore();
  const useAnalyticsStore = loadStore("analytics", "useAnalyticsStore", { useEventsStore });
  return { store, analytics: useAnalyticsStore(), auth, api, calls, cacheClears: () => cacheClears };
}

test("recent API window preserves unknown values and filters actual agent events", async (t) => {
  const { store, analytics, api, calls } = setup(t);
  api.list = async () => [
    event(),
    event({ id: 2, agent_id: "agent-b", src: null, service: "ssh", severity: "critical" }),
    event({ id: 3, ts: "2020-01-01T00:00:00Z", event: "__proto__", severity: "__proto__" }),
  ];
  await store.load();
  const [query, options] = calls[0];
  assert.equal(query.offset, 0);
  assert.equal(query.limit, 1000);
  assert.equal(options.cache.force, true);
  assert.equal(options.cache.swr, false);
  assert.equal(options.cache.persist, false);
  assert.equal(store.stats.total, 5000);
  assert.equal(analytics.sortedEvents.length, 2);
  assert.equal(analytics.uniqueAttackers, 1);
  assert.equal(analytics.involvedAgents, 2);
  assert.equal(analytics.baseEvents[0].severity, "unknown", "level is not severity");
  analytics.setServiceFilter("new-protocol");
  assert.equal(analytics.sortedEvents.length, 1);
  assert.equal(analytics.serviceStats[0].label, "new-protocol");
  assert.equal(analytics.actionStats[0].label, "new-event");
  analytics.setSearch("hello");
  assert.equal(analytics.sortedEvents.length, 1);
  analytics.setSearch("absent");
  assert.equal(analytics.sortedEvents.length, 0);
  analytics.reset();
  analytics.setPeriod("all");
  assert.equal(analytics.severityStats.__proto__, 1);
  assert.equal(analytics.timeline.values.reduce((sum, count) => sum + count, 0), 3);
  analytics.setAgent("agent-b");
  assert.equal(analytics.sortedEvents.length, 1);
  assert.equal(store.stats.total, 5000, "local filters must not change global totals");
});

test("list failures clear events and stats; stats-only failures retain fresh events", async (t) => {
  const { store, api } = setup(t);
  await store.load();
  api.list = async () => { throw Error("list failed"); };
  await store.load();
  assert.equal(store.events.length, 0);
  assert.equal(store.stats, null);
  assert.match(store.error, /list failed/);
  assert.equal(store.loading, false);
  api.list = async () => [event()];
  api.stats = async () => { throw Error("stats failed"); };
  await store.load();
  assert.equal(store.events.length, 1);
  assert.equal(store.stats, null);
  assert.match(store.error, /stats failed/);
});

test("logout clears data immediately and rejects late responses after login", async (t) => {
  const { store, auth, api, cacheClears } = setup(t);
  await store.load();
  const old = deferred();
  api.list = () => old.promise;
  const pending = store.load();
  auth.user = null;
  assert.equal(cacheClears(), 1, "session boundaries must invalidate shared API deduplication");
  assert.equal(store.events.length, 0);
  assert.equal(store.stats, null);
  assert.equal(store.loading, false);
  auth.user = { id: "user-b", permissions: ["events:read"] };
  api.list = async () => [event({ id: 2 })];
  await store.load();
  old.resolve([event({ id: 99 })]);
  await pending;
  assert.equal(store.events[0].id, 2);
});

test("session replacement and permission revocation invalidate in-flight requests", async (t) => {
  const { store, auth, api, calls } = setup(t);
  await store.load();
  const old = deferred();
  api.list = () => old.promise;
  const pending = store.load();
  auth.user = { ...auth.user };
  assert.equal(store.events.length, 0, "even replacement of the same user starts a new session");
  const current = deferred();
  api.list = () => current.promise;
  const currentLoad = store.load();
  const count = calls.length;
  await store.load();
  assert.equal(calls.length, count, "loads in the same session must not overlap");
  old.reject(Error("old session failed"));
  await pending;
  assert.equal(store.loading, true, "old finally must not clear the current loading state");
  assert.equal(store.error, null);
  auth.user.permissions.splice(0);
  assert.equal(store.loading, false);
  current.resolve([event()]);
  await currentLoad;
  assert.equal(store.events.length, 0);
  assert.equal(store.stats, null);
  await store.load();
  assert.equal(calls.length, count);
  assert.match(store.error, /events:read/);
});

test("analytics page and migrated components compile without trap compatibility fields", () => {
  for (const file of ["pages/analytics.vue", "components/AnalyticsToolbar.vue", "components/AnalyticsEventLog.vue"]) {
    const source = readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /store\.(?:trapId|trapOptions|activeTrap|setTrap)|event\.(?:trapId|trapName)/);
    const { descriptor, errors } = parse(source, { filename: file });
    assert.equal(errors.length, 0);
    const script = compileScript(descriptor, { id: file });
    const template = compileTemplate({ source: descriptor.template.content, filename: file, id: file,
      compilerOptions: { bindingMetadata: script.bindings, expressionPlugins: ["typescript"] } });
    assert.equal(template.errors.length, 0, `${file}: ${template.errors.join(", ")}`);
  }
});

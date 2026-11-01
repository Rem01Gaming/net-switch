import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeSelections, normalizeProfiles, parseSnapshot, isolationState, needsUidConsent, shellQuote,
} from "../webui/src/scripts/backend.js";

const data = [
  "user\t0\tOwner\trunning",
  "user\t10\tWork\tnot-running",
  "selection\tcom.example.alpha",
  "selection\t10:com.example.alpha",
  "selection\t12:com.example.missing",
  "app\t0\tcom.example.alpha\t10123",
  "app\t0\tcom.example.peer\t10123",
  "app\t10\tcom.example.alpha\t1010123",
  "app\t10\tcom.example.system\t1001000",
  "rule\tiptables\t10123",
  "rule\tip6tables\t10123",
  "rule\tiptables\t1010123",
].join("\n");

test("legacy and scoped profiles retain distinct instances and canonical user 0", () => {
  assert.deepEqual(normalizeSelections(["com.example.alpha", "0:com.example.alpha", "10:com.example.alpha"]),
    ["com.example.alpha", "10:com.example.alpha"]);
  const profiles = normalizeProfiles(JSON.parse('{"__proto__":["10:com.example.alpha"],"Old":["com.example.alpha"]}'));
  assert.equal(Object.getPrototypeOf(profiles), null);
  assert.deepEqual(JSON.parse(JSON.stringify(profiles)).__proto__, ["10:com.example.alpha"]);
});

test("invalid import data cannot become shell arguments", () => {
  for (const value of [null, {}, ["com.example.app;id"], ["10:com.example.app\n"], ["01:com.example.app"], ["1e2:com.example.app"], ["21475:com.example.app"]]) {
    assert.throws(() => normalizeSelections(value));
  }
  assert.equal(shellQuote("a'b$(id)`id`"), "'a'\\''b$(id)`id`'");
});

test("actual UID rule state distinguishes shared, partial and missing instances", () => {
  const snapshot = parseSnapshot(data);
  const state = (key) => isolationState(snapshot.apps.find((app) => app.key === key), snapshot);
  assert.equal(state("com.example.alpha"), "module_isolated");
  assert.equal(state("com.example.peer"), "shared_isolation");
  assert.equal(state("10:com.example.alpha"), "partial_isolation");
  assert.equal(state("12:com.example.missing"), "missing_instance");
  assert.equal(state("10:com.example.system"), "module_unblocked");
  assert.equal(snapshot.needsRefresh, true);
  assert.equal(needsUidConsent(snapshot.apps.find((app) => app.uid === "1001000"), snapshot), true);
  assert.equal(needsUidConsent(snapshot.apps[0], snapshot), true);
  assert.equal(needsUidConsent(snapshot.apps[2], snapshot), false);
});

test("stale and pending rules are visible without applying rules on open", () => {
  const snapshot = parseSnapshot(data.replace("rule\tiptables\t1010123", "rule\tiptables\t19999"));
  assert.equal(isolationState(snapshot.apps[2], snapshot), "pending_isolation");
  assert.equal(snapshot.needsRefresh, true);
  const script = readFileSync(new URL("../webui/src/scripts/index.js", import.meta.url), "utf8");
  assert.doesNotMatch(script, /iptables\s+-|packages\.list|pm list packages/);
  const persisted = script.slice(script.indexOf("async function loadPersistedProfile"), script.indexOf("function sortChecked"));
  assert.doesNotMatch(persisted, /loadProfile\(/);
});

test("new UI text has English and Chinese translations", () => {
  const en = JSON.parse(readFileSync(new URL("../webui/src/locales/strings/en.json", import.meta.url)));
  const zh = JSON.parse(readFileSync(new URL("../webui/src/locales/strings/zh.json", import.meta.url)));
  for (const key of ["android_user", "shared_uid_confirm", "module_isolated", "shared_isolation", "missing_instance", "partial_isolation", "refresh_required", "refresh_boundary"]) {
    assert.equal(typeof en[key], "string");
    assert.equal(typeof zh[key], "string");
  }
});

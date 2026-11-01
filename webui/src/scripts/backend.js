// Shared protocol helpers. Rules and UID resolution live in netswitch.
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function selectionKey(user, packageName) {
  return Number(user) === 0 ? packageName : `${user}:${packageName}`;
}

export function normalizeSelections(value) {
  if (!Array.isArray(value)) throw new Error("Invalid isolation profile");
  return [...new Set(value.map((key) => {
    if (typeof key !== "string" || !/^(?:(0|[1-9]\d*):)?[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) {
      throw new Error("Invalid user/package selection");
    }
    const [user, packageName] = key.includes(":") ? key.split(":") : ["0", key];
    if (Number(user) > 21474) throw new Error("Invalid Android user ID");
    return selectionKey(user, packageName);
  }))];
}

export function normalizeProfiles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid profiles file");
  return Object.assign(Object.create(null), Object.fromEntries(
    Object.entries(value).map(([name, entries]) => [name, normalizeSelections(entries)]),
  ));
}

export function parseSnapshot(text) {
  const users = [];
  const apps = [];
  const selections = [];
  const migration = [];
  const rules = { iptables: new Set(), ip6tables: new Set() };
  for (const line of text.trim().split("\n").filter(Boolean)) {
    const [kind, ...fields] = line.split("\t");
    if (kind === "user") users.push({ id: fields[0], name: fields[1], state: fields[2] });
    else if (kind === "selection") selections.push(fields[0]);
    else if (kind === "app") {
      const [user, packageName, uid] = fields;
      apps.push({ user, packageName, uid, key: selectionKey(user, packageName) });
    } else if (kind === "migration") {
      const [reason, packageName, uid] = fields;
      if (fields.length !== 3 || !["imported", "missing", "scope", "system", "shared"].includes(reason)
        || !/^(?:\d+:)?[A-Za-z_][A-Za-z0-9_.]*$/.test(packageName) || !/^(\d+|-)$/.test(uid)) {
        throw new Error("Invalid migration report");
      }
      migration.push({ reason, packageName, uid });
    } else if (kind === "rule" && rules[fields[0]]) rules[fields[0]].add(fields[1]);
    else throw new Error("Invalid backend response");
  }
  const selected = new Set(normalizeSelections(selections));
  const peers = new Map();
  for (const app of apps) {
    if (!peers.has(app.uid)) peers.set(app.uid, []);
    peers.get(app.uid).push(app);
  }
  const installed = new Set(apps.map((app) => app.key));
  for (const key of selected) {
    if (!installed.has(key)) {
      const [user, packageName] = key.includes(":") ? key.split(":") : ["0", key];
      apps.push({ user, packageName, key, uid: null });
    }
  }
  const desired = new Set(apps.filter((app) => selected.has(app.key) && app.uid).map((app) => app.uid));
  const needsRefresh = Object.values(rules).some((actual) =>
    actual.size !== desired.size || [...desired].some((uid) => !actual.has(uid)),
  );
  return { users, apps, selected, peers, rules, needsRefresh, migration };
}

export function isolationState(app, snapshot) {
  if (app.uid === null) return "missing_instance";
  const v4 = snapshot.rules.iptables.has(app.uid);
  const v6 = snapshot.rules.ip6tables.has(app.uid);
  if (v4 !== v6) return "partial_isolation";
  if (v4) return snapshot.selected.has(app.key) ? "module_isolated" : "shared_isolation";
  return snapshot.selected.has(app.key) ? "pending_isolation" : "module_unblocked";
}

export function needsUidConsent(app, snapshot) {
  return app.uid !== null && (Number(app.uid) % 100000 < 10000 || snapshot.peers.get(app.uid).length > 1);
}

// Modified: use the shared per-user backend for isolation and rule state.
import { exec, toast } from "kernelsu";
import { shellQuote, normalizeSelections, normalizeProfiles, parseSnapshot, isolationState, needsUidConsent } from "./backend.js";
import "./language.js";

const template = document.getElementById("app-template").content;
const appsList = document.getElementById("apps-list");

const backendPath = "/data/adb/modules/net-switch/system/bin/netswitch";
const profilesPath = "/data/adb/.config/net-switch/profiles.json";
const defaultConfigPath = "/data/adb/.config/net-switch/default.json";

let profiles = Object.create(null);
let currentProfile = "";
let snapshot = null;
let busy = false;
let isolateList = [];

async function run(cmd) {
  const { errno, stdout, stderr } = await exec(cmd);
  if (errno !== 0) throw new Error(stderr || `Command failed (${errno})`);
  if (stderr?.trim()) toast(stderr.trim());
  return stdout;
}

async function backend(...args) {
  return run(`sh ${shellQuote(backendPath)} ${args.map(shellQuote).join(" ")}`);
}

async function withBusy(action) {
  if (busy) return;
  busy = true;
  const spinner = document.getElementById("loading-spinner");
  const errorMessage = document.getElementById("operation-error");
  errorMessage.textContent = "";
  spinner?.classList.remove("hidden");
  try {
    await action();
  } catch (error) {
    errorMessage.textContent = `${getTranslation("operation_error")} ${error.message}`;
    toast(`${getTranslation("operation_error")} ${error.message}`);
    try {
      await loadApps();
      updateProfileSelect();
    } catch {
      snapshot = null;
      appsList.replaceChildren();
      document.getElementById("refresh-note").textContent = getTranslation("rule_state_unavailable");
    }
  } finally {
    busy = false;
    spinner?.classList.add("hidden");
  }
}

function confirmUidScope(apps) {
  const affected = apps.filter((app) => needsUidConsent(app, snapshot));
  if (!affected.length) return true;
  const uids = [...new Set(affected.map((app) => app.uid))];
  const details = uids.map((uid) => `UID ${uid}: ${snapshot.peers.get(uid)
    .map((app) => `${app.user}: ${app.packageName}`).join(", ")}`).join("\n");
  return window.confirm(`${getTranslation("shared_uid_confirm")}\n\n${details}`);
}

async function readDefaultConfig() {
  try {
    const out = await run(`cat ${defaultConfigPath} 2>/dev/null || true`);
    if (!out) return {};
    try {
      return JSON.parse(out.toString());
    } catch (e) {
      return { lang: out.toString().trim() };
    }
  } catch (e) {
    return {};
  }
}

async function writeDefaultConfig(cfg) {
  try {
    await run(`printf '%s\\n' ${shellQuote(JSON.stringify(cfg))} > ${defaultConfigPath}`);
  } catch (e) { }
}

async function persistDefaultKey(key, value) {
  try {
    const cfg = await readDefaultConfig();
    cfg[key] = value;
    await writeDefaultConfig(cfg);
  } catch (e) { }
}

async function loadPersistedProfile() {
  try {
    const cfg = await readDefaultConfig();
    if (cfg.currentProfile && profiles[cfg.currentProfile]) {
      currentProfile = cfg.currentProfile;

      const profileSelect = document.getElementById("profile-select");
      if (profileSelect) {
        profileSelect.value = cfg.currentProfile;
      }
    }
  } catch (e) { }
}

function sortChecked() {
  [...appsList.children]
    .sort((a, b) => Number(b.querySelector(".ns-toggle").checked) - Number(a.querySelector(".ns-toggle").checked)
      || a.dataset.key.localeCompare(b.dataset.key, undefined, { numeric: true }))
    .forEach((node) => appsList.appendChild(node));
}

function safeId(prefix, name) {
  return `${prefix}-${name.replace(/[^a-z0-9]/gi, "-")}`;
}

function updateStatus(node) {
  const app = snapshot.apps.find((item) => item.key === node.dataset.key);
  if (!app) return;
  const state = isolationState(app, snapshot);
  const blocked = state === "module_isolated" || state === "shared_isolation";
  for (const selector of [".app-status"]) {
    const el = node.querySelector(selector);
    el.removeAttribute("data-i18n");
    el.textContent = getTranslation(state);
    el.className = `${selector.slice(1)} text-xs font-medium ${blocked ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`;
  }
}

function populateApp(app) {
  const frag = document.importNode(template, true);
  const el = frag.firstElementChild;
  el.dataset.key = app.key;
  el.dataset.user = app.user;
  el.querySelector(".app-name").textContent = `${getTranslation("user_label", app.user)} · ${app.packageName}`;
  const checkbox = el.querySelector(".ns-toggle");
  checkbox.checked = snapshot.selected.has(app.key);
  checkbox.id = safeId("ns-toggle", app.key);
  checkbox.setAttribute("aria-label", `${getTranslation("isolate_instance")} ${app.user}: ${app.packageName}`);
  checkbox.disabled = app.uid === null && !checkbox.checked;
  if (app.uid && needsUidConsent(app, snapshot)) {
    const warning = document.createElement("details");
    warning.className = "mt-1 text-xs text-amber-700 dark:text-amber-300";
    const summary = document.createElement("summary");
    summary.textContent = `UID ${app.uid} · ${getTranslation("shared_uid_scope")}`;
    const peers = document.createElement("p");
    peers.className = "break-words";
    peers.textContent = snapshot.peers.get(app.uid).map((peer) => `${peer.user}: ${peer.packageName}`).join(", ");
    warning.append(summary, peers);
    if (Number(app.uid) % 100000 < 10000) {
      const systemNote = document.createElement("p");
      systemNote.textContent = getTranslation("system_uid_scope");
      warning.appendChild(systemNote);
    }
    el.appendChild(warning);
  }
  updateStatus(el);
  checkbox.addEventListener("change", () => {
    const block = checkbox.checked;
    checkbox.checked = snapshot.selected.has(app.key);
    return withBusy(async () => {
      if (block && !confirmUidScope([app])) return;
      await backend(block ? "block" : "unblock", "--user", app.user,
        ...(block && needsUidConsent(app, snapshot) ? ["--allow-shared-uid"] : []), app.packageName);
      await loadApps();
      await updateCurrentProfile();
    });
  });
  if (app.uid !== null && snapshot.apps.some((item) => item.packageName === app.packageName && item.user !== app.user && item.uid !== null)) {
    const allUsers = document.createElement("button");
    allUsers.className = "mt-2 text-xs text-blue-600 dark:text-blue-400";
    allUsers.textContent = getTranslation("block_existing_users");
    allUsers.addEventListener("click", () => withBusy(async () => {
      const instances = snapshot.apps.filter((item) => item.packageName === app.packageName && item.uid !== null);
      if (!confirmUidScope(instances)) return;
      await backend("block", "--all-users",
        ...(instances.some((item) => needsUidConsent(item, snapshot)) ? ["--allow-shared-uid"] : []), app.packageName);
      await loadApps();
      await updateCurrentProfile();
    }));
    el.appendChild(allUsers);
  }
  appsList.appendChild(el);
}

async function updateCurrentProfile() {
  if (currentProfile && profiles[currentProfile]) {
    profiles[currentProfile] = [...isolateList];
    await saveProfiles();
    updateProfileSelect();
  }
}

async function loadProfiles() {
  try {
    const profilesData = await run(`if [ -f ${profilesPath} ]; then cat ${profilesPath}; else printf "{}"; fi`);
    profiles = normalizeProfiles(profilesData ? JSON.parse(profilesData) : {});
    updateProfileSelect();
  } catch (error) {
    console.error("Failed to load profiles:", error);
  }
}

async function saveProfiles() {
  await run(`printf '%s\\n' ${shellQuote(JSON.stringify(profiles))} > ${profilesPath}.tmp && mv ${profilesPath}.tmp ${profilesPath}`);
}

function updateProfileSelect() {
  const profileSelect = document.getElementById("profile-select");
  if (!profileSelect) return;

  profileSelect.innerHTML = "";

  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.setAttribute("data-i18n", "select_profile");

  placeholderOption.textContent =
    (typeof getTranslation === "function" && getTranslation("select_profile")) ||
    "Select profile";
  profileSelect.appendChild(placeholderOption);

  Object.keys(profiles).forEach((profileName) => {
    const option = document.createElement("option");
    option.value = profileName;
    const appCount = profiles[profileName] ? profiles[profileName].length : 0;
    option.textContent = `${profileName} (${appCount})`;
    if (profileName === currentProfile) {
      option.selected = true;
    }
    profileSelect.appendChild(option);
  });
}

async function loadProfile(profileName) {
  if (!profiles[profileName]) throw new Error(getTranslation("profile_not_found", profileName));
  const entries = normalizeSelections(profiles[profileName]);
  const instances = snapshot.apps.filter((app) => entries.includes(app.key));
  if (!confirmUidScope(instances)) {
    updateProfileSelect();
    return;
  }
  await backend("replace", ...(instances.some((app) => needsUidConsent(app, snapshot)) ? ["--allow-shared-uid"] : []), JSON.stringify(entries));
  currentProfile = profileName;
  await persistDefaultKey("currentProfile", currentProfile);
  await loadApps();
  updateProfileSelect();
}

async function saveCurrentProfile(profileName) {
  profiles[profileName] = [...isolateList];
  await saveProfiles();
  currentProfile = profileName;
  updateProfileSelect();
  await persistDefaultKey("currentProfile", currentProfile);

  const successMsg = getTranslation
    ? getTranslation("profile_created", profileName, isolateList.length)
    : `🎉 Profile "${profileName}" created • ${isolateList.length} apps configured`;
  toast(successMsg, "success");
}

async function deleteProfile(profileName) {
  if (!profileName) {
    const errorMsg = getTranslation
      ? getTranslation("invalid_profile_name")
      : "Invalid profile name";
    toast(errorMsg, "error");
    return false;
  }

  try {
    delete profiles[profileName];
    await saveProfiles();

    if (currentProfile === profileName) {
      currentProfile = "";
      await persistDefaultKey("currentProfile", "");
    }

    updateProfileSelect();

    const successMsg = getTranslation
      ? getTranslation("profile_deleted", profileName)
      : `🗑️ Profile "${profileName}" deleted`;
    toast(successMsg, "success");
    return true;
  } catch (error) {
    const errorMsg = getTranslation
      ? getTranslation("operation_error")
      : "Operation error!";
    toast(`${errorMsg} ${error.message}`, "error");
    return false;
  }
}

async function loadApps() {
  snapshot = parseSnapshot(await backend("snapshot"));
  renderApps();
}

function renderApps() {
  isolateList = [...snapshot.selected];
  appsList.replaceChildren();
  for (const app of snapshot.apps) populateApp(app);
  document.getElementById("refresh-note").textContent = getTranslation(snapshot.needsRefresh ? "refresh_required" : "refresh_boundary");
  sortChecked();
  filterApps();
}

async function createProfile() {
  const nameInput = document.getElementById("new-profile-name");
  const name = nameInput?.value.trim();

  if (!name) {
    const errorMsg = getTranslation
      ? getTranslation("enter_profile_name")
      : "⚠️ Enter a name for the new profile";
    toast(errorMsg, "error");
    return;
  }

  if (profiles[name]) {
    const errorMsg = getTranslation
      ? getTranslation("profile_exists")
      : "⚠️ A profile with this name already exists";
    toast(errorMsg, "error");
    return;
  }

  await saveCurrentProfile(name);
  if (nameInput) nameInput.value = "";
}

async function connectAllApps() {
  await backend("unblock", "all");
  currentProfile = "";
  await persistDefaultKey("currentProfile", "");
  await loadApps();
  updateProfileSelect();
}

function filterApps() {
  const query = document.getElementById("search").value.toLowerCase();
  for (const node of appsList.children) {
    const matches = node.querySelector(".app-name").textContent.toLowerCase().includes(query);
    node.style.display = matches ? "" : "none";
  }
}

function setupSearch() {
  document.getElementById("search")?.addEventListener("input", filterApps);
  document.getElementById("refresh-rules")?.addEventListener("click", () => withBusy(async () => {
    await loadApps();
    if (!confirmUidScope(snapshot.apps.filter((app) => snapshot.selected.has(app.key)))) return;
    await backend("apply");
    await loadApps();
  }));
}

window.addEventListener("languagechange", () => {
  if (snapshot) renderApps();
});

function setupImportExport() {
  const openIoBtn = document.getElementById("open-io-page");
  const ioBackBtn = document.getElementById("io-back-btn");
  const ioActionBtn = document.getElementById("io-action-btn");
  const ioModeSelect = document.getElementById("io-mode-select");
  const homePage = document.getElementById("home-page");
  const ioPage = document.getElementById("io-page");

  if (
    !openIoBtn ||
    !ioBackBtn ||
    !ioActionBtn ||
    !ioModeSelect ||
    !homePage ||
    !ioPage
  )
    return;

  openIoBtn.addEventListener("click", () => {
    homePage.classList.add("hidden");
    ioPage.classList.remove("hidden");
    updateIoTexts();
  });

  ioBackBtn.addEventListener("click", () => {
    ioPage.classList.add("hidden");
    homePage.classList.remove("hidden");
  });

  ioModeSelect.addEventListener("change", updateIoTexts);

  ioActionBtn.addEventListener("click", async () => {
    const mode = ioModeSelect.value;
    const pathInput = document.getElementById("io-path-input");
    const path = pathInput?.value?.trim();

    if (!path) {
      const errorMsg = getTranslation
        ? getTranslation("invalid_path")
        : "Invalid path";
      toast(errorMsg, "error");
      return;
    }

    try {
      if (mode === "export") {
        const exportResult = await exec(`cp ${profilesPath} ${shellQuote(path)}`);
        if (exportResult.errno !== 0) {
          const errorMsg = getTranslation
            ? getTranslation("export_failed")
            : "Export failed";
          toast(`${errorMsg}: ${exportResult.stderr}`, "error");
          return;
        }
        
        await run(`chmod 644 ${shellQuote(path)} || true`);
        const successMsg = getTranslation
          ? getTranslation("export_success")
          : "Profiles exported successfully";
        toast(successMsg, "success");
      } else {
        await run(
          `if [ -f ${profilesPath} ]; then cp ${profilesPath} /data/adb/.config/net-switch/old_profiles.json; fi`,
        );
        
        const imported = normalizeProfiles(JSON.parse(await run(`cat ${shellQuote(path)}`)));
        profiles = imported;
        await saveProfiles();
        updateProfileSelect();
        const successMsg = getTranslation
          ? getTranslation("import_success")
          : "Profiles imported successfully";
        toast(successMsg, "success");
      }
    } catch (error) {
      const isExport = mode === "export";
      const errorMsg = getTranslation
        ? getTranslation(isExport ? "export_failed" : "import_failed")
        : isExport
          ? "Export failed"
          : "Import failed";
      toast(`${errorMsg}: ${error.message}`, "error");
    }
  });
}

function updateIoTexts() {
  const mode = document.getElementById("io-mode-select")?.value;
  const pathLabel = document.getElementById("io-path-label");
  const pathDesc = document.getElementById("io-desc");
  const actionBtn = document.getElementById("io-action-btn");

  if (!mode || !pathLabel || !pathDesc || !actionBtn) return;

  if (mode === "export") {
    pathLabel.textContent = getTranslation
      ? getTranslation("destination_path")
      : "Destination path";
    pathDesc.textContent = getTranslation
      ? getTranslation("export_desc")
      : "Enter destination path for export";
  } else {
    pathLabel.textContent = getTranslation
      ? getTranslation("source_path")
      : "Source path";
    pathDesc.textContent = getTranslation
      ? getTranslation("import_desc")
      : "Enter source path for import";
  }

  actionBtn.textContent = getTranslation ? getTranslation("run") : "Run";
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadProfiles();
  await withBusy(async () => {
    await loadApps();
    await loadPersistedProfile();
  });
  setupSearch();
  setupImportExport();

  const profileSelect = document.getElementById("profile-select");
  const createProfileBtn = document.getElementById("create-profile");
  const deleteProfileBtn = document.getElementById("delete-profile");

  profileSelect?.addEventListener("change", (e) => {
    if (e.target.value) {
      withBusy(() => loadProfile(e.target.value));
    } else {
      withBusy(connectAllApps);
    }
  });

  createProfileBtn?.addEventListener("click", () => withBusy(createProfile));
  deleteProfileBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const selectedProfile = document.getElementById("profile-select").value;
    const profileToDelete = selectedProfile || currentProfile;

    if (!profileToDelete) {
      const errorMsg = getTranslation
        ? getTranslation("select_profile_to_delete")
        : "⚠️ Select a profile to delete";
      toast(errorMsg, "error");
      return;
    }

    await withBusy(() => deleteProfile(profileToDelete));
  });

  const openIoBtn = document.getElementById("open-io-page");
  if (openIoBtn) {
    openIoBtn.textContent = getTranslation
      ? getTranslation("backup_manager")
      : "Backup Manager";
  }
});

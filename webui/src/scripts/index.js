import { exec, toast } from 'kernelsu';

const template = document.getElementById('app-template').content;
const appsList = document.getElementById('apps-list');

async function run(cmd) {
    const { errno, stdout, stderr } = await exec(cmd);
    if (errno !== 0) {
        toast(`stderr: ${stderr}`);
        return undefined;
    }
    return stdout;
}

function sortChecked() {
    [...appsList.children]
        .sort((a, b) => (a.querySelector('input[type="checkbox"]').checked ? -1 : 1))
        .forEach((node) => appsList.appendChild(node));
}

const isolateList = [];

function populateApp(name, checked) {
    const node = document.importNode(template, true);
    const nameElement = node.querySelector('p');
    nameElement.textContent = name;

    const checkbox = node.querySelector('input[type="checkbox"]');
    checkbox.checked = checked;

    if (checked) isolateList.push(name);

    checkbox.addEventListener('change', async () => {
        const { stdout: appUid } = await exec(`grep "^${name}" /data/system/packages.list | awk '{print $2; exit}'`);

        if (!appUid || isNaN(appUid)) {
            toast(`Unable to fetch UID of ${name}.`);
            await saveIsolateList();
            return;
        }

        if (checkbox.checked) {
            isolateList.push(name);
            await run(`iptables -I OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
            await run(`ip6tables -I OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
        } else {
            const index = isolateList.indexOf(name);
            if (index !== -1) isolateList.splice(index, 1);
            await run(`iptables -D OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
            await run(`ip6tables -D OUTPUT -m owner --uid-owner ${appUid} -j REJECT`);
        }

        await saveIsolateList();
    });

    appsList.appendChild(node);
}

async function saveIsolateList() {
    await run(`echo '${JSON.stringify(isolateList)}' >/data/adb/net-switch/isolated.json`);
}

async function main() {
    // Fetch all installed packages
    const pkgs = await run("pm list packages");
    if (pkgs === undefined) return;

    // Fetch isolated apps list
    const isolatedListOut = await run("cat /data/adb/net-switch/isolated.json");
    let isolated = isolatedListOut ? JSON.parse(isolatedListOut) : [];

    // Clean up uninstalled apps from isolated.json
    const installedPackages = new Set(pkgs.split('\n').map((line) => line.split(':')[1]).filter(Boolean));
    const updatedIsolatedList = isolated.filter((app) => installedPackages.has(app));

    if (isolated.length !== updatedIsolatedList.length) {
        await run(`echo '${JSON.stringify(updatedIsolatedList)}' >/data/adb/net-switch/isolated.json`);
        isolated = updatedIsolatedList; // Update the isolated list for the rest of the function
    }

    // Populate the app list
    for (const pkg of installedPackages) {
        const isIsolated = isolated.includes(pkg);
        populateApp(pkg, isIsolated);
    }

    sortChecked();

    // Add search functionality
    document.getElementById("search").addEventListener('input', (e) => {
        const searchVal = e.target.value.toLowerCase();
        [...appsList.children].forEach((node) => {
            const appName = node.querySelector('p').textContent.toLowerCase();
            node.style.display = appName.includes(searchVal) ? '' : 'none';
        });
    });
}

main();

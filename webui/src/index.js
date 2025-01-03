import { exec, toast } from 'kernelsu';

const template = document.getElementById('app-template').content;
const appsList = document.getElementById('apps-list');

async function run(cmd) {
	const { errno, stdout, stderr } = await exec(cmd);
	if (errno != 0) {
		toast(`stderr: ${stderr}`);
		return undefined;
	} else {
		return stdout;
	}
}

function sortChecked() {
	[...appsList.children]
		.sort((a, _b) => a.querySelector('input[type="checkbox"]').checked ? -1 : 1)
		.forEach((node) => appsList.appendChild(node));
}

const isolate_list = [];

function populateApp(name, checked) {
	const node = document.importNode(template, true);
	const nameElement = node.querySelector('p');
	nameElement.textContent = name;

	const checkbox = node.querySelector('input[type="checkbox"]');
	checkbox.checked = checked;

	if (checked) isolate_list.push(name);

	checkbox.addEventListener('change', async () => {
		const app_uid = await run(`dumpsys package ${name} 2>/dev/null | awk -F'=' '/userId=/ {print $2; exit}'`);

		// Save updated isolate_list to isolated.json
		await run(`echo '${JSON.stringify(isolate_list)}' >/data/adb/net-switch/isolated.json`);

		// Handle empty UID
		if (typeof app_uid === "number" && !isNaN(app_uid)) {
            toast("Something is wrong, please reboot to take affect.");
            return;
        }

		if (checkbox.checked) {
			isolate_list.push(name);
			await run(`iptables -I OUTPUT -m owner --uid-owner ${app_uid} -j REJECT`);
			await run(`ip6tables -I OUTPUT -m owner --uid-owner ${app_uid} -j REJECT`);
		} else {
			const index = isolate_list.indexOf(name);
			if (index !== -1) isolate_list.splice(index, 1);
			await run(`iptables -D OUTPUT -m owner --uid-owner ${app_uid} -j REJECT`);
			await run(`ip6tables -D OUTPUT -m owner --uid-owner ${app_uid} -j REJECT`);
		}
	});

	appsList.appendChild(node);
}

async function main() {
	// Fetch all packages
	const pkgs = await run("pm list packages");
	if (pkgs === undefined) return;

	// Fetch isolated apps list
	const isolatedListOut = await run("cat /data/adb/net-switch/isolated.json");
	const isolated = isolatedListOut ? JSON.parse(isolatedListOut) : [];
	const uninstalled = [...isolated];

	// Populate the app list
	for (const pkg of pkgs.split('\n').map((line) => line.split(':')[1])) {
		if (!pkg) continue;
		const isIsolated = isolated.includes(pkg);
		populateApp(pkg, isIsolated);

		// Remove installed apps from uninstalled list
		if (isIsolated) {
			const index = uninstalled.indexOf(pkg);
			if (index > -1) uninstalled.splice(index, 1);
		}
	}

	// Add uninstalled apps to the list
	for (const pkg of uninstalled) populateApp(pkg, true);

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

await main();

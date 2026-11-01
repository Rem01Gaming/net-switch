"""Synthetic PackageManager and filter-table model; never invokes a firewall."""
import json
import os
from pathlib import Path
import sys

path = Path(os.environ["NETSWITCH_TEST_STATE"])
state = json.loads(path.read_text(encoding="utf-8"))
tool, *args = sys.argv[1:]
state.setdefault("calls", []).append([tool, *args])


def finish(code=0, output=""):
    path.write_text(json.dumps(state), encoding="utf-8")
    if output:
        print(output)
    sys.exit(code)


for failure in state.get("failures", []):
    if failure["tool"] == tool and all(word in args for word in failure["args"]):
        if failure.get("remaining", 1):
            if failure.get("remaining", 1) > 0:
                failure["remaining"] = failure.get("remaining", 1) - 1
            finish(1, "synthetic command failure")

if tool == "pm":
    if args == ["list", "users"]:
        finish(output=state.get("users_output", "Users:\n" + "\n".join(
            "\tUserInfo{%s:%s:%s}%s" % (u["id"], u["name"], u["flags"],
                                        " running" if u["running"] else "")
            for u in state["users"])))
    if args[:4] == ["list", "packages", "-U", "--user"]:
        user = args[4]
        if user in state.get("package_stderr", {}):
            print(state["package_stderr"][user], file=sys.stderr)
        finish(output=state.get("package_output", {}).get(user, "\n".join(
            f"package:{package} uid:{uid}" for package, uid in state["packages"].get(user, {}).items())))
    finish(1)

if tool not in ("iptables", "ip6tables") or args[:2] != ["-w", "5"]:
    finish(1)
args = args[2:]
chains = state[tool]
command = args[0]
if command == "-S":
    lines = ["-P OUTPUT ACCEPT"]
    lines += [f"-N {chain}" for chain in chains if chain != "OUTPUT"]
    for chain, rules in chains.items():
        lines += [" ".join(["-A", chain, *rule]) for rule in rules]
    finish(output="\n".join(lines))
chain = args[1]
if command == "-N":
    if chain in chains:
        finish(1)
    chains[chain] = []
elif command == "-X":
    if chain not in chains or chains[chain] or any(
        rule[-2:] == ["-j", chain] for rules in chains.values() for rule in rules
    ):
        finish(1)
    del chains[chain]
elif command in ("-A", "-I", "-D"):
    if chain not in chains:
        finish(1)
    rule = args[3:] if command == "-I" else args[2:]
    if command == "-A":
        chains[chain].append(rule)
    elif command == "-I":
        chains[chain].insert(int(args[2]) - 1, rule)
    else:
        # iptables accepts an omitted default --reject-with on exact deletion.
        match = next((r for r in chains[chain] if r == rule or
                      r == rule + ["--reject-with", "icmp-port-unreachable"] or
                      r == rule + ["--reject-with", "icmp6-port-unreachable"]), None)
        if match is None:
            finish(1)
        chains[chain].remove(match)
else:
    raise AssertionError(f"Unexpected firewall operation: {args}")
finish()

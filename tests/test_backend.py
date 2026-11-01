"""Run the actual POSIX-shell backend against synthetic Android/firewall commands.

python -m unittest discover -s tests -v
On Windows set NETSWITCH_TEST_SHELL to a POSIX sh (e.g. Git for Windows).
"""
import copy
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "module/system/bin/netswitch"
MOCK = ROOT / "tests/mock_android.py"
SHELL = os.environ.get("NETSWITCH_TEST_SHELL", shutil.which("sh"))


def fixture():
    packages = {}
    for user in (0, 10, 12, 999):
        # Values are explicit query responses, not calculated by the backend.
        uid = {0: 10123, 10: 1010123, 12: 1210123, 999: 99910123}[user]
        packages[str(user)] = {"com.example.alpha": uid}
    packages["0"].update({"com.example.alpha.overlay": 10444,
                          "com.example.peer": 10123,
                          "com.example.system": 1000, "com.example.service": 1000})
    packages["10"].update({"com.example.work": 1010456, "com.example.system": 1001000})
    other = {"OUTPUT": [["-j", "OTHER_FIREWALL"],
                        ["-m", "owner", "--uid-owner", "10123", "-j", "REJECT"]],
             "OTHER_FIREWALL": [["-j", "RETURN"]]}
    return {"users": [
        {"id": 0, "name": "Owner", "flags": "c13", "running": True},
        {"id": 10, "name": "Work", "flags": "a0", "running": False},
        {"id": 12, "name": "Secondary", "flags": "400", "running": False},
        {"id": 999, "name": "Clone", "flags": "20000000", "running": True}],
        "packages": packages, "iptables": copy.deepcopy(other), "ip6tables": copy.deepcopy(other)}


class BackendTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="netswitch-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.backend = self.root / "netswitch"
        self.backend.write_bytes(BACKEND.read_bytes())
        self.config_dir = self.root / "config"
        self.config_dir.mkdir()
        self.config = self.config_dir / "isolated.json"
        self.config.write_text("[]", encoding="utf-8")
        self.legacy = self.root / "legacy.json"
        self.state_path = self.root / "state.json"
        self.save(fixture())
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        for tool in ("pm", "iptables", "ip6tables"):
            wrapper = bin_dir / tool
            wrapper.write_text("#!/bin/sh\nexec '%s' '%s' '%s' \"$@\"\n" %
                               (Path(sys.executable).as_posix(), MOCK.as_posix(), tool), encoding="utf-8")
            wrapper.chmod(0o755)
        self.env = dict(os.environ, NETSWITCH_CONFIG_DIR=self.config_dir.as_posix(),
                        NETSWITCH_LOCK_DIR=(self.root / "lock").as_posix(),
                        NETSWITCH_LEGACY_CONFIG=self.legacy.as_posix(),
                        NETSWITCH_TEST_STATE=self.state_path.as_posix(),
                        PATH=str(bin_dir) + os.pathsep + os.environ["PATH"])

    def load(self):
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def save(self, state):
        self.state_path.write_text(json.dumps(state), encoding="utf-8")

    def run_cli(self, *args, code=0):
        # A script also avoids MSYS/Win32 argument conversion of JSON quotes.
        runner = self.root / "run.sh"
        bin_path = (self.root / "bin").as_posix()
        if len(bin_path) > 1 and bin_path[1] == ":":
            bin_path = "/" + bin_path[0].lower() + bin_path[2:]
        runner.write_text(
            "export PATH=" + shlex.quote(bin_path) + ":\"$PATH\"\n"
            + "set -- " + shlex.join(args) + "\n"
            + ". " + shlex.quote(self.backend.as_posix()) + "\n", encoding="utf-8")
        result = subprocess.run([SHELL, runner.as_posix()], env=self.env,
                                capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        return result

    def uids(self, family="iptables"):
        return [int(rule[3]) for rule in self.load()[family].get("NETSWITCH", [])]

    def mutate(self, callback):
        state = self.load()
        callback(state)
        self.save(state)

    def prepare_legacy(self, entries):
        self.legacy.write_text(json.dumps(entries), encoding="utf-8")
        self.config.write_bytes(b"")

    def test_legacy_migration_filters_scope_and_shared_uids(self):
        self.prepare_legacy(["com.example.alpha.overlay", "com.example.alpha",
                             "com.example.system", "com.example.missing",
                             "com.example.work", "12:com.example.alpha"])
        before = self.legacy.read_bytes()
        self.mutate(lambda s: s["packages"]["12"].update({"com.example.alpha.overlay": 1210444}))
        self.run_cli("apply")  # Boot uses this entry point.
        self.assertEqual(json.loads(self.config.read_text()), ["com.example.alpha.overlay"])
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.uids(family), [10444])
            self.assertEqual(self.load()[family]["OTHER_FIREWALL"], fixture()[family]["OTHER_FIREWALL"])
            for rule in fixture()[family]["OUTPUT"]:
                self.assertIn(rule, self.load()[family]["OUTPUT"])
        report = self.run_cli("snapshot").stdout
        for reason, package, uid in (("imported", "alpha.overlay", "10444"),
                                     ("shared", "alpha", "10123"),
                                     ("system", "system", "1000"),
                                     ("missing", "missing", "-"), ("missing", "work", "-")):
            self.assertIn(f"migration\t{reason}\tcom.example.{package}\t{uid}\n", report)
        self.assertIn("migration\tscope\t12:com.example.alpha\t-\n", report)
        self.assertEqual(self.legacy.read_bytes(), before)
        self.run_cli("unblock", "all")
        self.run_cli("migrate")
        self.run_cli("apply")
        self.assertEqual(json.loads(self.config.read_text()), [])
        self.assertEqual(self.uids(), [])

    def test_migration_preserves_existing_configs_without_queries(self):
        self.legacy.write_text('["com.example.alpha.overlay"]')
        for data in ("[]", '["10:com.example.work"]', '["com.example.system"]'):
            self.config.write_text(data)
            self.run_cli("migrate")
            self.assertEqual(self.config.read_text(), data)
        self.assertEqual(self.load().get("calls", []), [])
        self.assertFalse((self.config_dir / "migration.tsv").exists())

    def test_migration_with_missing_new_config_and_no_eligible_entries(self):
        self.prepare_legacy(["com.example.system", "com.example.alpha"])
        self.config.unlink()
        self.run_cli("migrate")
        self.assertEqual(json.loads(self.config.read_text()), [])
        self.assertEqual(self.uids(), [])
        self.assertEqual(len((self.config_dir / "migration.tsv").read_text().splitlines()), 2)

    def test_migration_query_or_parse_failure_can_be_retried(self):
        self.prepare_legacy(["com.example.alpha.overlay"])
        before = self.load()
        self.mutate(lambda s: s.update(failures=[{"tool": "pm", "args": ["packages", "12"]}]))
        self.run_cli("migrate", code=1)
        self.legacy.write_text('["com.example.alpha.overlay",]')
        self.run_cli("migrate", code=1)
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.load()[family], before[family])
        self.assertEqual(self.config.read_bytes(), b"")
        self.assertFalse((self.config_dir / "migration.tsv").exists())
        self.legacy.write_text('["com.example.alpha.overlay"]')
        self.run_cli("migrate")
        self.assertEqual(self.uids(), [10444])

    def test_migration_ipv6_failure_rolls_back_and_retries(self):
        self.prepare_legacy(["com.example.alpha.overlay"])
        before = self.load()
        self.mutate(lambda s: s.update(failures=[{"tool": "ip6tables", "args": ["-A"]}]))
        self.run_cli("migrate", code=1)
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.load()[family], before[family])
        self.assertEqual(self.config.read_bytes(), b"")
        self.assertFalse((self.config_dir / "migration.tsv").exists())
        self.run_cli("migrate")
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.uids(family), [10444])

    def test_migration_commit_failure_removes_report_and_restores_rules(self):
        self.prepare_legacy(["com.example.alpha.overlay"])
        before = self.load()
        # Allow the report commit, then fail the configuration commit.
        wrapper = self.root / "bin/mv"
        wrapper.write_text('#!/bin/sh\ncase "$2" in *.isolated.next) exit 1;; esac\n'
                           'exec /usr/bin/mv "$@"\n', encoding="utf-8")
        wrapper.chmod(0o755)
        self.run_cli("migrate", code=1)
        self.assertFalse((self.config_dir / "migration.tsv").exists())
        self.assertEqual(self.config.read_bytes(), b"")
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.load()[family], before[family])

    def test_migration_report_failure_leaves_rules_unchanged(self):
        self.prepare_legacy(["com.example.alpha.overlay"])
        (self.config_dir / "migration.tsv").mkdir()
        before = self.load()
        self.run_cli("migrate", code=1)
        self.assertEqual(self.config.read_bytes(), b"")
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.load()[family], before[family])

    def test_default_and_scoped_instances(self):
        self.run_cli("block", "--user", "10", "com.example.alpha")
        self.assertEqual(self.uids(), [1010123])

        self.assertEqual(json.loads(self.config.read_text()), ["10:com.example.alpha"])
        self.run_cli("block", "--allow-shared-uid", "com.example.alpha")
        self.assertEqual(set(self.uids()), {10123, 1010123})
        self.run_cli("unblock", "--user", "10", "com.example.alpha")
        self.assertEqual(self.uids(), [10123])

    def test_android_pm_does_not_receive_private_file_descriptors(self):
        self.mutate(lambda state: state.update(reject_file_descriptors=True))
        result = self.run_cli("snapshot")
        self.assertIn("app\t10\tcom.example.alpha\t1010123", result.stdout)
        self.run_cli("block", "--user", "12", "com.example.alpha")
        self.assertEqual(self.uids(), [1210123])

    def test_all_users_including_stopped_and_partial_install(self):
        self.run_cli("block", "--all-users", "--allow-shared-uid", "com.example.alpha", "com.example.work")
        self.assertEqual(set(self.uids()), {10123, 1010123, 1210123, 99910123, 1010456})
        self.assertEqual(set(self.uids()), set(self.uids("ip6tables")))
        result = self.run_cli("snapshot")
        self.assertIn("user\t10\tWork\tnot-running", result.stdout)
        self.run_cli("unblock", "--all-users", "com.example.alpha")
        self.assertEqual(self.uids(), [1010456])

    def test_exact_package_and_no_prefix_match(self):
        self.run_cli("block", "com.example.alpha.overlay")
        self.assertEqual(self.uids(), [10444])
        self.run_cli("block", "com.example.alph", code=1)
        self.assertEqual(self.uids(), [10444])

    def test_shared_uid_requires_consent_and_survives_one_uncheck(self):
        result = self.run_cli("block", "com.example.alpha", code=1)
        self.assertIn("com.example.peer", result.stderr)
        self.assertEqual(self.uids(), [])
        self.run_cli("block", "--allow-shared-uid", "com.example.alpha", "com.example.peer")
        self.run_cli("unblock", "com.example.alpha")
        self.assertEqual(self.uids(), [10123])
        self.run_cli("unblock", "com.example.peer")
        self.assertEqual(self.uids(), [])

    def test_system_uid_all_users_is_explicit(self):
        self.run_cli("block", "--all-users", "com.example.system", code=1)
        result = self.run_cli("block", "--all-users", "--allow-shared-uid", "com.example.system")
        self.assertIn("services beyond", result.stderr)
        self.assertEqual(set(self.uids()), {1000, 1001000})

    def test_repeated_apply_is_read_only_for_firewall(self):
        self.run_cli("block", "--user", "10", "com.example.alpha")
        self.mutate(lambda s: s.update(calls=[]))
        self.run_cli("apply")
        mutations = [c for c in self.load()["calls"] if c[0] != "pm" and c[3] != "-S"]
        self.assertEqual(mutations, [])

    def test_uid_change_uninstall_and_reinstall(self):
        self.run_cli("block", "--user", "10", "com.example.alpha")
        self.mutate(lambda s: s["packages"]["10"].update({"com.example.alpha": 1010789}))
        self.run_cli("apply")
        self.assertEqual(self.uids(), [1010789])
        self.mutate(lambda s: s["packages"]["10"].pop("com.example.alpha"))
        self.run_cli("apply")
        self.assertEqual(self.uids(), [])
        self.assertIn("10:com.example.alpha", self.config.read_text())
        self.mutate(lambda s: s["packages"]["10"].update({"com.example.alpha": 1010678}))
        self.run_cli("apply")
        self.assertEqual(self.uids(), [1010678])

    def test_user_removal_and_new_user_not_automatically_selected(self):
        self.run_cli("block", "--all-users", "--allow-shared-uid", "com.example.alpha")
        self.mutate(lambda s: s["users"].pop(2))
        self.run_cli("apply")
        self.assertNotIn(1210123, self.uids())
        self.mutate(lambda s: (s["users"].append({"id": 15, "name": "New", "flags": "400", "running": True}),
                               s["packages"].update({"15": {"com.example.alpha": 1510123}})))
        self.run_cli("apply")
        self.assertNotIn(1510123, self.uids())

    def test_query_failure_preserves_config_and_rules(self):
        self.run_cli("block", "--user", "10", "com.example.alpha")
        before = self.config.read_bytes()
        self.mutate(lambda s: s.update(failures=[{"tool": "pm", "args": ["packages", "12"]}]))
        self.run_cli("unblock", "--user", "10", "com.example.alpha", code=1)
        self.assertEqual(self.config.read_bytes(), before)
        self.assertEqual(self.uids(), [1010123])

    def test_malformed_queries_are_not_treated_as_empty(self):
        for field, value in (("users_output", "Error: unavailable"),
                             ("package_output", {"10": "package:com.example.alpha"}),
                             ("package_output", {"10": ""})):
            with self.subTest(field=field):
                self.save(dict(fixture(), **{field: value}))
                self.run_cli("apply", code=1)
                self.assertEqual(self.uids(), [])

    def test_success_exit_with_package_error_preserves_rules(self):
        self.run_cli("block", "--user", "10", "com.example.alpha")
        self.mutate(lambda s: s.update(package_stderr={"10": "Error: user unavailable"}))
        self.run_cli("apply", code=1)
        self.assertEqual(self.uids(), [1010123])

    def test_ipv6_failure_rolls_back_ipv4_and_config(self):
        self.run_cli("block", "--user", "10", "com.example.alpha")
        before = self.load()
        self.mutate(lambda s: s.update(failures=[{"tool": "ip6tables", "args": ["-A"]}]))
        self.run_cli("block", "--user", "10", "com.example.work", code=1)
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.load()[family], before[family])
        self.assertEqual(json.loads(self.config.read_text()), ["10:com.example.alpha"])

    def test_first_apply_failure_removes_only_new_module_rules(self):
        before = self.load()
        self.mutate(lambda s: s.update(failures=[{"tool": "ip6tables", "args": ["-I"]}]))
        self.run_cli("block", "--user", "10", "com.example.alpha", code=1)
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.load()[family], before[family])

    def test_rollback_failure_is_reported(self):
        self.mutate(lambda s: s.update(failures=[{"tool": "ip6tables", "args": ["-A"]},
                                                {"tool": "iptables", "args": ["-D"], "remaining": -1}]))
        result = self.run_cli("block", "--user", "10", "com.example.alpha", code=2)
        self.assertIn("ROLLBACK INCOMPLETE", result.stderr)
        self.assertEqual(self.config.read_text(), "[]")

    def test_clear_works_without_package_manager_and_preserves_others(self):
        original = self.load()
        self.run_cli("block", "--user", "10", "com.example.alpha")
        before = self.config.read_bytes()
        self.mutate(lambda s: s.update(failures=[{"tool": "pm", "args": [], "remaining": -1}]))
        self.run_cli("clear")
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.load()[family], original[family])
        self.assertEqual(self.config.read_bytes(), before)
        self.run_cli("unblock", "all")
        self.assertEqual(json.loads(self.config.read_text()), [])
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.load()[family], original[family])

    def test_duplicate_owned_rules_and_hooks_are_deduplicated(self):
        self.run_cli("block", "--user", "10", "com.example.alpha")
        state = self.load()
        for family in ("iptables", "ip6tables"):
            state[family]["NETSWITCH"] *= 2
            state[family]["OUTPUT"].insert(0, list(state[family]["OUTPUT"][0]))
        self.save(state)
        self.run_cli("apply")
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.uids(family), [1010123])
            self.assertEqual(sum(r[-1] == "NETSWITCH" for r in self.load()[family]["OUTPUT"]), 1)

    def test_failed_config_commit_rolls_back_firewall(self):
        self.run_cli("block", "--user", "10", "com.example.alpha")
        before = self.load()
        wrapper = self.root / "bin/mv"
        wrapper.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
        wrapper.chmod(0o755)
        self.run_cli("block", "--user", "10", "com.example.work", code=1)
        for family in ("iptables", "ip6tables"):
            self.assertEqual(self.load()[family], before[family])
        self.assertEqual(json.loads(self.config.read_text()), ["10:com.example.alpha"])

    def test_list_reports_scoped_and_missing_selections(self):
        self.config.write_text('["10:com.example.alpha","12:com.example.missing"]')
        result = self.run_cli("list")
        self.assertIn("user 10: com.example.alpha (UID 1010123; IPv4 not applied", result.stdout)
        self.assertIn("user 12: com.example.missing (not installed", result.stdout)

    def test_legacy_config_profiles_and_invalid_input(self):
        self.config.write_text('["com.example.alpha.overlay"]')
        self.run_cli("apply")
        self.assertEqual(self.uids(), [10444])
        self.run_cli("replace", '["0:com.example.alpha.overlay","10:com.example.work"]')
        self.assertEqual(set(self.uids()), {10444, 1010456})
        before = self.config.read_bytes()
        for data in ('["com.example. alpha"]', '["10:com.example.work",]', '["01:com.example.work"]', '{}'):
            self.run_cli("replace", data, code=1)
            self.assertEqual(self.config.read_bytes(), before)

    def test_lock_excludes_concurrent_writer(self):
        (self.root / "lock").mkdir()
        self.run_cli("apply", code=1)
        self.assertEqual(self.load().get("calls", []), [])

    def test_firewall_query_failure_before_mutation(self):
        self.mutate(lambda s: s.update(failures=[{"tool": "ip6tables", "args": ["-S"]}]))
        self.run_cli("block", "--user", "10", "com.example.work", code=1)
        self.assertEqual(self.uids(), [])

    def test_unknown_module_chain_rules_are_not_destroyed(self):
        self.mutate(lambda s: s["iptables"].update(NETSWITCH=[["-j", "ACCEPT"]]))
        self.run_cli("apply", code=1)
        self.assertEqual(self.load()["iptables"]["NETSWITCH"], [["-j", "ACCEPT"]])


if __name__ == "__main__":
    unittest.main()

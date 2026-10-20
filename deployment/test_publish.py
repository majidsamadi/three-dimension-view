"""publish.py with fake gh/aws and fake HTTPS (wave 3 plan §6.3.3). No network, no AWS.

Run: python3 -m unittest discover -s deployment -p 'test_*.py'
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from publish import ACCOUNT, Completed, Fetched, Publication  # noqa: E402

HERE = Path(__file__).resolve().parent
SITE = json.loads((HERE / "site.json").read_text(encoding="utf-8"))
ACTIVATION = json.loads((HERE / "activation.json").read_text(encoding="utf-8"))
SHA = "89abcdef0123456789abcdef0123456789abcdef"
SESSION = "arn:aws:sts::511831442607:assumed-role/wisestay-web-home-scanner-publisher/home-scanner-publish-1"
INDEX = b"<!doctype html><title>Home Scanner</title>"


class FakeCli:
    def __init__(self):
        self.calls: list[list[str]] = []
        self.main_sha = [SHA, SHA]
        self.caller = {"Account": ACCOUNT, "Arn": SESSION}
        self.parameter = {"repository": SITE["repository"], "origin": SITE["origin"], "bucket": SITE["bucket"],
                          "distribution_id": "E1HSDEV00001", "account": ACCOUNT, "region": "ap-southeast-1"}
        self.aliases = ["home-scanner.wizestay.com"]
        self.denied_on: str | None = None

    def __call__(self, argv: list[str], *, timeout: int = 0) -> Completed:  # noqa: ARG002
        self.calls.append(list(argv))
        if argv[0] == "gh":
            return Completed(0, self.main_sha.pop(0) + "\n", "")
        command = argv[1:3]
        if self.denied_on and command == self.denied_on.split():
            return Completed(1, "", "An error occurred (AccessDenied) when calling the PutObject operation: User: "
                                    f"{SESSION} is not authorized to perform: s3:PutObject on resource: hidden-detail")
        if command == ["sts", "get-caller-identity"]:
            return Completed(0, json.dumps(self.caller), "")
        if command == ["ssm", "get-parameter"]:
            return Completed(0, json.dumps(self.parameter) + "\n", "")
        if command == ["cloudfront", "get-distribution"]:
            return Completed(0, json.dumps({"Distribution": {"DistributionConfig": {
                "Aliases": {"Items": self.aliases},
                "Origins": {"Items": [{"DomainName": f"{SITE['bucket']}.s3.ap-southeast-1.amazonaws.com"},
                                      {"DomainName": "0av793v9ee.execute-api.ap-southeast-1.amazonaws.com"}]}}}}), "")
        if command == ["cloudfront", "create-invalidation"]:
            return Completed(0, json.dumps({"Invalidation": {"Id": "I123"}}), "")
        if command in (["s3", "sync"], ["s3", "cp"], ["cloudfront", "wait"]):
            return Completed(0, "", "")
        raise AssertionError(argv)


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.dist = root / "dist"
        (self.dist / "assets").mkdir(parents=True)
        (self.dist / "index.html").write_bytes(INDEX)
        (self.dist / "sw.js").write_bytes(b"self.addEventListener('install',()=>{})")
        (self.dist / "assets" / "index-abc.js").write_bytes(b"console.log('synthetic')")
        files = {path.relative_to(self.dist).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in sorted(self.dist.rglob("*")) if path.is_file()}
        self.release = {"repository": SITE["repository"], "origin": SITE["origin"], "revision": SHA, "files": files}
        (self.dist / "release.json").write_text(json.dumps(self.release), encoding="utf-8")
        self.activation = root / "activation.json"
        self.activation.write_text(json.dumps(ACTIVATION), encoding="utf-8")
        self.cli = FakeCli()
        self.env = {"GITHUB_REPOSITORY": SITE["repository"], "GITHUB_REF": "refs/heads/main", "GITHUB_SHA": SHA,
                    "GITHUB_RUN_ID": "91", "GITHUB_RUN_ATTEMPT": "1"}
        self.readiness = Fetched(200, "application/json", json.dumps({"contract": "wisestay.web-session.v1",
                                                                      "ready": True}).encode())
        self.missing = Fetched(404, "application/xml", b"")
        self.requests: list[tuple[str, dict]] = []

    def http(self, url: str, headers):
        self.requests.append((url, dict(headers)))
        origin = SITE["origin"]
        if url == origin + "/release.json":
            return Fetched(200, "application/json", json.dumps(self.release).encode())
        if url == origin + "/":
            return Fetched(200, "text/html", INDEX)
        if url == origin + "/api/v1/web-session/home-scanner/readiness":
            return self.readiness
        if url == origin + "/assets/missing.js":
            return self.missing
        raise AssertionError(url)

    def publish(self) -> tuple[int, dict]:
        receipt = self.dist / "deployment-receipt.json"
        with contextlib.redirect_stdout(io.StringIO()):
            code = Publication(site=SITE, activation_path=self.activation, dist=self.dist, receipt_path=receipt,
                               env=self.env, run=self.cli, http=self.http, sleep=lambda _s: None).main()
        return code, json.loads(receipt.read_text(encoding="utf-8"))

    def uploads(self) -> list[list[str]]:
        return [call for call in self.cli.calls if call[1:3] in (["s3", "sync"], ["s3", "cp"])]

    def test_happy_path_publishes_and_verifies_live(self):
        code, receipt = self.publish()
        self.assertEqual(code, 0)
        self.assertEqual(receipt["result"], "deployed")
        self.assertEqual(receipt["distribution_id"], "E1HSDEV00001")
        self.assertEqual(receipt["caller_arn"], SESSION)
        self.assertEqual(receipt["file_count"], 3)
        self.assertEqual(receipt["smoke"]["result"], "passed")
        self.assertEqual(set(receipt["smoke"]["checks"].values()), {"passed"})
        sync = next(call for call in self.cli.calls if call[1:3] == ["s3", "sync"])
        self.assertNotIn("--delete", sync)
        for name in ("index.html", "release.json", "sw.js"):
            self.assertIn(name, sync[sync.index("--exclude") + 1:])
        entries = [call[4].rsplit("/", 1)[1] for call in self.cli.calls if call[1:3] == ["s3", "cp"]]
        self.assertEqual(entries[-1], "release.json")
        self.assertIn("index.html", entries)
        self.assertNotIn("manifest.webmanifest", entries, "absent files are not uploaded")
        readiness = next(headers for url, headers in self.requests if url.endswith("/readiness"))
        self.assertEqual(readiness["X-WiseStay-Web-Session"], "wisestay.web-session.v1")

    def test_activation_disabled_is_held_without_any_call(self):
        self.activation.write_text(json.dumps({**ACTIVATION, "enabled": False}), encoding="utf-8")
        code, receipt = self.publish()
        self.assertEqual((code, receipt["result"], receipt["failure"]["label"]), (0, "held", "ACTIVATION_DISABLED"))
        self.assertEqual(self.cli.calls, [])

    def test_wrong_role_refused_before_any_upload(self):
        self.cli.caller = {"Account": ACCOUNT, "Arn": "arn:aws:sts::511831442607:assumed-role/wisestay-web-ota-publisher/x"}
        code, receipt = self.publish()
        self.assertEqual((code, receipt["failure"]["label"]), (1, "WRONG_PUBLISHER_ROLE"))
        self.assertEqual(self.uploads(), [])

    def test_wrong_account_refused(self):
        self.cli.caller = {"Account": "443217925086", "Arn": "arn:aws:sts::443217925086:assumed-role/x/y"}
        code, receipt = self.publish()
        self.assertEqual((code, receipt["failure"]["label"]), (1, "WRONG_ACCOUNT"))
        self.assertEqual(self.uploads(), [])

    def test_hash_mismatch_refused(self):
        (self.dist / "assets" / "index-abc.js").write_bytes(b"changed after verification")
        code, receipt = self.publish()
        self.assertEqual((code, receipt["failure"]["label"]), (1, "BUILD_CHANGED_AFTER_VERIFICATION"))
        self.assertEqual(self.uploads(), [])

    def test_superseded_main_refused(self):
        self.cli.main_sha = ["0" * 40]
        code, receipt = self.publish()
        self.assertEqual((code, receipt["failure"]["label"]), (1, "SUPERSEDED_MAIN"))
        self.assertFalse([call for call in self.cli.calls if call[0] == "aws"])

    def test_main_superseded_during_sync_keeps_old_entry_files(self):
        self.cli.main_sha = [SHA, "1" * 40]
        code, receipt = self.publish()
        self.assertEqual((code, receipt["failure"]["label"]), (1, "SUPERSEDED_MAIN"))
        self.assertFalse([call for call in self.cli.calls if call[1:3] == ["s3", "cp"]])

    def test_spa_html_on_readiness_route_fails(self):
        self.readiness = Fetched(200, "text/html", INDEX)
        code, receipt = self.publish()
        self.assertEqual((code, receipt["result"], receipt["failure"]["label"]), (1, "failed", "SESSION_ROUTE_NOT_JSON"))
        self.assertEqual(receipt["smoke"]["checks"]["session_readiness"], "failed:200:text/html")

    def test_missing_asset_served_as_html_fails(self):
        self.missing = Fetched(200, "text/html", INDEX)
        code, receipt = self.publish()
        self.assertEqual((code, receipt["failure"]["label"]), (1, "MISSING_ASSET_NOT_REJECTED"))

    def test_foreign_distribution_alias_refused(self):
        self.cli.aliases = ["ota.wizestay.com"]
        code, receipt = self.publish()
        self.assertEqual((code, receipt["failure"]["label"]), (1, "DISTRIBUTION_ALIAS_MISMATCH"))
        self.assertEqual(self.uploads(), [])

    def test_publication_parameter_for_another_bucket_refused(self):
        self.cli.parameter["bucket"] = "wisestay-web-ota-511831442607"
        code, receipt = self.publish()
        self.assertEqual((code, receipt["failure"]["label"]), (1, "PUBLICATION_PARAMETER_MISMATCH"))

    def test_release_for_other_revision_refused(self):
        self.release["revision"] = "local"
        (self.dist / "release.json").write_text(json.dumps(self.release), encoding="utf-8")
        code, receipt = self.publish()
        self.assertEqual((code, receipt["failure"]["label"]), (1, "RELEASE_MANIFEST_MISMATCH"))

    def test_access_denied_reports_label_and_action_only(self):
        self.cli.denied_on = "s3 sync"
        code, receipt = self.publish()
        self.assertEqual(receipt["failure"], {"label": "ASSET_SYNC_FAILED", "denied_actions": ["s3:PutObject"]})
        self.assertNotIn("hidden-detail", json.dumps(receipt))
        self.assertEqual(code, 1)

    def test_committed_site_configuration_matches_the_contract(self):
        self.assertEqual(SITE["publisher_role_arn"], "arn:aws:iam::511831442607:role/wisestay-web-home-scanner-publisher")
        self.assertEqual(SITE["bucket"], "wisestay-web-home-scanner-511831442607")
        self.assertEqual(SITE["publication_parameter"], "/wisestay/dev/websites/home-scanner/publication")
        self.assertEqual(SITE["origin"], "https://home-scanner.wizestay.com")
        self.assertEqual((SITE["account"], SITE["region"]), ("511831442607", "ap-southeast-1"))
        self.assertEqual(ACTIVATION["approval_reference"], "owner-3d-dev-deployment-2026-10-20")
        self.assertIs(ACTIVATION["enabled"], True)


if __name__ == "__main__":
    unittest.main()

"""ci.yml publication gating (wave 3 plan §6.3.4). Parses the workflow; never runs it."""
from __future__ import annotations

from pathlib import Path
import unittest

import yaml  # test-only: deployment/requirements-ci.txt

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
ROLE = "arn:aws:iam::511831442607:role/wisestay-web-home-scanner-publisher"
PINS = {
    "actions/checkout": "11bd71901bbe5b1630ceea73d27597364c9af683",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "aws-actions/configure-aws-credentials": "61815dcd50bd041e203e49132bacad1fd04d2708",
    "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
}


class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WORKFLOW.read_text(encoding="utf-8")
        cls.workflow = yaml.safe_load(cls.text)
        cls.triggers = cls.workflow.get("on", cls.workflow.get(True))  # PyYAML reads `on` as True
        cls.jobs = cls.workflow["jobs"]
        cls.deploy = cls.jobs["deploy"]

    def test_triggers_and_main_runs_are_not_cancelled(self):
        self.assertEqual(self.triggers["push"]["branches"], ["main"])
        deploy_input = self.triggers["workflow_dispatch"]["inputs"]["deploy"]
        self.assertEqual((deploy_input["type"], deploy_input["default"]), ("boolean", False))
        self.assertEqual(self.workflow["permissions"], {"contents": "read"})
        self.assertEqual(self.workflow["concurrency"]["cancel-in-progress"],
                         "${{ github.event_name == 'pull_request' }}")

    def test_deploy_job_gating(self):
        self.assertEqual(self.deploy["needs"], ["source", "web"])
        self.assertEqual(self.deploy["if"],
                         "github.repository == 'majidsamadi/three-dimension-view' && github.ref == 'refs/heads/main' && "
                         "(github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && inputs.deploy == true))")
        self.assertEqual(self.deploy["permissions"], {"contents": "read", "id-token": "write"})
        self.assertEqual(self.deploy["concurrency"],
                         {"group": "wisestay-web-home-scanner-publication", "cancel-in-progress": False})

    def test_only_the_deploy_job_can_request_an_oidc_token(self):
        for name, job in self.jobs.items():
            if name != "deploy":
                self.assertNotIn("id-token", job.get("permissions") or {}, name)
        self.assertNotIn("secrets.AWS", self.text)
        self.assertNotIn("aws-access-key-id", self.text)

    def test_every_action_is_pinned(self):
        for name, job in self.jobs.items():
            for step in job["steps"]:
                if "uses" in step:
                    action, _, ref = step["uses"].partition("@")
                    self.assertEqual(ref, PINS.get(action), (name, step["uses"]))

    def test_literal_publisher_role_in_the_allowed_account(self):
        credentials = [step for step in self.deploy["steps"] if step.get("uses", "").startswith("aws-actions/")]
        self.assertEqual(len(credentials), 1)
        settings = credentials[0]["with"]
        self.assertEqual(settings["role-to-assume"], ROLE)
        self.assertEqual(settings["allowed-account-ids"], "511831442607")
        self.assertEqual(settings["aws-region"], "ap-southeast-1")
        self.assertIs(settings["unset-current-credentials"], True)

    def test_order_build_main_credentials_caller_publish_receipt(self):
        steps = self.deploy["steps"]

        def index(predicate) -> int:
            return next(position for position, step in enumerate(steps) if predicate(step))

        build = index(lambda step: step.get("run") == "npm run build")
        main = index(lambda step: "git/ref/heads/main" in step.get("run", ""))
        credentials = index(lambda step: step.get("uses", "").startswith("aws-actions/"))
        caller = index(lambda step: "get-caller-identity" in step.get("run", ""))
        publish = index(lambda step: step.get("run") == "python3 deployment/publish.py")
        upload = index(lambda step: step.get("uses", "").startswith("actions/upload-artifact"))
        self.assertEqual(sorted([build, main, credentials, caller, publish, upload]),
                         [build, main, credentials, caller, publish, upload])
        self.assertIn('= "511831442607"', steps[caller]["run"])
        self.assertIn("assumed-role/wisestay-web-home-scanner-publisher/*", steps[caller]["run"])
        self.assertEqual(steps[upload]["if"], "always()")
        self.assertEqual(steps[upload]["with"]["name"], "deployment-receipt-${{ github.sha }}")
        self.assertEqual(steps[upload]["with"]["path"], "dist/deployment-receipt.json")

    def test_web_job_runs_the_deployment_tests(self):
        runs = " ".join(step.get("run", "") for step in self.jobs["web"]["steps"])
        self.assertIn("unittest discover -s deployment -p 'test_*.py'", runs)
        self.assertIn("--require-hashes", runs)


if __name__ == "__main__":
    unittest.main()

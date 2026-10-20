"""Publish the verified build to the Home Scanner dev site (wave 3 plan §6.3.3, X.10).

Run only by the ``deploy`` job of ``.github/workflows/ci.yml`` with GitHub OIDC credentials for
``wisestay-web-home-scanner-publisher`` in account 511831442607. Modelled on
``wisestay-ota-web/deployment/publish.py``. Stdlib plus the ``gh`` and ``aws`` CLIs.

Order: activation -> current main -> release manifest -> STS caller -> publication parameter ->
distribution alias and S3 origin -> file hashes -> asset sync (never delete) -> main re-check ->
no-store entry files -> invalidation -> live checks (release revision, index hash, session
readiness JSON, missing asset 403/404) -> ``dist/deployment-receipt.json``.

Failures are closed labels plus at most four denied IAM action names; CLI output is never echoed.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
ACCOUNT = "511831442607"
ACTIVATION_CONTRACT = "wisestay.3d.activation.v1"
APPROVAL_REFERENCE = "owner-3d-dev-deployment-2026-10-20"
RECEIPT_CONTRACT = "wisestay.3d.deployment-receipt.v1"
SESSION_CONTRACT = "wisestay.web-session.v1"
# Entry files are re-read on every visit; hashed assets may be cached briefly (OTA precedent).
NO_STORE = {
    "index.html": "text/html; charset=utf-8",
    "sw.js": "text/javascript; charset=utf-8",
    "manifest.webmanifest": "application/manifest+json",
    "release.json": "application/json",
}
_DENIED = re.compile(r"not authorized to perform: ([a-z0-9-]+:[A-Za-z0-9*]+)")


class Stop(Exception):
    def __init__(self, label: str, *, held: bool = False, denied: list[str] | None = None):
        super().__init__(label)
        self.label = label
        self.held = held
        self.denied = (denied or [])[:4]


@dataclass(frozen=True)
class Completed:
    returncode: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class Fetched:
    status: int | None
    content_type: str
    body: bytes


Runner = Callable[..., Completed]
Http = Callable[[str, Mapping[str, str]], Fetched]


def subprocess_runner(argv: list[str], *, timeout: int = 900) -> Completed:
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, check=False)
    return Completed(result.returncode, result.stdout, result.stderr)


def http_get(url: str, headers: Mapping[str, str]) -> Fetched:
    request = Request(url, method="GET", headers={"User-Agent": "wisestay-3d-publish-smoke", **headers})
    try:
        with urlopen(request, timeout=30) as response:  # noqa: S310 - fixed https site URL
            return Fetched(response.status, response.headers.get("Content-Type", ""), response.read())
    except HTTPError as error:
        return Fetched(error.code, error.headers.get("Content-Type", "") if error.headers else "", b"")
    except (URLError, OSError, ValueError):
        return Fetched(None, "", b"")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_tree(dist: Path) -> dict[str, str]:
    files: dict[str, str] = {}
    for path in sorted(dist.rglob("*")):
        if path.is_symlink():
            raise Stop("BUILD_CONTAINS_SYMLINK")
        relative = path.relative_to(dist).as_posix()
        if path.is_file() and relative not in ("release.json", "deployment-receipt.json"):
            files[relative] = sha256(path.read_bytes())
    return files


class Publication:
    def __init__(self, *, site: Mapping, activation_path: Path, dist: Path, receipt_path: Path,
                 env: Mapping[str, str], run: Runner = subprocess_runner, http: Http = http_get,
                 sleep: Callable[[float], None] = time.sleep):
        self.site = site
        self.activation_path = activation_path
        self.dist = dist
        self.receipt_path = receipt_path
        self.env = env
        self.run = run
        self.http = http
        self.sleep = sleep
        self.receipt: dict = {
            "contract": RECEIPT_CONTRACT,
            "repository": site["repository"],
            "revision": env.get("GITHUB_SHA", ""),
            "run_id": env.get("GITHUB_RUN_ID", ""),
            "run_attempt": env.get("GITHUB_RUN_ATTEMPT", ""),
            "approval_reference": None,
            "caller_arn": None,
            "account": None,
            "state_key": None,
            "origin": site["origin"],
            "distribution_id": None,
            "files_sha256": None,
            "file_count": None,
            "smoke": None,
            "result": "failed",
            "failure": None,
        }

    def _activation(self) -> None:
        try:
            value = json.loads(self.activation_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise Stop("ACTIVATION_DISABLED", held=True) from None
        if not (value.get("contract") == ACTIVATION_CONTRACT and value.get("enabled") is True
                and value.get("environment") == "dev" and value.get("account") == ACCOUNT
                and value.get("approval_reference") == APPROVAL_REFERENCE):
            raise Stop("ACTIVATION_DISABLED", held=True)
        self.receipt["approval_reference"] = APPROVAL_REFERENCE

    def _cli(self, label: str, argv: list[str]) -> str:
        result = self.run(argv, timeout=900)
        if result.returncode:
            raise Stop(label, denied=sorted(set(_DENIED.findall(result.stderr))))
        return result.stdout

    def _json(self, label: str, argv: list[str]) -> Mapping:
        try:
            value = json.loads(self._cli(label, argv))
        except ValueError:
            raise Stop(label) from None
        if not isinstance(value, dict):
            raise Stop(label)
        return value

    def _current_main(self) -> None:
        repository = self.site["repository"]
        if self.env.get("GITHUB_REPOSITORY") != repository or self.env.get("GITHUB_REF") != "refs/heads/main":
            raise Stop("NOT_MAIN_OF_REPOSITORY")
        head = self._cli("MAIN_LOOKUP_FAILED", ["gh", "api", f"repos/{repository}/git/ref/heads/main",
                                                "--jq", ".object.sha"]).strip()
        if not head or head != self.env.get("GITHUB_SHA"):
            raise Stop("SUPERSEDED_MAIN")

    def _caller(self) -> None:
        identity = self._json("STS_CALLER_UNAVAILABLE", ["aws", "sts", "get-caller-identity", "--output", "json"])
        self.receipt["account"] = identity.get("Account")
        self.receipt["caller_arn"] = identity.get("Arn")
        if identity.get("Account") != ACCOUNT or self.site["account"] != ACCOUNT:
            raise Stop("WRONG_ACCOUNT")
        if not str(identity.get("Arn", "")).startswith(self.site["publisher_session_prefix"]):
            raise Stop("WRONG_PUBLISHER_ROLE")

    def _publication(self) -> tuple[str, str]:
        raw = self._cli("PUBLICATION_PARAMETER_UNAVAILABLE",
                        ["aws", "ssm", "get-parameter", "--name", self.site["publication_parameter"],
                         "--query", "Parameter.Value", "--output", "text"]).strip()
        try:
            value = json.loads(raw)
        except ValueError:
            raise Stop("PUBLICATION_PARAMETER_INVALID") from None
        distribution = str(value.get("distribution_id", ""))
        if not (value.get("repository") == self.site["repository"] and value.get("origin") == self.site["origin"]
                and value.get("bucket") == self.site["bucket"] and value.get("account") == ACCOUNT
                and value.get("region") == self.site["region"] and re.fullmatch(r"E[A-Z0-9]{5,20}", distribution)):
            raise Stop("PUBLICATION_PARAMETER_MISMATCH")
        self.receipt["distribution_id"] = distribution
        return value["bucket"], distribution

    def _distribution(self, bucket: str, distribution: str) -> None:
        config = (self._json("DISTRIBUTION_UNAVAILABLE", ["aws", "cloudfront", "get-distribution", "--id", distribution,
                                                            "--output", "json"]).get("Distribution") or {}
                  ).get("DistributionConfig") or {}
        aliases = (config.get("Aliases") or {}).get("Items") or []
        origins = [item.get("DomainName") for item in (config.get("Origins") or {}).get("Items") or []]
        if self.site["origin"].removeprefix("https://") not in aliases:
            raise Stop("DISTRIBUTION_ALIAS_MISMATCH")
        if f"{bucket}.s3.{self.site['region']}.amazonaws.com" not in origins:
            raise Stop("DISTRIBUTION_ORIGIN_MISMATCH")

    def _live_checks(self, release: Mapping) -> None:
        origin = self.site["origin"]
        smoke: dict = {"url": origin + "/", "status": None, "content_type": None, "result": "failed", "checks": {}}
        self.receipt["smoke"] = smoke
        for attempt in range(12):
            live = self.http(origin + "/release.json", {"Accept": "application/json", "Cache-Control": "no-cache"})
            index = self.http(origin + "/", {"Accept": "text/html", "Cache-Control": "no-cache"})
            smoke.update(status=index.status, content_type=index.content_type.split(";")[0].strip() or None)
            try:
                revision = json.loads(live.body).get("revision") if live.status == 200 else None
            except (ValueError, AttributeError):
                revision = None
            if (revision == release["revision"] and index.status == 200
                    and sha256(index.body) == release["files"]["index.html"]):
                break
            if attempt == 11:
                raise Stop("LIVE_REVISION_NOT_SERVED")
            self.sleep(10)
        smoke["checks"]["release_revision"] = "passed"
        smoke["checks"]["index_html"] = "passed"
        readiness = self.http(f"{origin}{self.site['session_route']}readiness",
                              {"Accept": "application/json", "X-WiseStay-Web-Session": SESSION_CONTRACT})
        kind = readiness.content_type.split(";")[0].strip().lower()
        try:
            ready = json.loads(readiness.body) if kind == "application/json" else None
        except ValueError:
            ready = None
        if readiness.status != 200 or not isinstance(ready, dict):
            smoke["checks"]["session_readiness"] = f"failed:{readiness.status}:{kind or 'none'}"
            raise Stop("SESSION_ROUTE_NOT_JSON")
        smoke["checks"]["session_readiness"] = "passed"
        missing = self.http(origin + "/assets/missing.js", {"Accept": "*/*"})
        if missing.status not in (403, 404):
            smoke["checks"]["missing_asset"] = f"failed:{missing.status}"
            raise Stop("MISSING_ASSET_NOT_REJECTED")
        smoke["checks"]["missing_asset"] = "passed"
        smoke["result"] = "passed"

    def execute(self) -> None:
        self._activation()
        self._current_main()
        try:
            release_bytes = (self.dist / "release.json").read_bytes()
            release = json.loads(release_bytes)
        except (OSError, ValueError):
            raise Stop("RELEASE_MANIFEST_MISSING") from None
        if not (release.get("revision") == self.env.get("GITHUB_SHA")
                and release.get("repository") == self.site["repository"] and release.get("origin") == self.site["origin"]):
            raise Stop("RELEASE_MANIFEST_MISMATCH")
        self._caller()
        bucket, distribution = self._publication()
        self._distribution(bucket, distribution)
        if hash_tree(self.dist) != release.get("files"):
            raise Stop("BUILD_CHANGED_AFTER_VERIFICATION")
        self.receipt["files_sha256"] = sha256(json.dumps(release["files"], sort_keys=True, separators=(",", ":")).encode())
        self.receipt["file_count"] = len(release["files"])
        destination = f"s3://{bucket}"
        sync = ["aws", "s3", "sync", str(self.dist), destination, "--cache-control", "public,max-age=300",
                "--only-show-errors", "--exclude", "deployment-receipt.json"]
        for name in NO_STORE:
            sync += ["--exclude", name]
        # Old assets stay for open tabs and rollback: publication never deletes.
        self._cli("ASSET_SYNC_FAILED", sync)
        self._current_main()
        for name, content_type in NO_STORE.items():
            if name == "release.json" or (self.dist / name).is_file():
                self._cli("ENTRY_UPLOAD_FAILED", ["aws", "s3", "cp", str(self.dist / name), f"{destination}/{name}",
                                                  "--cache-control", "no-store", "--content-type", content_type,
                                                  "--only-show-errors"])
        invalidation = (self._json("INVALIDATION_FAILED", ["aws", "cloudfront", "create-invalidation",
                                                           "--distribution-id", distribution, "--paths", "/*",
                                                           "--output", "json"]).get("Invalidation") or {}).get("Id")
        if not invalidation:
            raise Stop("INVALIDATION_FAILED")
        self._cli("INVALIDATION_WAIT_FAILED", ["aws", "cloudfront", "wait", "invalidation-completed",
                                               "--distribution-id", distribution, "--id", invalidation])
        self._live_checks(release)
        self.receipt["result"] = "deployed"

    def main(self) -> int:
        code = 0
        try:
            self.execute()
        except Stop as stop:
            self.receipt["result"] = "held" if stop.held else "failed"
            self.receipt["failure"] = {"label": stop.label, "denied_actions": stop.denied}
            code = 0 if stop.label == "ACTIVATION_DISABLED" else 1
        except Exception as error:  # noqa: BLE001 - never publish CLI or runtime detail
            self.receipt["result"] = "failed"
            self.receipt["failure"] = {"label": "PUBLICATION_OPERATION_FAILED", "denied_actions": [],
                                       "type": type(error).__name__}
            code = 1
        self.receipt_path.parent.mkdir(parents=True, exist_ok=True)
        self.receipt_path.write_text(json.dumps(self.receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps({"result": self.receipt["result"], "failure": self.receipt["failure"]}))
        return code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--site", type=Path, default=ROOT / "deployment" / "site.json")
    parser.add_argument("--activation", type=Path, default=ROOT / "deployment" / "activation.json")
    args = parser.parse_args(argv)
    site = json.loads(args.site.read_text(encoding="utf-8"))
    dist = ROOT / site["output"]
    return Publication(site=site, activation_path=args.activation, dist=dist,
                       receipt_path=dist / "deployment-receipt.json", env=dict(os.environ)).main()


if __name__ == "__main__":
    sys.exit(main())

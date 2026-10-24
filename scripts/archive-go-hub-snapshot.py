#!/usr/bin/env python3
"""GO HUB legacy backup: allowlisted tracked source + provenance, no credentials."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(".")
OUT = Path("go-hub-backup")
OUT.mkdir(exist_ok=True)

def git(*args):
    return subprocess.check_output(["git", *args], text=True).strip()

sha = git("rev-parse", "HEAD")
files = [p.decode("utf-8", "replace") for p in subprocess.check_output(["git", "ls-files", "-z"]).split(b"\x00") if p]
deny_path = re.compile(
    r"(^|/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|"
    r"id_rsa|id_ed25519|credentials\.json|service.account(?:\.json)?|"
    r".*?(?:\.pem|\.p12|\.pfx|\.jks|\.keystore|\.key))$",
    re.I,
)
deny_content = re.compile(
    rb"(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|"
    rb"gh[pousr]_[A-Za-z0-9_]{24,}|"
    rb"AKIA[0-9A-Z]{16}|"
    rb"-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----)",
)
excluded = []
included = []
zip_path = OUT / "go-hub-main-source-sanitized.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for name in files:
        candidate = ROOT / name
        if not candidate.is_file():
            excluded.append({"path": name, "reason": "NOT_REGULAR_FILE"})
            continue
        if deny_path.search(name):
            excluded.append({"path": name, "reason": "SENSITIVE_PATH"})
            continue
        if candidate.stat().st_size > 20 * 1024 * 1024:
            excluded.append({"path": name, "reason": "TOO_LARGE_REVIEW_REQUIRED"})
            continue
        content = candidate.read_bytes()
        if deny_content.search(content):
            excluded.append({"path": name, "reason": "POSSIBLE_CREDENTIAL_LITERAL"})
            continue
        archive.writestr(name, content)
        included.append({"path": name, "sha256": hashlib.sha256(content).hexdigest(), "size": len(content)})
with zipfile.ZipFile(zip_path) as archive:
    assert archive.testzip() is None
    assert len(archive.namelist()) == len(included)

(OUT / "source-included.json").write_text(json.dumps(included, indent=2, ensure_ascii=False))
(OUT / "source-exclusions.json").write_text(json.dumps(excluded, indent=2, ensure_ascii=False))
(OUT / "git-history-graph.tsv").write_text(
    git("log", "--all", "--format=%H%x09%P%x09%aI") + "\n"
)
(OUT / "git-refs.txt").write_text(
    git("for-each-ref", "--format=%(objectname) %(refname)") + "\n"
)
manifest = {
    "archiveType": "GO_HUB_LEGACY_SOURCE_SNAPSHOT",
    "sourceRepo": os.environ.get("GITHUB_REPOSITORY", "pureekangraw-ops/prytaneion-workspace"),
    "sourceCommit": sha,
    "createdUTC": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "mainSourceIncludedFiles": len(included),
    "mainSourceExcludedFiles": len(excluded),
    "sourceZipSha256": hashlib.sha256(zip_path.read_bytes()).hexdigest(),
    "includesFullGitObjectHistory": False,
    "includesCloudflareDurableObjectRecords": False,
    "includesCloudflareR2ObjectBytes": False,
    "includesSecrets": False,
    "productionMutations": False,
    "restoreLimit": "Source tree can be extracted. GitHub remains the authority for full git history. Cloudflare storage and secret values NOT backed up by this job.",
}
(OUT / "snapshot-manifest.json").write_text(json.dumps(manifest, indent=2))
print(json.dumps({"sourceCommit": sha, "included": len(included), "excluded": len(excluded), "archiveSHA256": manifest["sourceZipSha256"]}))

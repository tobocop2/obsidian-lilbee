#!/usr/bin/env python3
"""Record the lilbee server's real /api/profiles responses, error bodies included.

The route contract (``dump-server-contract.py``) says which fields a response
carries. The profile surfaces also read what those fields hold (the diff rows,
the kept keys, the folder of each profile) and the ``detail`` of a refusal, so
their tests replay bodies this script records from the server itself.

It builds the server app in-process against a throwaway home and data root, so
it never touches a real profile folder, and drives one fixed scenario through it.

Usage::

    python3 scripts/dump-profile-responses.py --lilbee ~/projects/lilbee

Requires the lilbee virtualenv. Point --python at it if it is not the
checkout's ``.venv``.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Runs inside the lilbee venv, so it cannot import anything from this file.
_CHILD = r'''
import json, sys
from pathlib import Path
from unittest.mock import MagicMock
from urllib.parse import quote

from litestar.testing import TestClient

import lilbee.app.services as services
import lilbee.server.auth as auth
from lilbee.core.config import cfg
from lilbee.core.profile_files import PACKAGE_PROFILES_DIR, PROFILES_DIRNAME, ProfileStore
from lilbee.core.system import default_data_dir
from lilbee.server.app import create_app

project = Path(sys.argv[1])
cfg.data_root = project
cfg.data_dir = project / "data"
cfg.documents_dir = project / "documents"
cfg.lancedb_dir = cfg.data_dir / "lancedb"
# No engine: a stand-in container, which a settings write must not tear down
services.set_services(MagicMock(profile_store=ProfileStore()))
services.reset_services = lambda: None
auth.session_manager.disable()

CREDITED = (
    '[profile]\nname = "Court filings"\ndescription = "Scanned US court PDFs with dense tables."\n'
    'authors = [{ name = "Jane Doe", github = "janedoe" }]\n'
    'tested_on = "4,000 scanned county court filings, 1990-2010"\n'
    '[values]\ntable_extraction = true\nchunk_size = 768\n'
)
for folder in (default_data_dir() / PROFILES_DIRNAME, project / PROFILES_DIRNAME):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "court-filings.toml").write_text(CREDITED, encoding="utf-8")
(default_data_dir() / PROFILES_DIRNAME / "broken.toml").write_text(
    "[values]\nchat_model = 'x'\n", encoding="utf-8"
)

client = TestClient(create_app())
recorded = {}


def url(name, suffix=""):
    return f"/api/profiles/{quote(name, safe='')}{suffix}"


def record(label, method, path, **kwargs):
    resp = client.request(method, path, **kwargs)
    body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
    recorded[label] = {"status": resp.status_code, "body": body}
    disposition = resp.headers.get("content-disposition")
    if disposition is not None:
        recorded[label]["content_disposition"] = disposition
    return resp


def scrub(value):
    """Swap the throwaway paths for stable placeholders."""
    text = json.dumps(value)
    roots = (
        (str(PACKAGE_PROFILES_DIR), "<package>"),
        (str(project), "<project>"),
        (str(default_data_dir()), "<global>"),
    )
    for root, name in roots:
        text = text.replace(root, name)
    return json.loads(text)


client.patch("/api/config", json={"chunk_size": 500})
record("list", "GET", "/api/profiles")
record("active_default", "GET", "/api/profiles/active")
record("show", "GET", url("Court filings"))
record("diff", "GET", url("Notes and markdown", "/diff"))
record("apply", "POST", url("Notes and markdown", "/apply"))
record("active_applied", "GET", "/api/profiles/active")
record("diff_active", "GET", url("Notes and markdown", "/diff"))
record("save_as", "POST", "/api/profiles", json={"name": "My notes", "target": "project"})
client.patch("/api/config", json={"chunk_overlap": 80})
record("active_saved", "GET", "/api/profiles/active")
record("diff_saved", "GET", url("My notes", "/diff"))
record("update", "PUT", url("My notes"))
client.patch("/api/config", json={"chunk_overlap": 90})
record("discard", "POST", "/api/profiles/discard")
record("duplicate", "POST", url("Scanned archive", "/duplicate"), json={"new_name": "Scans", "target": "global"})
record("rename", "PATCH", url("Scans"), json={"new_name": "Old scans"})
record("export", "GET", url("Old scans", "/export"))
record("delete", "DELETE", url("Old scans"))
exported = recorded["export"]["body"]
record("validate_ok", "POST", "/api/profiles/validate", json={"content": exported, "filename": "old-scans.toml"})
record(
    "validate_bad",
    "POST",
    "/api/profiles/validate",
    json={"content": "[values]\nchat_model = 'x'\n", "filename": "bad.toml"},
)
record("import", "POST", "/api/profiles/import", json={"content": exported, "filename": "old-scans.toml"})
record("error_missing", "GET", url("No such profile", "/diff"))
record("error_clash", "POST", url("Scanned archive", "/duplicate"), json={"new_name": "Old scans"})
record("error_builtin", "PATCH", url("Default"), json={"new_name": "Mine"})
record("error_reserved", "POST", "/api/profiles", json={"name": "active"})
record(
    "error_too_large",
    "POST",
    "/api/profiles/import",
    json={"content": "#" * (256 * 1024 + 1), "filename": "big.toml"},
)
record("error_no_route", "GET", "/api/no-such-route")
print(json.dumps(scrub(recorded), sort_keys=True))
'''


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--lilbee",
        type=Path,
        default=Path.home() / "projects" / "lilbee",
        help="Path to the lilbee server checkout (default: ~/projects/lilbee)",
    )
    parser.add_argument(
        "--python",
        type=Path,
        default=None,
        help="Python to run under (default: <lilbee>/.venv/bin/python)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=Path(__file__).parent.parent / "tests" / "fixtures" / "profile-responses.json",
        help="Where to write the fixture",
    )
    args = parser.parse_args()

    lilbee = args.lilbee.expanduser().resolve()
    src = lilbee / "src"
    if not src.is_dir():
        print(f"error: no src/ under {lilbee} -- is that a lilbee checkout?", file=sys.stderr)
        return 1

    python = args.python or (lilbee / ".venv" / "bin" / "python")
    if not python.exists():
        print(f"error: no interpreter at {python}; pass --python", file=sys.stderr)
        return 1

    scratch = Path(tempfile.mkdtemp(prefix="lilbee-profile-fixture-"))
    home = scratch / "home"
    env = {
        **os.environ,
        "PYTHONPATH": str(src),
        "HOME": str(home),
        "USERPROFILE": str(home),
        "XDG_DATA_HOME": str(home / "xdg"),
        "LOCALAPPDATA": str(home / "local"),
        "LILBEE_DATA": str(scratch / "project"),
    }
    proc = subprocess.run(
        [str(python), "-c", _CHILD, str(scratch / "project")],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(lilbee),
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        return proc.returncode

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(json.loads(proc.stdout), indent=2, sort_keys=True) + "\n")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

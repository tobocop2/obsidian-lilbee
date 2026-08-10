#!/usr/bin/env python3
"""Dump the lilbee server's route contract to a fixture the plugin tests assert against.

The plugin hand-writes its route strings in ``src/api.ts``. Twice now those
strings have drifted from the routes the server actually serves, and both times
CI stayed green because the unit tests mock the client's own shape. This script
captures the server's real contract so a test can catch the next one.

The server publishes OpenAPI at ``/schema``, but that document is not enough on
its own: Litestar derives a response's media type from the route decorator, and
lilbee sets ``media_type`` on the returned ``Stream`` instead. So every SSE route
shows up as ``application/json`` and the JSON-vs-stream flip that broke
``wikiUpdate`` would sail straight through. We read the handler's return
annotation instead, which is where the truth lives.

Usage::

    python3 scripts/dump-server-contract.py --lilbee ~/projects/lilbee

Requires the lilbee virtualenv (it imports the server package to build the app).
Point --python at it if it is not the checkout's ``.venv``.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# Methods Litestar adds itself; the plugin never calls them.
_IGNORED_METHODS = {"OPTIONS", "HEAD"}

# Runs inside the lilbee venv, so it cannot import anything from this file.
_CHILD = r'''
import json, sys
from lilbee.server.app import create_app

def _streams(handler) -> bool:
    """True when the handler returns an SSE stream on its success path.

    ``Stream`` alone is an unconditional stream; ``Stream | Response[X]`` is a
    route that streams unless a flag switches it to a body (``/api/wiki/build``
    with ``?dry_run=true``), which a client still has to be able to stream.
    """
    ann = str(getattr(handler.fn, "__annotations__", {}).get("return", ""))
    return "Stream" in ann

app = create_app()
ops = {}
for route in app.routes:
    for method, entry in getattr(route, "route_handler_map", {}).items():
        if method in ("OPTIONS", "HEAD"):
            continue
        handler = entry[0] if isinstance(entry, tuple) else entry
        ops.setdefault(route.path, {})[method] = {"streams": _streams(handler)}

print(json.dumps({
    "version": app.openapi_schema.info.version,
    "operations": ops,
}, sort_keys=True))
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
        default=Path(__file__).parent.parent / "tests" / "fixtures" / "server-contract.json",
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

    env = {**os.environ, "PYTHONPATH": str(src)}
    proc = subprocess.run(
        [str(python), "-c", _CHILD], capture_output=True, text=True, env=env, cwd=str(lilbee)
    )
    if proc.returncode != 0:
        print(proc.stderr, file=sys.stderr)
        return proc.returncode

    contract = json.loads(proc.stdout)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(contract, indent=2, sort_keys=True) + "\n")

    operations = contract["operations"]
    streaming = sum(1 for m in operations.values() for op in m.values() if op["streams"])
    total = sum(len(m) for m in operations.values())
    print(
        f"wrote {args.out} -- lilbee {contract['version']}, "
        f"{len(operations)} paths, {total} operations ({streaming} streaming)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""
Explain the most recent completed Chronicle run in plain language.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def tsx_loader_path(root: Path) -> Path:
    return root / "node_modules" / "tsx" / "dist" / "esm" / "index.mjs"


def main(argv: list[str] | None = None) -> int:
    root = repo_root()
    tsx_loader = tsx_loader_path(root)
    if not tsx_loader.exists():
        sys.stderr.write("Missing local tsx loader under node_modules/tsx. Run npm install first.\n")
        return 1

    command = [
        "node",
        "--import",
        "tsx/esm",
        "src/cli/lastRunExplainCli.ts",
        *(argv or sys.argv[1:]),
    ]
    completed = subprocess.run(command, cwd=root)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())

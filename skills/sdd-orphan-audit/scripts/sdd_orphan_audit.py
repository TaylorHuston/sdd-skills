#!/usr/bin/env python3
"""Build a universal SDD traceability/orphan candidate report.

This script is intentionally conservative. It compares SDD Epic evidence against
tracked repo files; it does not decide that unreferenced files are safe to
delete.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Iterable


PASDD_EXTENSIONS = {
    ".css",
    ".cjs",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".scss",
    ".sh",
    ".sql",
    ".ts",
    ".tsx",
    ".toml",
    ".yaml",
    ".yml",
}

SKIP_DIRS = {
    ".git",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    "coverage",
    "dist",
    "node_modules",
    "out",
}

PASDD_RE = re.compile(r"(?P<path>(?:[A-Za-z0-9_@{}().-]+/)+[A-Za-z0-9_@{}().-]+(?:\.[A-Za-z0-9]+)?(?::\d+)?)")
FILENAME_RE = re.compile(r"(?P<path>[A-Za-z0-9_@{}().-]+\.[A-Za-z0-9]+(?::\d+)?)")
LINK_RE = re.compile(r"\[[^\]]+\]\((?P<target>[^)]+)\)")
BACKTICK_RE = re.compile(r"`([^`]+)`")


def run_git_files(root: Path) -> list[str] | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return sorted(p.decode("utf-8", errors="replace") for p in result.stdout.split(b"\0") if p)


def walk_files(root: Path) -> list[str]:
    files: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        base = Path(dirpath)
        for filename in filenames:
            path = base / filename
            files.append(path.relative_to(root).as_posix())
    return sorted(files)


def inventory_files(root: Path) -> tuple[list[str], str]:
    git_files = run_git_files(root)
    if git_files is not None:
        return git_files, "git ls-files"
    return walk_files(root), "filesystem walk fallback"


def epic_files(root: Path) -> list[Path]:
    epics_root = root / "docs" / "epics"
    if not epics_root.exists():
        return []
    return sorted(epics_root.glob("*/epic.md"))


def looks_like_test(path: str) -> bool:
    lowered = path.lower()
    name = Path(path).name.lower()
    return (
        ".test." in name
        or ".spec." in name
        or lowered.startswith("test/")
        or lowered.startswith("tests/")
        or "/test/" in lowered
        or "/tests/" in lowered
        or "__tests__/" in lowered
        or lowered.startswith("e2e/")
        or "/e2e/" in lowered
        or lowered.startswith("cypress/")
        or lowered.startswith("playwright/")
    )


def looks_like_source(path: str) -> bool:
    suffix = Path(path).suffix.lower()
    if suffix not in PASDD_EXTENSIONS:
        return False
    lowered = path.lower()
    if looks_like_test(path):
        return False
    if lowered.startswith(("docs/", ".agents/", ".codex/", "changes/")):
        return False
    if "/docs/" in lowered or "/fixtures/" in lowered or "/mocks/" in lowered:
        return False
    return True


def clean_candidate(raw: str, root: Path) -> str | None:
    candidate = raw.strip().strip(".,;:)]}'\"")
    if not candidate or "://" in candidate or candidate.startswith("#"):
        return None
    if " " in candidate and not candidate.startswith("/"):
        return None
    candidate = candidate.split("#", 1)[0]
    candidate = re.sub(r":\d+$", "", candidate)
    candidate = candidate.strip()
    if not candidate:
        return None
    path = Path(candidate)
    if path.is_absolute():
        try:
            candidate = path.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            return None
    suffix = Path(candidate).suffix.lower()
    if "/" not in candidate and suffix not in PASDD_EXTENSIONS:
        return None
    if suffix not in PASDD_EXTENSIONS and not (root / candidate).exists():
        return None
    if candidate.startswith("../"):
        return None
    return candidate.lstrip("./")


def extract_candidates(line: str, root: Path) -> set[str]:
    raw_values: list[str] = []
    raw_values.extend(match.group("target") for match in LINK_RE.finditer(line))
    raw_values.extend(match.group(1) for match in BACKTICK_RE.finditer(line))
    raw_values.extend(match.group("path") for match in PASDD_RE.finditer(line))
    raw_values.extend(match.group("path") for match in FILENAME_RE.finditer(line))
    cleaned = {candidate for raw in raw_values if (candidate := clean_candidate(raw, root))}
    return cleaned


def parse_epic_refs(root: Path, epic_path: Path) -> dict[str, set[str]]:
    refs: dict[str, set[str]] = {"implemented": set(), "verified": set()}
    current: str | None = None
    for line in epic_path.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            heading = stripped.lstrip("#").strip().lower()
            if "implemented by" in heading:
                current = "implemented"
                continue
            if "verified by" in heading:
                current = "verified"
                continue
            current = None
        if current:
            refs[current].update(extract_candidates(line, root))
    return refs


def build_report(root: Path) -> dict:
    files, inventory_source = inventory_files(root)
    file_set = set(files)
    epics = epic_files(root)
    implemented_by: dict[str, list[str]] = defaultdict(list)
    verified_by: dict[str, list[str]] = defaultdict(list)
    missing_implemented: dict[str, list[str]] = defaultdict(list)
    missing_verified: dict[str, list[str]] = defaultdict(list)

    for epic in epics:
        rel_epic = epic.relative_to(root).as_posix()
        refs = parse_epic_refs(root, epic)
        for ref in sorted(refs["implemented"]):
            if ref in file_set or (root / ref).exists():
                implemented_by[ref].append(rel_epic)
            else:
                missing_implemented[ref].append(rel_epic)
        for ref in sorted(refs["verified"]):
            if ref in file_set or (root / ref).exists():
                verified_by[ref].append(rel_epic)
            else:
                missing_verified[ref].append(rel_epic)

    test_files = sorted(path for path in files if looks_like_test(path))
    source_files = sorted(path for path in files if looks_like_source(path))
    if epics:
        unverified_tests = [path for path in test_files if path not in verified_by]
        unimplemented_sources = [path for path in source_files if path not in implemented_by]
    else:
        unverified_tests = []
        unimplemented_sources = []

    return {
        "root": str(root.resolve()),
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "inventory_source": inventory_source,
        "counts": {
            "epics": len(epics),
            "tracked_files": len(files),
            "implemented_refs": len(implemented_by),
            "verified_refs": len(verified_by),
            "missing_implemented_refs": len(missing_implemented),
            "missing_verified_refs": len(missing_verified),
            "test_files": len(test_files),
            "source_files": len(source_files),
            "tests_without_verified_by": len(unverified_tests),
            "source_without_implemented_by": len(unimplemented_sources),
        },
        "epics": [epic.relative_to(root).as_posix() for epic in epics],
        "missing_implemented_refs": dict(sorted(missing_implemented.items())),
        "missing_verified_refs": dict(sorted(missing_verified.items())),
        "tests_without_verified_by": unverified_tests,
        "source_without_implemented_by": unimplemented_sources,
    }


def limited(items: Iterable[str], limit: int) -> list[str]:
    seq = list(items)
    if limit <= 0:
        return seq
    return seq[:limit]


def print_markdown(report: dict, limit: int) -> None:
    counts = report["counts"]
    print(f"# SDD Orphan Audit Inventory\n")
    print(f"- App root: `{report['root']}`")
    print(f"- Generated: `{report['generated_at']}`")
    print(f"- Inventory source: `{report['inventory_source']}`")
    print("")
    print("## Counts")
    for key, value in counts.items():
        print(f"- {key}: {value}")
    print("")
    print("## Missing Epic Evidence References")
    if not report["missing_implemented_refs"] and not report["missing_verified_refs"]:
        print("- None found.")
    for label, values in (
        ("Implemented By points to missing paths", report["missing_implemented_refs"]),
        ("Verified By path references point to missing paths", report["missing_verified_refs"]),
    ):
        if values:
            print(f"\n### {label}")
            for path, epics in limited(values.items(), limit):
                print(f"- `{path}` referenced by {', '.join(f'`{epic}`' for epic in epics)}")
    print("")
    print("## Traceability Gap Candidates")
    tests = report["tests_without_verified_by"]
    sources = report["source_without_implemented_by"]
    if not tests and not sources:
        print("- None found.")
    if tests:
        print("\n### Tests without Verified By path references")
        for path in limited(tests, limit):
            print(f"- `{path}`")
        if limit and len(tests) > limit:
            print(f"- ... {len(tests) - limit} more")
    if sources:
        print("\n### Source files without Implemented By ownership")
        for path in limited(sources, limit):
            print(f"- `{path}`")
        if limit and len(sources) > limit:
            print(f"- ... {len(sources) - limit} more")
    print("")
    print("## Interpretation")
    if not report["epics"]:
        print("- No `docs/epics/*/epic.md` files were found; this does not appear to be a SDD project root.")
    print("- Missing references are high-confidence artifact drift.")
    print("- Unowned tests/source files are traceability gaps, not deletion approval.")
    print("- Use stack-specific analyzers before calling code a likely orphan.")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Universal SDD orphan audit inventory.")
    parser.add_argument("root", nargs="?", default=".", help="Application root to audit.")
    parser.add_argument("--format", choices=["markdown", "json"], default="markdown")
    parser.add_argument("--limit", type=int, default=50, help="Max entries per markdown section; 0 means unlimited.")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.exists():
        print(f"Root does not exist: {root}", file=sys.stderr)
        return 2

    report = build_report(root)
    if args.format == "json":
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_markdown(report, args.limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

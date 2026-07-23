#!/usr/bin/env python3
"""Build a conservative SDD reverse-traceability inventory.

The script inventories candidates and evidence gaps. It never decides that an
unreferenced file is safe to delete.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path, PurePosixPath
from typing import Iterable


PASDD_EXTENSIONS = {
    ".css", ".cjs", ".html", ".js", ".json", ".jsx", ".md", ".mjs",
    ".py", ".scss", ".sh", ".sql", ".ts", ".tsx", ".toml", ".yaml", ".yml",
}

SKIP_DIRS = {
    ".git", ".next", ".turbo", ".venv", "__pycache__", "coverage", "dist",
    "node_modules", "out",
}

TEST_SUPPORT_STEMS = {
    "bootstrap", "global-setup", "global-teardown", "setup", "test-setup",
    "test-teardown", "test-utils", "vitest.setup",
}

SUPPORT_FILE_NAMES = {
    "ace.js", "adonisrc.ts", "agents.md", "bun.lock", "bun.lockb", "changelog.md", "eslint.config.js",
    "eslint.config.mjs", "eslint.config.ts", "index.html", "package-lock.json",
    "package.json", "playwright.config.js", "playwright.config.ts", "pnpm-lock.yaml",
    "postcss.config.js", "prettier.config.js", "readme.md", "turbo.json", "vite.config.js",
    "vite.config.ts", "vitest.config.js", "vitest.config.ts", "yarn.lock",
}

PASDD_RE = re.compile(
    r"(?P<path>(?:[A-Za-z0-9_@{}*?\[\]().-]+/)+"
    r"[A-Za-z0-9_@{}*?\[\]().-]+(?:\.[A-Za-z0-9*?\[\]-]+)?(?::\d+)?)"
)
FILENAME_RE = re.compile(r"(?P<path>[A-Za-z0-9_@{}*?\[\]().-]+\.[A-Za-z0-9*?\[\]-]+(?::\d+)?)")
LINK_RE = re.compile(r"\[[^\]]+\]\((?P<target>[^)]+)\)")
BACKTICK_RE = re.compile(r"`([^`]+)`")
GLOB_RE = re.compile(r"[*?\[]")
FRONTMATTER_ID_RE = re.compile(r"^id:\s*['\"]?([^'\"\s]+)", re.MULTILINE)
DEFAULT_GIT_TIMEOUT_SECONDS = 10.0
MAX_GIT_TIMEOUT_SECONDS = 60.0
GIT_TIMEOUT_ENV = "SDD_ORPHAN_AUDIT_GIT_TIMEOUT_SECONDS"


def git_timeout_seconds() -> float:
    raw = os.environ.get(GIT_TIMEOUT_ENV)
    if raw is None:
        return DEFAULT_GIT_TIMEOUT_SECONDS
    try:
        timeout = float(raw)
    except ValueError as error:
        raise ValueError(
            f"{GIT_TIMEOUT_ENV} must be a positive number of seconds."
        ) from error
    if not math.isfinite(timeout) or timeout <= 0 or timeout > MAX_GIT_TIMEOUT_SECONDS:
        raise ValueError(
            f"{GIT_TIMEOUT_ENV} must be greater than 0 and no more than "
            f"{MAX_GIT_TIMEOUT_SECONDS:g} seconds."
        )
    return timeout


def run_git_paths(root: Path, args: list[str], operation: str) -> list[str] | None:
    timeout = git_timeout_seconds()
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise ValueError(
            f"Git command timed out after {timeout:g} seconds while {operation}; "
            f"verify Git is responsive and retry for: {root}"
        ) from None
    except (OSError, subprocess.CalledProcessError):
        return None
    return [part.decode("utf-8", errors="replace") for part in result.stdout.split(b"\0") if part]


def require_git_paths(root: Path, args: list[str], operation: str) -> list[str]:
    paths = run_git_paths(root, args, operation)
    if paths is None:
        raise ValueError(
            f"Git command failed while {operation}; "
            f"verify Git repository state and retry for: {root}"
        )
    return paths


def run_git_files(root: Path) -> list[str] | None:
    cached = run_git_paths(
        root,
        ["ls-files", "-z", "--cached"],
        "listing tracked files",
    )
    if cached is None:
        return None
    untracked = run_git_paths(
        root,
        ["ls-files", "-z", "--others", "--exclude-standard"],
        "listing untracked files",
    )
    if untracked is None:
        return None
    deleted = run_git_paths(
        root,
        ["ls-files", "-z", "--deleted"],
        "listing deleted files",
    )
    if deleted is None:
        return None
    return sorted((set(cached) | set(untracked)) - set(deleted))


def changed_files(root: Path, ref: str, inventory: set[str]) -> list[str]:
    resolved = run_git_paths(
        root,
        ["rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}"],
        "resolving the changed-file baseline",
    )
    if not resolved:
        raise ValueError(
            f"Unable to resolve changed-file scope from Git ref: {ref}; "
            f"verify the ref and Git repository state, then retry for: {root}"
        )
    commit = resolved[0].strip()
    if not re.fullmatch(r"[0-9a-fA-F]{40,64}", commit):
        raise ValueError(
            f"Unable to resolve changed-file scope from Git ref: {ref}; "
            f"verify the ref and Git repository state, then retry for: {root}"
        )
    committed = require_git_paths(
        root,
        ["diff", "--name-only", "-z", "--end-of-options", f"{commit}...HEAD", "--"],
        "comparing the changed-file baseline",
    )
    unstaged = require_git_paths(
        root,
        ["diff", "--name-only", "-z", "--"],
        "listing unstaged changes",
    )
    staged = require_git_paths(
        root,
        ["diff", "--cached", "--name-only", "-z", "--"],
        "listing staged changes",
    )
    untracked = require_git_paths(
        root,
        ["ls-files", "-z", "--others", "--exclude-standard"],
        "listing untracked changes",
    )
    return sorted((set(committed) | set(unstaged) | set(staged) | set(untracked)) & inventory)


def walk_files(root: Path) -> list[str]:
    files: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [directory for directory in dirnames if directory not in SKIP_DIRS]
        base = Path(dirpath)
        for filename in filenames:
            files.append((base / filename).relative_to(root).as_posix())
    return sorted(files)


def inventory_files(root: Path) -> tuple[list[str], str]:
    git_files = run_git_files(root)
    if git_files is not None:
        return git_files, "git working tree (index + untracked - deleted)"
    return walk_files(root), "filesystem working tree fallback"


def all_epic_files(root: Path) -> list[Path]:
    epics_root = root / "docs" / "epics"
    if not epics_root.exists():
        return []
    return sorted(epics_root.glob("*/epic.md"))


def epic_id(path: Path) -> str | None:
    match = FRONTMATTER_ID_RE.search(path.read_text(encoding="utf-8", errors="replace"))
    return match.group(1) if match else None


def select_epics(root: Path, selector: str | None) -> list[Path]:
    epics = all_epic_files(root)
    if not selector:
        return epics
    normalized = selector.lower().replace("\\", "/").rstrip("/")
    matches = []
    for path in epics:
        relative = path.relative_to(root).as_posix().lower()
        identities = {
            relative,
            path.parent.name.lower(),
            (epic_id(path) or "").lower(),
        }
        if normalized in identities or relative.endswith(f"/{normalized}/epic.md"):
            matches.append(path)
    if not matches:
        raise ValueError(f"No Epic matches selector: {selector}")
    if len(matches) > 1:
        raise ValueError(f"Epic selector is ambiguous: {selector}")
    return matches


def looks_like_test(path: str) -> bool:
    lowered = path.lower()
    name = Path(path).name.lower()
    return (
        ".test." in name
        or ".spec." in name
        or lowered.startswith(("test/", "tests/", "e2e/", "cypress/", "playwright/"))
        or "/test/" in lowered
        or "/tests/" in lowered
        or "/e2e/" in lowered
        or "__tests__/" in lowered
    )


def looks_like_test_support(path: str) -> bool:
    if not looks_like_test(path):
        return False
    name = Path(path).name.lower()
    stem = name.rsplit(".", 1)[0]
    return stem in TEST_SUPPORT_STEMS or any(token in name for token in ("global-setup", "global-teardown", "test-setup"))


def looks_like_support(path: str) -> bool:
    lowered = path.lower()
    name = Path(path).name.lower()
    if name in SUPPORT_FILE_NAMES or name.startswith(("tsconfig.", "tsconfig-")):
        return True
    if name.endswith(".d.ts") or ".generated." in name:
        return True
    parts = set(PurePosixPath(lowered).parts)
    if parts.intersection({"generated", ".generated", "__generated__"}):
        return True
    if parts.intersection({"bin", "config", "scripts", "start"}):
        return True
    if name in {"main.js", "main.jsx", "main.ts", "main.tsx"} and "src" in parts:
        return True
    return False


def looks_like_source(path: str) -> bool:
    suffix = Path(path).suffix.lower()
    if suffix not in PASDD_EXTENSIONS or looks_like_test(path) or looks_like_support(path):
        return False
    lowered = path.lower()
    if lowered.startswith(("docs/", ".agents/", ".codex/", "changes/")):
        return False
    if "/docs/" in lowered or "/fixtures/" in lowered or "/mocks/" in lowered:
        return False
    return True


def clean_candidate(raw: str, root: Path) -> str | None:
    candidate = raw.strip().strip(".,;:)]}'\"")
    if not candidate or "://" in candidate or candidate.startswith("#"):
        return None
    candidate = re.sub(r"[?#].*$", "", candidate)
    candidate = re.sub(r":\d+$", "", candidate).strip()
    if " " in candidate and not candidate.startswith("/"):
        return None
    if not candidate:
        return None
    path = Path(candidate)
    if path.is_absolute():
        try:
            candidate = path.resolve().relative_to(root.resolve()).as_posix()
        except ValueError:
            return None
    if candidate.startswith("../"):
        return None
    suffix = Path(candidate).suffix.lower()
    if not GLOB_RE.search(candidate):
        if "/" not in candidate and suffix not in PASDD_EXTENSIONS:
            return None
        if suffix not in PASDD_EXTENSIONS and not (root / candidate).exists():
            return None
    return candidate.lstrip("./")


def mask_spans(line: str, patterns: tuple[re.Pattern[str], ...]) -> str:
    chars = list(line)
    for pattern in patterns:
        for match in pattern.finditer(line):
            for index in range(match.start(), match.end()):
                chars[index] = " "
    return "".join(chars)


def extract_candidates(line: str, root: Path) -> set[str]:
    raw_values = [match.group("target") for match in LINK_RE.finditer(line)]
    raw_values.extend(match.group(1) for match in BACKTICK_RE.finditer(line))
    plain = mask_spans(line, (LINK_RE, BACKTICK_RE))
    raw_values.extend(match.group("path") for match in PASDD_RE.finditer(plain))
    raw_values.extend(match.group("path") for match in FILENAME_RE.finditer(plain))
    cleaned = {candidate for raw in raw_values if (candidate := clean_candidate(raw, root))}
    qualified_names = {PurePosixPath(path).name for path in cleaned if "/" in path}
    return {path for path in cleaned if "/" in path or path not in qualified_names}


def parse_epic_refs(root: Path, epic_path: Path) -> dict[str, object]:
    refs: dict[str, object] = {
        "implemented": set(),
        "verified": set(),
        "implementation_kinds": defaultdict(set),
    }
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
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            evidence_source = cells[1] if stripped.startswith("|") and len(cells) >= 2 else line
            candidates = extract_candidates(evidence_source, root)
            refs[current].update(candidates)
            if current == "implemented" and candidates:
                kind = cells[2].lower() if len(cells) >= 4 else "legacy"
                for candidate in candidates:
                    refs["implementation_kinds"][candidate].add(kind)
    return refs


def expand_reference(reference: str, files: list[str]) -> list[str]:
    if GLOB_RE.search(reference):
        pattern = PurePosixPath(reference)
        return sorted(path for path in files if PurePosixPath(path).match(str(pattern)))
    return [reference] if reference in set(files) else []


def build_report(root: Path, epic_selector: str | None = None, changed_from: str | None = None) -> dict:
    files, inventory_source = inventory_files(root)
    file_set = set(files)
    scoped_files = changed_files(root, changed_from, file_set) if changed_from else files
    epics = select_epics(root, epic_selector)
    implemented_by: dict[str, list[str]] = defaultdict(list)
    verified_by: dict[str, list[str]] = defaultdict(list)
    missing_implemented: dict[str, list[str]] = defaultdict(list)
    missing_verified: dict[str, list[str]] = defaultdict(list)
    implementation_ownership: dict[str, dict[str, set[str]]] = {}

    for epic in epics:
        relative_epic = epic.relative_to(root).as_posix()
        refs = parse_epic_refs(root, epic)
        for kind, ownership, missing in (
            ("implemented", implemented_by, missing_implemented),
            ("verified", verified_by, missing_verified),
        ):
            for reference in sorted(refs[kind]):
                matches = expand_reference(reference, files)
                if matches:
                    for match in matches:
                        ownership[match].append(relative_epic)
                        if kind == "implemented":
                            record = implementation_ownership.setdefault(
                                match,
                                {"epics": set(), "kinds": set()},
                            )
                            record["epics"].add(relative_epic)
                            record["kinds"].update(
                                refs["implementation_kinds"].get(reference, {"legacy"})
                            )
                else:
                    missing[reference].append(relative_epic)

    test_support_files = sorted(path for path in scoped_files if looks_like_test_support(path))
    test_files = sorted(path for path in scoped_files if looks_like_test(path) and not looks_like_test_support(path))
    support_files = sorted(path for path in scoped_files if looks_like_support(path))
    source_files = sorted(path for path in scoped_files if looks_like_source(path))
    if epics:
        unverified_tests = [path for path in test_files if path not in verified_by]
        unimplemented_sources = [path for path in source_files if path not in implemented_by]
    else:
        unverified_tests = []
        unimplemented_sources = []

    relative_epics = [epic.relative_to(root).as_posix() for epic in epics]
    return {
        "root": str(root.resolve()),
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "inventory_source": inventory_source,
        "scope": {
            "epic_selector": epic_selector,
            "epics": relative_epics,
            "changed_from": changed_from,
            "candidate_files": scoped_files,
        },
        "counts": {
            "epics": len(epics),
            "tracked_files": len(files),
            "working_tree_files": len(files),
            "candidate_files": len(scoped_files),
            "implemented_refs": len(implemented_by),
            "primary_implemented_refs": sum(
                1 for record in implementation_ownership.values()
                if "primary" in record["kinds"]
            ),
            "verified_refs": len(verified_by),
            "missing_implemented_refs": len(missing_implemented),
            "missing_verified_refs": len(missing_verified),
            "test_files": len(test_files),
            "test_support_files": len(test_support_files),
            "source_files": len(source_files),
            "support_files": len(support_files),
            "tests_without_verified_by": len(unverified_tests),
            "source_without_implemented_by": len(unimplemented_sources),
        },
        "epics": relative_epics,
        "missing_implemented_refs": dict(sorted(missing_implemented.items())),
        "missing_verified_refs": dict(sorted(missing_verified.items())),
        "implementation_ownership": {
            path: {
                "epics": sorted(record["epics"]),
                "kinds": sorted(record["kinds"]),
            }
            for path, record in sorted(implementation_ownership.items())
        },
        "tests_without_verified_by": unverified_tests,
        "source_without_implemented_by": unimplemented_sources,
        "test_support_files": test_support_files,
        "support_files": support_files,
    }


def limited(items: Iterable[str], limit: int) -> list[str]:
    sequence = list(items)
    return sequence if limit <= 0 else sequence[:limit]


def print_markdown(report: dict, limit: int) -> None:
    print("# SDD Reverse-Traceability Inventory\n")
    print(f"- App root: `{report['root']}`")
    print(f"- Generated: `{report['generated_at']}`")
    print(f"- Inventory source: `{report['inventory_source']}`")
    if report["scope"]["epic_selector"]:
        print(f"- Epic scope: `{report['scope']['epic_selector']}`")
    if report["scope"]["changed_from"]:
        print(f"- Changed from: `{report['scope']['changed_from']}`")
    print("\n## Counts")
    for key, value in report["counts"].items():
        print(f"- {key}: {value}")

    print("\n## Missing Epic Evidence References")
    if not report["missing_implemented_refs"] and not report["missing_verified_refs"]:
        print("- None found.")
    for label, values in (
        ("Implemented By points to missing paths", report["missing_implemented_refs"]),
        ("Verified By points to missing paths", report["missing_verified_refs"]),
    ):
        if values:
            print(f"\n### {label}")
            for path, epics in limited(values.items(), limit):
                print(f"- `{path}` referenced by {', '.join(f'`{epic}`' for epic in epics)}")

    print("\n## Implementation Ownership")
    if not report["implementation_ownership"]:
        print("- None found.")
    for path, ownership in limited(report["implementation_ownership"].items(), limit):
        kinds = ", ".join(f"`{kind}`" for kind in ownership["kinds"])
        epics = ", ".join(f"`{epic}`" for epic in ownership["epics"])
        print(f"- `{path}`: kinds {kinds}; Epics {epics}")

    print("\n## Reverse-Traceability Candidates")
    sections = (
        ("Tests without Verified By path references", report["tests_without_verified_by"]),
        ("Source files without Implemented By ownership", report["source_without_implemented_by"]),
        ("Test support files excluded from behavior-test candidates", report["test_support_files"]),
        ("Framework, configuration, or generated files excluded from source candidates", report["support_files"]),
    )
    if not any(items for _, items in sections):
        print("- None found.")
    for heading, items in sections:
        if not items:
            continue
        print(f"\n### {heading}")
        for path in limited(items, limit):
            print(f"- `{path}`")
        if limit and len(items) > limit:
            print(f"- ... {len(items) - limit} more")

    print("\n## Interpretation")
    if not report["epics"]:
        print("- No selected Epic evidence was found; this does not appear to be a usable SDD audit scope.")
    print("- Missing references are high-confidence artifact drift.")
    print("- Unowned files are classification candidates, not deletion approval.")
    print("- Review excluded support files when project conventions make them behavior-bearing.")
    print("- Use stack-specific analyzers before classifying code as a likely orphan.")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Universal SDD reverse-traceability inventory.")
    parser.add_argument("root", nargs="?", default=".", help="Application root to audit.")
    parser.add_argument("--format", choices=["markdown", "json"], default="markdown")
    parser.add_argument("--limit", type=int, default=50, help="Max entries per markdown section; 0 means unlimited.")
    parser.add_argument("--epic", help="Limit Epic evidence to one Epic ID, directory, or epic.md path.")
    parser.add_argument("--changed-from", metavar="REF", help="Limit candidates to the current working surface since REF.")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.exists():
        print(f"Root does not exist: {root}", file=sys.stderr)
        return 2
    try:
        report = build_report(root, args.epic, args.changed_from)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    if args.format == "json":
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_markdown(report, args.limit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

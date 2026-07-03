#!/usr/bin/env python3
"""Check SDD Epic files against the canonical template shape.

This is a lightweight structural check. It does not verify implementation
truth, test strength, product scope, or whether evidence is accurate.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


REQUIRED_H2 = [
    "Product Context",
    "Outcome",
    "Current Scope",
    "Deferred Scope",
    "Candidate Stories",
    "Story Index",
    "Stories",
    "Cross-Story Concerns",
    "Open Decisions",
    "Completion Criteria",
    "Notes",
]

REQUIRED_FRONTMATTER = [
    "id",
    "status",
    "created",
    "modified",
    "last_verified",
    "stories",
]

STORY_METADATA = [
    "Status:",
    "Created:",
    "Modified:",
    "Last verified:",
]

STORY_SUBSECTIONS = [
    "Requirements And Scenarios",
    "Implemented By",
    "Verified By",
    "Verification Gaps",
    "Story Notes",
]

IMPLEMENTED_HEADER = "| Path | Role | Recheck Trigger |"
VERIFIED_HEADER = "| Requirement / Scenario | Evidence | Proves | Status |"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check SDD Epic template shape for one or more epic.md files.",
    )
    parser.add_argument(
        "paths",
        nargs="*",
        help="Epic files, Epic directories, app roots, or workspace roots to scan.",
    )
    parser.add_argument(
        "--format",
        choices=["text", "markdown"],
        default="text",
        help="Output format. Defaults to text.",
    )
    args = parser.parse_args()

    roots = [Path(p).resolve() for p in args.paths] or [Path.cwd()]
    epic_files = discover_epic_files(roots)
    if not epic_files:
        print("No Epic files found.", file=sys.stderr)
        return 2

    results = [check_epic(path) for path in epic_files]
    if args.format == "markdown":
        print_markdown(results)
    else:
        print_text(results)

    return 1 if any(result["findings"] for result in results) else 0


def discover_epic_files(paths: list[Path]) -> list[Path]:
    files: set[Path] = set()
    for path in paths:
        if path.is_file() and path.name == "epic.md":
            files.add(path)
            continue
        if path.is_dir() and path.name != "node_modules":
            direct = path / "epic.md"
            if direct.is_file():
                files.add(direct)
                continue
            docs_epics = path / "docs" / "epics"
            search_root = docs_epics if docs_epics.is_dir() else path
            for candidate in search_root.glob("**/epic.md"):
                if "node_modules" not in candidate.parts:
                    files.add(candidate)
    return sorted(files)


def check_epic(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    findings: list[str] = []
    warnings: list[str] = []

    frontmatter = parse_frontmatter(lines)
    missing_frontmatter = [key for key in REQUIRED_FRONTMATTER if key not in frontmatter]
    if missing_frontmatter:
        findings.append(f"missing frontmatter keys: {', '.join(missing_frontmatter)}")

    h2 = [line[3:].strip() for line in lines if line.startswith("## ")]
    missing_h2 = [heading for heading in REQUIRED_H2 if heading not in h2]
    extra_h2 = [heading for heading in h2 if heading not in REQUIRED_H2]
    if missing_h2:
        findings.append(f"missing top-level sections: {', '.join(missing_h2)}")
    if extra_h2:
        findings.append(f"unexpected top-level sections: {', '.join(extra_h2)}")

    story_blocks = split_story_blocks(lines)
    if not story_blocks:
        findings.append("no canonical `### Story ...` sections found")

    for story in story_blocks:
        story_findings = check_story(story)
        findings.extend(story_findings)
        label = story["label"]
        if not re.fullmatch(r"S\d+", label):
            warnings.append(
                f"{story['heading_line']}: legacy/migration Story label `{label}`; acceptable when existing references depend on it",
            )

    return {
        "path": path,
        "stories": len(story_blocks),
        "findings": findings,
        "warnings": warnings,
    }


def parse_frontmatter(lines: list[str]) -> dict[str, str]:
    if not lines or lines[0].strip() != "---":
        return {}

    result: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if match:
            result[match.group(1)] = match.group(2).strip()
    return result


def split_story_blocks(lines: list[str]) -> list[dict]:
    starts: list[tuple[int, str, re.Match[str]]] = []
    for index, line in enumerate(lines):
        match = re.match(r"^### Story ([^:]+):\s+(.+)$", line)
        if match:
            starts.append((index, line, match))

    blocks: list[dict] = []
    for position, (index, heading, match) in enumerate(starts):
        end = starts[position + 1][0] if position + 1 < len(starts) else len(lines)
        blocks.append(
            {
                "heading_line": index + 1,
                "heading": heading,
                "label": match.group(1),
                "title": match.group(2).strip(),
                "lines": lines[index:end],
            },
        )
    return blocks


def check_story(story: dict) -> list[str]:
    lines = story["lines"]
    prefix = f"{story['heading_line']} `{story['heading']}`"
    findings: list[str] = []

    metadata_window = lines[1:12]
    missing_metadata = [
        key for key in STORY_METADATA if not any(line.startswith(key) for line in metadata_window)
    ]
    if missing_metadata:
        findings.append(f"{prefix}: missing Story metadata lines: {', '.join(missing_metadata)}")

    h4 = [line[5:].strip() for line in lines if line.startswith("#### ")]
    missing_subsections = [heading for heading in STORY_SUBSECTIONS if heading not in h4]
    if missing_subsections:
        findings.append(f"{prefix}: missing Story subsections: {', '.join(missing_subsections)}")

    implemented_section = get_section(lines, "Implemented By")
    implemented_header = first_table_header(implemented_section)
    if implemented_section and implemented_header != IMPLEMENTED_HEADER:
        findings.append(
            f"{prefix}: `Implemented By` must use `{IMPLEMENTED_HEADER}` table header",
        )

    verified_section = get_section(lines, "Verified By")
    verified_header = first_table_header(verified_section)
    if not verified_section:
        findings.append(f"{prefix}: missing `Verified By` section")
    elif verified_header != VERIFIED_HEADER:
        if first_bullet(verified_section):
            shape = "bullet-list evidence"
        elif verified_header:
            shape = f"`{verified_header}`"
        else:
            shape = "no table header"
        findings.append(
            f"{prefix}: `Verified By` must use `{VERIFIED_HEADER}` table header, found {shape}",
        )

    return findings


def get_section(lines: list[str], heading: str) -> list[str]:
    start = None
    for index, line in enumerate(lines):
        if line.strip() == f"#### {heading}":
            start = index + 1
            break
    if start is None:
        return []

    end = len(lines)
    for index in range(start, len(lines)):
        if re.match(r"^#{3,4}\s+", lines[index]):
            end = index
            break
    return lines[start:end]


def first_table_header(lines: list[str]) -> str | None:
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            return collapse_table_header(stripped)
    return None


def collapse_table_header(header: str) -> str:
    cells = [cell.strip() for cell in header.strip("|").split("|")]
    return f"| {' | '.join(cells)} |"


def first_bullet(lines: list[str]) -> bool:
    return any(line.lstrip().startswith("- ") for line in lines)


def print_text(results: list[dict]) -> None:
    total_stories = sum(result["stories"] for result in results)
    total_findings = sum(len(result["findings"]) for result in results)
    print(
        f"Epic template check: epics={len(results)} stories={total_stories} findings={total_findings}",
    )
    for result in results:
        status = "pass" if not result["findings"] else "findings"
        print(f"\n{status}: {result['path']}")
        print(f"  stories: {result['stories']}")
        for finding in result["findings"]:
            print(f"  - {finding}")
        for warning in result["warnings"]:
            print(f"  warning: {warning}")


def print_markdown(results: list[dict]) -> None:
    total_stories = sum(result["stories"] for result in results)
    total_findings = sum(len(result["findings"]) for result in results)
    print(
        f"- Epic template check: epics={len(results)}, stories={total_stories}, findings={total_findings}",
    )
    for result in results:
        status = "pass" if not result["findings"] else "findings"
        print(f"- `{result['path']}`: {status}, stories={result['stories']}")
        for finding in result["findings"]:
            print(f"  - {finding}")
        for warning in result["warnings"]:
            print(f"  - warning: {warning}")


if __name__ == "__main__":
    raise SystemExit(main())
